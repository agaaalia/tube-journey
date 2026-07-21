/* ====================================================================
   OUR JOURNEY
   A tiny playable pixel journey. Vanilla JS, one <canvas>, no libraries.

   How it's built:
   - The world renders to a 320x180 buffer, upscaled with nearest-neighbour
     so every pixel stays crisp.
   - A small scene state machine (title -> s1 -> s2 -> s3 -> paris -> finale)
     scripts the story in timed "beats".
   - Characters are drawn procedurally from rectangles so their idle
     animations (blink, feet swing, train rock, hand-holding) are fully
     controllable.
   - Text-heavy things (letters, signage) live in the DOM overlay.

   To make it yours: search "CUSTOMISE" for names, colours and letter copy.
==================================================================== */

(() => {
"use strict";

/* ============ 0. BOOT & CANVAS ==================================== */
const W = 320, H = 180;                 // internal resolution
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;      // hard pixels, no anti-alias

const REDUCED = window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const MOT = REDUCED ? 0.35 : 1;         // global motion scale

// Fit the canvas to the viewport at an integer scale, letterboxed.
function fit(){
  const s = Math.max(1, Math.floor(Math.min(
    window.innerWidth  / W,
    window.innerHeight / H)));
  canvas.style.width  = (W * s) + "px";
  canvas.style.height = (H * s) + "px";
}
window.addEventListener("resize", fit);
fit();

/* ============ 1. MATH & DRAW HELPERS ============================== */
const clamp = (v,a,b)=> v<a?a:v>b?b:v;
const lerp  = (a,b,t)=> a + (b-a)*t;
const easeInOut = t => t<0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;
const easeOut   = t => 1 - Math.pow(1-t,3);
const easeIn    = t => t*t*t;
// stable pseudo-random from an integer (keeps scrolling scenery consistent)
const hash = n => { const x = Math.sin(n*127.1)*43758.545; return x - Math.floor(x); };

let t = 0; // total elapsed seconds (drives idle loops)

// Core pixel plotter — always integer-aligned.
function px(x,y,w,h,c){
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
// Horizontally banded gradient — a pixel-friendly sky.
function bandSky(x,y,w,h,colors){
  const n = colors.length, bh = h/n;
  for(let i=0;i<n;i++) px(x, y+i*bh, w, Math.ceil(bh)+1, colors[i]);
}
function clearScreen(c){ px(0,0,W,H,c||"#000"); }

/* ============ 2. CHARACTER PALETTES =============================== */
/* CUSTOMISE: two cuties. Recolour to match you and your person. */
const CHAR_A = { name:"you",
  hair:"#8a4a2a", skin:"#f6cda2", skinSh:"#e0a878",
  cloth:"#e8746b", clothSh:"#c15750", shoe:"#3a2f2a", eye:"#2a2230" };
const CHAR_B = { name:"him",
  hair:"#2b2733", skin:"#eab98c", skinSh:"#cf9d70",
  cloth:"#3f7fb0", clothSh:"#2d5f88", shoe:"#23303a", eye:"#2a2230" };
const BLUSH = "rgba(232,116,107,0.55)";

/* ============ 3. AUDIO (synthesised placeholders) ================= */
/* Everything is generated with WebAudio so the page stays fully
   self-contained. All wrapped in try/catch: audio can never break art. */
const Snd = {
  ac:null, master:null, on:false, noise:null,
  rumble:null, rumbleGain:null, pad:[], clackTimer:null, moving:false, twinkleTimer:null,

  init(){
    if(this.ac) return;
    try{
      this.ac = new (window.AudioContext||window.webkitAudioContext)();
      this.master = this.ac.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ac.destination);
      // one shared noise buffer
      const len = this.ac.sampleRate*2, buf = this.ac.createBuffer(1,len,this.ac.sampleRate);
      const d = buf.getChannelData(0); let last=0;
      for(let i=0;i<len;i++){ const wn=Math.random()*2-1; last=(last+0.02*wn)/1.02; d[i]=last*3; }
      this.noise = buf;
    }catch(e){ /* no audio available */ }
  },
  resume(){ try{ if(this.ac && this.ac.state==="suspended") this.ac.resume(); }catch(e){} },
  setOn(v){
    this.on = v;
    try{ this.master.gain.cancelScheduledValues(this.ac.currentTime);
      this.master.gain.linearRampToValueAtTime(v?0.4:0, this.ac.currentTime+0.25);
    }catch(e){}
  },
  // short bell for announcements / doors
  chime(base=880){
    if(!this.ac) return;
    try{
      [base, base*1.5].forEach((f,i)=>{
        const o=this.ac.createOscillator(), g=this.ac.createGain();
        o.type="sine"; o.frequency.value=f;
        g.gain.setValueAtTime(0.0001,this.ac.currentTime+i*0.08);
        g.gain.exponentialRampToValueAtTime(0.5,this.ac.currentTime+i*0.08+0.02);
        g.gain.exponentialRampToValueAtTime(0.0001,this.ac.currentTime+i*0.08+0.6);
        o.connect(g); g.connect(this.master);
        o.start(); o.stop(this.ac.currentTime+i*0.08+0.7);
      });
    }catch(e){}
  },
  // tiny soft blip for speech-bubble beats
  blip(f=700){
    if(!this.ac) return;
    try{
      const o=this.ac.createOscillator(), g=this.ac.createGain();
      o.type="sine"; o.frequency.value=f;
      const n=this.ac.currentTime;
      g.gain.setValueAtTime(0.0001,n);
      g.gain.exponentialRampToValueAtTime(0.22,n+0.01);
      g.gain.exponentialRampToValueAtTime(0.0001,n+0.16);
      o.connect(g); g.connect(this.master); o.start(); o.stop(n+0.2);
    }catch(e){}
  },
  clack(){
    if(!this.ac||!this.noise) return;
    try{
      const s=this.ac.createBufferSource(); s.buffer=this.noise; s.loop=true;
      const bp=this.ac.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=180; bp.Q.value=2;
      const g=this.ac.createGain();
      g.gain.setValueAtTime(0.0001,this.ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25,this.ac.currentTime+0.01);
      g.gain.exponentialRampToValueAtTime(0.0001,this.ac.currentTime+0.09);
      s.connect(bp); bp.connect(g); g.connect(this.master);
      s.start(); s.stop(this.ac.currentTime+0.12);
    }catch(e){}
  },
  startTrain(){
    if(!this.ac||this.moving) return;
    this.moving=true;
    try{
      // low rumble
      this.rumble=this.ac.createBufferSource(); this.rumble.buffer=this.noise; this.rumble.loop=true;
      const lp=this.ac.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=140;
      this.rumbleGain=this.ac.createGain(); this.rumbleGain.gain.value=0.18;
      this.rumble.connect(lp); lp.connect(this.rumbleGain); this.rumbleGain.connect(this.master);
      this.rumble.start();
    }catch(e){}
    this.clackTimer = setInterval(()=> this.clack(), 520);
  },
  stopTrain(){
    this.moving=false;
    try{ if(this.rumble) this.rumble.stop(); }catch(e){}
    this.rumble=null;
    if(this.clackTimer){ clearInterval(this.clackTimer); this.clackTimer=null; }
  },
  startPad(){
    if(!this.ac||this.pad.length) return;
    try{
      // warm, romantic chord (Cmaj add9-ish) with a soft musette shimmer
      const chord=[261.63, 329.63, 392.0, 493.88, 587.33];
      chord.forEach((f,i)=>{
        const o=this.ac.createOscillator(), g=this.ac.createGain();
        o.type = i%2? "triangle":"sine"; o.frequency.value=f;
        if(o.type==="triangle") o.detune.value = i%4===1? 6 : -6;   // gentle accordion detune
        g.gain.setValueAtTime(0.0001,this.ac.currentTime);
        g.gain.linearRampToValueAtTime(i<3?0.10:0.05, this.ac.currentTime+3);
        const lfo=this.ac.createOscillator(), lg=this.ac.createGain();
        lfo.frequency.value=0.16+0.04*i; lg.gain.value=2.0;
        lfo.connect(lg); lg.connect(o.frequency); lfo.start();
        o.connect(g); g.connect(this.master); o.start();
        this.pad.push(o,lfo);
      });
      // twinkling music-box melody drifting over the top
      const scale=[523.25,587.33,659.25,783.99,880.0,1046.5]; // C5 D5 E5 G5 A5 C6
      this.twinkleTimer=setInterval(()=>{
        if(!this.ac || Math.random()<0.28) return;             // occasional rests for space
        this.twinkle(scale[Math.floor(Math.random()*scale.length)]);
      }, 620);
    }catch(e){}
  },
  // single bell-like note with a shimmering upper partial
  twinkle(f){
    if(!this.ac) return;
    try{
      const n=this.ac.currentTime;
      const o=this.ac.createOscillator(), g=this.ac.createGain();
      o.type="sine"; o.frequency.value=f;
      g.gain.setValueAtTime(0.0001,n);
      g.gain.exponentialRampToValueAtTime(0.09,n+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001,n+1.1);
      o.connect(g); g.connect(this.master); o.start(n); o.stop(n+1.2);
      const o2=this.ac.createOscillator(), g2=this.ac.createGain();
      o2.type="sine"; o2.frequency.value=f*2.01;
      g2.gain.setValueAtTime(0.0001,n);
      g2.gain.exponentialRampToValueAtTime(0.03,n+0.02);
      g2.gain.exponentialRampToValueAtTime(0.0001,n+0.7);
      o2.connect(g2); g2.connect(this.master); o2.start(n); o2.stop(n+0.8);
    }catch(e){}
  },
  stopPad(){
    if(this.twinkleTimer){ clearInterval(this.twinkleTimer); this.twinkleTimer=null; }
    try{ this.pad.forEach(o=>o.stop()); }catch(e){}
    this.pad=[];
  }
};

/* ============ 4. PARTICLES ======================================== */
let particles=[];
function spawn(p){ particles.push(p); }
function updateParticles(dt){
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i];
    p.life-=dt; p.x+=p.vx*dt; p.y+=p.vy*dt;
    if(p.g) p.vy+=p.g*dt;
    if(p.life<=0) particles.splice(i,1);
  }
}
function drawParticles(){
  for(const p of particles){
    const a = p.fade ? clamp(p.life/p.max,0,1) : 1;
    ctx.globalAlpha = a;
    px(p.x, p.y, p.s||1, p.s||1, p.c);
  }
  ctx.globalAlpha = 1;
}

/* ============ 5. SPRITES ========================================== */

// --- Seated chibi (front view): big head, tiny body, dangling feet ---
function chibiSeated(cx, seatY, pal, o){
  o = o||{};
  const bob = (o.bob||0);
  const cy  = seatY + bob;
  const foot = Math.sin(o.footPhase||0) * 2 * MOT;

  // legs (dangle + swing)
  px(cx-7, cy, 5, 8, pal.clothSh);
  px(cx+2, cy, 5, 8, pal.clothSh);
  px(cx-8+foot,  cy+8, 6, 3, pal.shoe);
  px(cx+2-foot,  cy+8, 6, 3, pal.shoe);

  // body
  const bt = cy-14;
  px(cx-8, bt, 16, 15, pal.cloth);
  px(cx-8, bt, 16, 3,  pal.clothSh);      // collar shade

  // arms (idle rest, or an action)
  if(o.arm==="offer"){        // reach toward centre (holding treat)
    px(cx+6, bt+5, 9, 3, pal.cloth);
    px(cx+13, bt+4, 3, 4, pal.skin);
  } else if(o.arm==="take"){
    px(cx-15, bt+5, 9, 3, pal.cloth);
    px(cx-16, bt+4, 3, 4, pal.skin);
  } else {
    px(cx-10, bt+4, 3, 8, pal.clothSh);
    px(cx+7,  bt+4, 3, 8, pal.clothSh);
  }

  // head (big)
  const hw=22, hh=19, hx=cx-11, hy=bt-17;
  px(hx, hy, hw, hh, pal.skin);
  px(hx, hy+hh-3, hw, 3, pal.skinSh);     // jaw shade
  // hair — soft fringe + sides; CHAR_A wears it shoulder-length
  px(hx-1, hy-3, hw+2, 7, pal.hair);              // fringe / top
  px(hx-1, hy-3, 3, hh, pal.hair);                // left side
  px(hx+hw-2, hy-3, 3, hh, pal.hair);             // right side
  if(pal===CHAR_A){
    // hair spilling past the jaw to the shoulders on both sides
    px(hx-2,    hy+4,    4, hh+2, pal.hair);      // left length
    px(hx+hw-2, hy+4,    4, hh+2, pal.hair);      // right length
    px(hx-2,    hy+hh+2, 4, 3,    pal.hair);      // soft tips
    px(hx+hw-2, hy+hh+2, 4, 3,    pal.hair);
  }

  // face
  const ey = hy+10;
  const eh = o.blink ? 1 : 4;
  px(cx-6, ey, 3, eh, pal.eye);
  px(cx+3, ey, 3, eh, pal.eye);
  px(cx-9, ey+3, 2,2, BLUSH);
  px(cx+7, ey+3, 2,2, BLUSH);
  const smile = o.smile ? 4 : 3;
  px(cx-(smile>>1), ey+6, smile, 1, "#9a5348");
}

// --- Walking chibi (side view, faces right). o.step drives 2-frame legs ---
function chibiWalk(cx, footY, pal, o){
  o=o||{};
  const ph = o.stepPhase||0;
  const s  = Math.sin(ph);
  const bob= Math.abs(Math.cos(ph))*1.2*MOT;
  const cy = footY - bob;
  const sw = 4*s;

  // legs
  px(cx-3, cy-11, 4, 11, pal.clothSh);            // back
  px(cx-1+sw*0.6, cy-11, 4, 11, pal.cloth);       // front
  px(cx-4, cy, 5,2, pal.shoe);
  px(cx-2+sw*0.6, cy, 5,2, pal.shoe);

  // body
  const bt = cy-25;
  px(cx-5, bt, 11, 15, pal.cloth);
  px(cx-5, bt, 11, 3,  pal.clothSh);

  // arm: swinging, or reaching to hold a hand
  if(o.hold==="right"){ px(cx+4, bt+7, 6, 3, pal.skin); }        // inner arm reaching right
  else if(o.hold==="left"){ px(cx-10, bt+7, 6, 3, pal.skin); }   // inner arm reaching left
  else { px(cx-2 - sw*0.4, bt+5, 3, 9, pal.clothSh); }

  // head (side)
  const hw=18, hh=16, hx=cx-9, hy=bt-15;
  px(hx, hy, hw, hh, pal.skin);
  px(hx-1, hy-3, hw+1, 7, pal.hair);              // top
  px(hx-1, hy-3, 5, hh+2, pal.hair);              // back of head
  if(pal===CHAR_A) px(hx-2, hy+hh-3, 6, 10, pal.hair);  // shoulder-length hair down the back
  const eh=o.blink?1:4;
  px(hx+hw-6, hy+7, 3, eh, pal.eye);              // eye toward front
  px(hx+hw-9, hy+10, 2,2, BLUSH);
  px(hx+hw-2, hy+9, 2,1, "#9a5348");              // nose/mouth
}

// --- Envelope on the seat / floating ---
function envelope(cx, cy, glow){
  if(glow){
    ctx.globalAlpha = 0.18 + 0.14*Math.sin(t*4);
    px(cx-13, cy-11, 26, 22, "#ffd76a");
    ctx.globalAlpha = 1;
  }
  px(cx-10, cy-7, 20, 14, "#fff4dd");     // body
  px(cx-10, cy-7, 20, 2,  "#e9d9b4");     // top edge
  px(cx-10, cy+5, 20, 2,  "#e9d9b4");     // bottom edge
  // flap (stepped V)
  for(let i=0;i<6;i++){
    px(cx-10+i, cy-7+i, 2, 1, "#e6d3a8");
    px(cx+9-i,  cy-7+i, 2, 1, "#e6d3a8");
  }
  // little heart seal
  px(cx-2, cy-1, 2,2, "#e8746b"); px(cx, cy-1, 2,2, "#e8746b");
  px(cx-3, cy,   6,2, "#e8746b"); px(cx-2, cy+2, 4,1, "#e8746b");
  px(cx-1, cy+3, 2,1, "#e8746b");
  // frame
  ctx.strokeStyle="#b8860b"; ctx.lineWidth=1;
  ctx.strokeRect(cx-10.5, cy-7.5, 20, 14);
}

// --- Chocolate bar (a nod to a certain unequal-chunks bar) ---
function chocolate(cx, cy, bites){
  px(cx-8, cy-4, 16, 8, "#b23b3b");       // wrapper
  px(cx-6, cy-3, 12, 6, "#5a3220");       // chocolate
  for(let i=0;i<3;i++){ if(i>=3-bites) continue;
    px(cx-6+i*4, cy-3, 3, 6, "#6f4028");
    px(cx-6+i*4, cy-3, 1, 6, "#3f2417");
  }
}

// --- little joined-hands knot drawn between two walking chibis ------
function handClasp(ax, bx, footY){
  const y = footY - 18;                   // sits at the inner-arm height
  const x = Math.round((ax+bx)/2 - 1);
  px(x, y, 3, 3, CHAR_A.skin);
}

// --- a tiny camera the girl holds up on the first ride --------------
function miniCamera(cx, cy){
  px(cx-4, cy-3, 9, 6, "#2a2a2e");        // body
  px(cx-4, cy-3, 9, 1, "#3d3d44");        // top edge
  px(cx-3, cy-4, 3, 1, "#4a4a52");        // viewfinder hump
  px(cx+1, cy-1, 3, 3, "#8fb7d8");        // lens
  px(cx+2, cy,   1, 1, "#cfe6f5");        // glint
  px(cx+3, cy-4, 1, 1, "#e86b6b");        // shutter light
}

// --- croissant + coffee for the Eurostar table ---------------------
function croissant(cx, cy){
  const base="#d99a4e", hi="#f0c074", sh="#a86a2e";
  px(cx-6, cy-1, 3, 3, base); px(cx-3, cy-3, 3, 3, base);
  px(cx,   cy-4, 3, 3, base); px(cx+3, cy-3, 3, 3, base); px(cx+5, cy-1, 3, 3, base);
  px(cx-1, cy-4, 3, 1, hi);   px(cx-4, cy-3, 2, 1, hi);   // shine
  px(cx-6, cy+1, 12, 1, sh);                              // underside
}
function coffeeCup(cx, cy){
  px(cx-5, cy+3, 11, 2, "#e6ded0");       // saucer
  px(cx-4, cy-2, 8, 5, "#f5efe4");        // cup
  px(cx+2, cy-2, 2, 5, "#ddd4c4");        // side shade
  px(cx-3, cy-2, 6, 1, "#5a3a22");        // coffee
  px(cx+4, cy-1, 2, 3, "#f5efe4");        // handle
  // gentle steam
  ctx.globalAlpha = 0.5 + 0.3*Math.sin(t*3);
  px(cx-1, cy-5+Math.round(Math.sin(t*2)), 1, 2, "#ffffff");
  px(cx+1, cy-6+Math.round(Math.cos(t*2)), 1, 2, "#ffffff");
  ctx.globalAlpha = 1;
}

// --- pixel speech bubble (canvas text, on-theme chunky) -------------
function speechBubble(cx, cy, text){
  ctx.save();
  ctx.font = "10px 'VT323','Courier New',monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const tw = Math.ceil(ctx.measureText(text).width);
  const bw = tw + 12, bh = 15;
  const bx = Math.round(cx - bw/2), by = Math.round(cy - bh/2);
  // soft drop shadow
  ctx.globalAlpha = 0.22; px(bx+1, by+2, bw, bh, "#000"); ctx.globalAlpha = 1;
  // body with trimmed pixel corners
  px(bx, by, bw, bh, "#fff7e6");
  px(bx-1, by+2, 1, bh-4, "#fff7e6"); px(bx+bw, by+2, 1, bh-4, "#fff7e6");
  px(bx+2, by-1, bw-4, 1, "#fff7e6"); px(bx+2, by+bh, bw-4, 1, "#fff7e6");
  // faint outline top/bottom
  ctx.globalAlpha = 0.85;
  px(bx+2, by-1, bw-4, 1, "#d8c49a"); px(bx+2, by+bh, bw-4, 1, "#d8c49a");
  ctx.globalAlpha = 1;
  // downward tail toward the speaker
  px(cx-1, by+bh, 3, 2, "#fff7e6"); px(cx, by+bh+2, 1, 2, "#fff7e6");
  // text
  ctx.fillStyle = "#3a2f22";
  ctx.fillText(text, cx, by + bh/2 + 1);
  ctx.restore();
}

/* --- Parallax skyline: scrolls left, stable buildings via hash() --- */
function skylineLayer(scroll, baseY, maxH, spacing, seedBase, body, win){
  const off = ((scroll % spacing)+spacing)%spacing;
  const cols = Math.ceil(W/spacing)+2;
  const start = Math.floor(scroll/spacing);
  for(let i=-1;i<cols;i++){
    const col = start + i;
    const bx  = i*spacing - off;
    const r   = hash(col*1.7 + seedBase);
    const bh  = 8 + Math.floor(r*maxH);
    const bw  = spacing-2;
    px(bx, baseY-bh, bw, bh, body);
    // windows
    if(win){
      for(let wy=baseY-bh+3; wy<baseY-3; wy+=5){
        for(let wx=bx+2; wx<bx+bw-2; wx+=4){
          if(hash(wx*3.1+wy*0.7+col)>0.5) px(wx, wy, 2, 2, win);
        }
      }
    }
  }
}

// drifting puffy clouds
function cloud(x,y,scale){
  const c="rgba(255,255,255,0.85)";
  px(x, y, 12*scale, 5*scale, c);
  px(x+4*scale, y-3*scale, 8*scale, 5*scale, c);
  px(x-3*scale, y+2*scale, 18*scale, 4*scale, c);
}

/* --- Underground carriage interior ------------------------------- */
/* cfg: { theme, scroll, doorOpen(0..1), bob, showExtras, extrasT } */
function drawCarriage(cfg){
  const bob = cfg.bob||0;

  // ceiling + wall
  bandSky(0,0,W,H,["#2a2436"]);           // dark base
  px(0,0,W,26,"#3b3450");                 // ceiling
  px(0,26,W,4,"#241f30");
  // hanging straps, gentle sway
  for(let i=40;i<W;i+=48){
    const sx = i + Math.sin(t*1.3 + i)*2*MOT;
    px(sx, 6, 2, 10, "#c9a24b");
    px(sx-3, 15, 8, 3, "#c9a24b");
    px(sx-2, 16, 6, 1, "#3b3450");
  }

  // window band with scenery
  const wy0=32, wyH=58;
  ctx.save();
  ctx.beginPath(); ctx.rect(6, wy0, W-12, wyH); ctx.clip();
  drawScenery(cfg.theme, cfg.scroll);
  ctx.restore();

  // window frame / mullions
  px(6, wy0, W-12, 2, "#191524");
  px(6, wy0+wyH-2, W-12, 2, "#191524");
  for(let x=6; x<=W-6; x+=52){ px(x, wy0, 3, wyH, "#191524"); }
  // glass sheen
  ctx.globalAlpha=0.08;
  px(10, wy0+3, 30, wyH-6, "#ffffff"); ctx.globalAlpha=1;

  // lower wall + moquette seat
  px(0, wy0+wyH, W, H-(wy0+wyH), "#241f30");
  const seatY = 150;
  px(0, seatY-14, W, 16, "#5a3a63");            // seat back cushion
  // moquette diamonds (original pattern)
  for(let x=0;x<W;x+=10){ for(let y=seatY-13;y<seatY;y+=6){
    px(x+4, y, 2,2, "#7d5487"); px(x+9, y+3, 2,2, "#c78bbf");
  }}
  px(0, seatY, W, H-seatY, "#3a2f42");          // floor
  px(0, seatY, W, 2, "#4c3f57");

  // sliding door on the right, opens onto a platform
  if(cfg.doorOpen!==undefined){
    const d = cfg.doorOpen;
    const dx = 250, dw = 62;
    // platform beyond (visible as doors part)
    px(dx, 30, dw, seatY-30, "#b9a06a");        // warm platform light
    px(dx, 30, dw, 6, "#8c7038");
    if(cfg.platformSign) cfg.platformSign(dx,dw);
    // two door panels sliding apart
    const shift = Math.round(d*(dw/2));
    px(dx,            30, dw/2 - shift, seatY-30, "#443b57");
    px(dx+dw/2+shift, 30, dw/2 - shift, seatY-30, "#443b57");
    px(dx, 30, dw, 3, "#2c2540");
    // door windows
    px(dx+6, 40, 12, 40, d>0.5?"#b9a06a":"#8fa6c0");
    px(dx+dw-18, 40, 12, 40, d>0.5?"#b9a06a":"#8fa6c0");
  }

  // floating dust motes for cosiness
  if(Math.random()<0.15*MOT) spawn({x:Math.random()*W,y:60+Math.random()*60,
    vx:-2,vy:-1,life:4,max:4,fade:true,s:1,c:"rgba(255,240,200,0.5)"});

  return seatY;
}

/* --- Scenery themes shown through windows ------------------------- */
function drawScenery(theme, scroll){
  if(theme==="london"){
    bandSky(6,32,W-12,58,["#8fb7e0","#a9c9e8","#cfe0ee"]);
    for(let i=0;i<3;i++) cloud(((-scroll*0.2 + i*130)%(W+40))-20, 42+i*6, 1);
    skylineLayer(scroll*0.5, 90, 34, 40, 5, "#7c88a8", "#c9d4e6");   // far
    skylineLayer(scroll*0.9, 90, 46, 30, 20, "#4f5878", "#ffd98a");  // near terraces
    px(6, 86, W-12, 4, "#3a3350");                                   // trackside
  }
  else if(theme==="suburb"){
    bandSky(6,32,W-12,58,["#bfe0d8","#d6ecdf","#eef6e6"]);
    for(let i=0;i<2;i++) cloud(((-scroll*0.15 + i*160)%(W+40))-20, 40+i*7, 1);
    // rolling greens
    px(6, 74, W-12, 16, "#7bbf6a");
    skylineLayer(scroll*0.8, 84, 22, 34, 40, "#c98a5a", "#fff0c0");  // little houses
    // trees
    for(let x=-((scroll*1.1)%36); x<W; x+=36){
      px(x+8, 66, 4, 12, "#5a3b26"); px(x+3, 56, 14, 12, "#3f8f52");
    }
  }
  else if(theme==="platform"){
    // station concourse seen through windows
    bandSky(6,32,W-12,58,["#3b3450","#4a4262"]);
    px(6, 60, W-12, 30, "#5a4e70");
    for(let x=6;x<W-6;x+=40) px(x, 34, 4, 54, "#2c2740");           // pillars
    px(6, 88, W-12, 2, "#8c7038");
  }
}

/* --- Modern Eurostar-style train (original livery) ---------------- */
function modernTrain(x, y){
  // sleek nose to the right
  const body="#e9edf2", roof="#2b3a55", stripe="#d9b24a", win="#8fb7d8";
  px(x, y, 120, 34, body);
  px(x, y, 120, 8, roof);
  // aerodynamic nose
  for(let i=0;i<16;i++) px(x+120+i, y+Math.floor(i*1.1), 2, 34-Math.floor(i*2.1), body);
  px(x, y+22, 120, 4, stripe);        // gold stripe
  // windows
  for(let wx=x+8; wx<x+112; wx+=16) px(wx, y+11, 11, 8, win);
  px(x, y+34, 136, 4, "#1c2436");     // skirt
  // wheels
  px(x+20, y+38, 8,4, "#111"); px(x+90, y+38, 8,4, "#111");
}

/* --- Eiffel Tower silhouette (grows over the finale) -------------- */
function eiffel(cx, baseY, hgt, col){
  const w = hgt*0.42;                 // base half-width scales with height
  // four splayed legs -> arch
  ctx.save();
  const seg = (yy, hh, halfTop, halfBot, c)=>{
    // trapezoid built from thin vertical slabs
    const steps = Math.max(4, Math.floor(hh/2));
    for(let i=0;i<steps;i++){
      const f = i/steps;
      const half = lerp(halfBot, halfTop, f);
      px(cx-half, yy-hh*f-1, 2, 3, c);          // left rail
      px(cx+half-2, yy-hh*f-1, 2, 3, c);        // right rail
    }
  };
  const H1=baseY, topY=baseY-hgt;
  // legs (base -> first platform)
  seg(H1, hgt*0.45, w*0.45, w, col);
  // arch between legs at the bottom
  px(cx-w*0.7, baseY-hgt*0.12, w*1.4, 2, col);
  // platform 1
  px(cx-w*0.5, baseY-hgt*0.45, w, 3, col);
  // mid section
  seg(baseY-hgt*0.45, hgt*0.35, w*0.16, w*0.45, col);
  // platform 2
  px(cx-w*0.22, baseY-hgt*0.8, w*0.44, 2, col);
  // spire
  seg(baseY-hgt*0.8, hgt*0.2, 1, w*0.16, col);
  px(cx-1, topY, 2, 4, col);
  ctx.restore();
}

/* ============ 6. DOM OVERLAY HELPERS ============================== */
const D = {
  title: document.getElementById("title"),
  pressStart: document.getElementById("pressStart"),
  begin: document.getElementById("beginBtn"),
  announce: document.getElementById("announce"),
  announceText: document.getElementById("announceText"),
  hint: document.getElementById("hint"),
  letter: document.getElementById("letter"),
  letterTitle: document.getElementById("letterTitle"),
  letterBody: document.getElementById("letterBody"),
  letterContinue: document.getElementById("letterContinue"),
  sound: document.getElementById("sound"),
  replay: document.getElementById("replay"),
};

let announceTimer=null;
function showAnnounce(text, dur=3){
  D.announceText.textContent = text;
  D.announce.classList.remove("hidden");
  Snd.chime(760);
  clearTimeout(announceTimer);
  if(dur) announceTimer=setTimeout(hideAnnounce, dur*1000);
}
function hideAnnounce(){ D.announce.classList.add("hidden"); }
function showHint(text="tap the letter"){ D.hint.textContent=text; D.hint.classList.remove("hidden"); }
function hideHint(){ D.hint.classList.add("hidden"); }

let phaseLock=false;                 // pauses scripted beats (e.g. while reading)
let letterOnContinue=null;
function openLetter(cfg){
  phaseLock=true;
  D.letterTitle.textContent = cfg.title;
  D.letterBody.innerHTML = cfg.body;
  D.letter.classList.toggle("finale", !!cfg.finale);
  D.letterContinue.textContent = cfg.button || "Continue";
  D.letter.classList.remove("hidden");
  D.letterContinue.focus();
  letterOnContinue = cfg.onContinue || null;
  Snd.chime(660);
}
D.letterContinue.addEventListener("click", ()=>{
  D.letter.classList.add("hidden");
  phaseLock=false;
  const cb=letterOnContinue; letterOnContinue=null;
  if(cb) cb();
});

/* ============ 7. INPUT ============================================ */
// map a screen click to internal coords
function toWorld(e){
  const r=canvas.getBoundingClientRect();
  const cx = (e.touches? e.touches[0].clientX : e.clientX);
  const cy = (e.touches? e.touches[0].clientY : e.clientY);
  return { x:(cx-r.left)/r.width*W, y:(cy-r.top)/r.height*H };
}
function tryClick(p){
  if(phaseLock || trans.active) return;
  const c = S.click;
  if(c && Math.abs(p.x-c.x)<c.r && Math.abs(p.y-c.y)<c.r){
    const act=c.act; S.click=null; hideHint(); act();
  }
}
canvas.addEventListener("click", e=> tryClick(toWorld(e)));
canvas.addEventListener("touchstart", e=>{ e.preventDefault(); tryClick(toWorld(e)); },{passive:false});
// keyboard: activate a present clickable with Enter/Space
window.addEventListener("keydown", e=>{
  if((e.key==="Enter"||e.key===" ") && S.click && !phaseLock && !trans.active){
    const act=S.click.act; S.click=null; hideHint(); act();
  }
});

/* ============ 8. SCENE MANAGER & TRANSITIONS ====================== */
let S = { name:"", t:0, phase:"", pt:0, click:null };
let current = null;
const trans = { active:false, tt:0, dur:0.7, next:null, swapped:false };

function setScene(name){
  S = { name, t:0, phase:"", pt:0, click:null };
  particles.length=0;
  hideAnnounce(); hideHint();
  current = scenes[name];
  current.enter();
}
function setPhase(p){ S.phase=p; S.pt=0; }
function go(name, dur=0.8){
  if(trans.active) return;
  trans.active=true; trans.tt=0; trans.dur=dur; trans.next=name; trans.swapped=false;
}
function updateTrans(dt){
  trans.tt+=dt;
  if(!trans.swapped && trans.tt>=trans.dur/2){ setScene(trans.next); trans.swapped=true; }
  if(trans.tt>=trans.dur) trans.active=false;
}
function drawTransOverlay(){
  if(!trans.active) return;
  const half=trans.dur/2;
  const a = trans.tt<half ? trans.tt/half : 1-(trans.tt-half)/half;
  ctx.globalAlpha=clamp(a,0,1); px(0,0,W,H,"#000"); ctx.globalAlpha=1;
}

/* ============ 9. SCENES =========================================== */
/* Idle helpers shared by seated scenes */
const blinkNow = (off=0)=> (Math.sin(t*1.6+off)>0.94);   // occasional blink
const trainBob = ()=> Math.sin(t*3)*1.4*MOT;             // carriage rock

const scenes = {

/* ---------- TITLE ------------------------------------------------- */
title:{
  enter(){ D.title.classList.remove("hidden"); },
  update(){ if(trans.active) return; },
  draw(){
    // cosy dawn platform behind the DOM title text
    bandSky(0,0,W,H,["#243056","#3f4f7a","#7c6a86","#e0a06a","#f4c98a"]);
    for(let i=0;i<3;i++) cloud(((t*4 + i*120)%(W+40))-20, 30+i*10, 1);
    skylineLayer(t*3, 120, 40, 40, 5, "#2f3a5c", "#ffd98a");
    px(0,120,W,60,"#20283f");                    // platform ground
    px(0,120,W,2,"#33406a");
    // pixel roundel "logo" (original transit mark)
    drawRoundel(52, 44, 1);
    // a little idle train puffing at the platform edge
    const tx=W-96;
    px(tx, 96, 70, 24, "#c95d55"); px(tx,96,70,6,"#7a2f2a");
    for(let wx=tx+6;wx<tx+64;wx+=14) px(wx,104,9,7,"#ffd98a");
    px(tx,120,74,3,"#151a2c");
    if(Math.random()<0.2) spawn({x:tx+68,y:94,vx:6,vy:-8,life:1.4,max:1.4,fade:true,s:2,c:"rgba(230,230,240,0.7)"});
  }
},

/* ---------- SCENE ONE: Stratford --------------------------------- */
s1:{
  enter(){
    S.scroll=0; S.speed=90; S.doorOpen=0; S.extrasOut=0; S.env=false;
    S.say=0; S.said1=false; S.said2=false;
    Snd.startTrain();
    setPhase("ride");
  },
  update(dt){
    if(trans.active) return;
    S.scroll += S.speed*dt;

    if(S.phase==="ride"){
      // a little exchange about the mini camera before the stop
      if(S.pt>0.8 && S.pt<2.7){ S.say=1; if(!S.said1){ S.said1=true; Snd.blip(660); } }
      else if(S.pt>3.0 && S.pt<4.8){ S.say=2; if(!S.said2){ S.said2=true; Snd.blip(880); } }
      else S.say=0;
      if(S.pt>5.2){ S.say=0; showAnnounce("Next Stop: Stratford"); setPhase("slowing"); }
    }
    else if(S.phase==="slowing"){
      S.speed = lerp(S.speed, 0, easeOut(clamp(S.pt/3,0,1)));
      if(S.pt>3){ S.speed=0; Snd.stopTrain(); Snd.chime(520); setPhase("doors"); }
    }
    else if(S.phase==="doors"){
      S.doorOpen = easeOut(clamp(S.pt/1.2,0,1));
      S.extrasOut = clamp((S.pt-0.6)/2.2,0,1);       // other riders leave
      if(S.pt>2.8){ S.env=true; setPhase("envelope"); }
    }
    else if(S.phase==="envelope"){
      if(!S.click){
        S.click={ x:148, y:143, r:16, act:()=> openLetterAct(1, ()=> go("s2")) };
        showHint();
      }
    }
  },
  draw(){
    const bob = (S.phase==="ride"||S.phase==="slowing") ? trainBob()*(S.speed/90) : 0;
    const seatY = drawCarriage({ theme:"london", scroll:S.scroll, doorOpen:S.doorOpen, bob });

    // background riders who leave once doors open
    drawExtras(S.extrasOut);

    // our two, seated close
    const yb = 150 + bob;
    chibiSeated(122, yb, CHAR_A, { footPhase:t*3,     blink:blinkNow(0), smile:true, bob });
    chibiSeated(168, yb, CHAR_B, { footPhase:t*3+1.5, blink:blinkNow(2), smile:true, bob });

    // the mini camera she's showing off (during the chat)
    if(S.say===1 || S.say===2) miniCamera(132, 141+bob);

    // speech bubbles
    if(S.say===1) speechBubble(178, 100+bob, "is that a mini camera?");
    else if(S.say===2) speechBubble(116, 100+bob, "isn't it cute?!");

    // the envelope appears on the seat between them
    if(S.env) envelope(148, 143+bob, true);
  }
},

/* ---------- SCENE TWO: Hampton Court + chocolate ------------------ */
s2:{
  enter(){
    S.scroll=0; S.speed=0; S.doorOpen=0; S.env=false; S.bites=0; S.extrasOut=1;
    Snd.chime(600);
    setPhase("depart");
  },
  update(dt){
    if(trans.active) return;
    if(S.phase==="depart"){
      S.doorOpen = 1-easeIn(clamp(S.pt/1,0,1));
      S.speed = lerp(0,95,easeIn(clamp(S.pt/2.4,0,1)));
      if(S.pt<0.1) Snd.startTrain();
      if(S.pt>2.4){ S.doorOpen=0; setPhase("share"); }
    }
    else if(S.phase==="share"){
      S.scroll += S.speed*dt;
      // little chocolate-sharing beat with hearts
      if(S.pt>0.4 && S.pt<0.5 && S.bites===0){ S.bites=1; heartPop(150); }
      if(S.pt>1.6 && S.bites===1){ S.bites=2; heartPop(150); Snd.chime(880); }
      if(S.pt>3){ showAnnounce("Next Stop: Hampton Court"); setPhase("slowing"); }
    }
    else if(S.phase==="slowing"){
      S.scroll += S.speed*dt;
      S.speed = lerp(S.speed,0,easeOut(clamp(S.pt/3,0,1)));
      if(S.pt>3){ S.speed=0; Snd.stopTrain(); Snd.chime(520); setPhase("doors"); }
    }
    else if(S.phase==="doors"){
      S.doorOpen = easeOut(clamp(S.pt/1.2,0,1));
      if(S.pt>1.6){ S.env=true; setPhase("envelope"); }
    }
    else if(S.phase==="envelope"){
      if(!S.click){
        S.click={ x:148, y:143, r:16, act:()=> openLetterAct(2, ()=> go("s3")) };
        showHint();
      }
    }
  },
  draw(){
    const bob = (S.speed>2) ? trainBob()*(S.speed/95) : 0;
    drawCarriage({ theme:"suburb", scroll:S.scroll, doorOpen:S.doorOpen, bob });
    const yb=150+bob;

    // sharing pose: A offers, B reaches
    const sharing = S.phase==="share";
    chibiSeated(122, yb, CHAR_A, { footPhase:t*3, blink:blinkNow(0), smile:true, bob, arm: sharing?"offer":undefined });
    chibiSeated(168, yb, CHAR_B, { footPhase:t*3+1.5, blink:blinkNow(2), smile:true, bob, arm: sharing?"take":undefined });
    if(sharing) chocolate(148, yb-9, S.bites);

    if(S.env) envelope(148, 143+bob, true);
  }
},

/* ---------- SCENE THREE: the board flips to Eurostar -------------- */
s3:{
  enter(){
    S.scroll=0; S.doorOpen=0; S.flip=0; S.dest="St Pancras";
    S.trainX=W+40; S.standing=0; S.walkX=0; S.stepPhase=0;
    setPhase("arrive");
  },
  update(dt){
    if(trans.active) return;

    if(S.phase==="arrive"){
      S.doorOpen = easeOut(clamp(S.pt/1.4,0,1));
      if(S.pt>1.8){ setPhase("flip"); }
    }
    else if(S.phase==="flip"){
      // split-flap: shrink, swap label, expand
      S.flip = clamp(S.pt/1.2,0,1);
      if(S.flip>0.5 && S.dest==="St Pancras"){ S.dest="Eurostar"; Snd.chime(700); }
      if(S.pt>1.4){ setPhase("trainIn"); }
    }
    else if(S.phase==="trainIn"){
      S.trainX = lerp(W+40, 214, easeOut(clamp(S.pt/2.2,0,1)));
      if(S.pt<0.1) Snd.chime(600);
      if(S.pt>2.4){ setPhase("stand"); }
    }
    else if(S.phase==="stand"){
      S.standing = easeOut(clamp(S.pt/0.8,0,1));
      if(S.pt>1){ showHint("they take each other's hand"); setPhase("hold"); }
    }
    else if(S.phase==="hold"){
      if(S.pt>1.4){ hideHint(); setPhase("walk"); }
    }
    else if(S.phase==="walk"){
      S.stepPhase += dt*7;
      S.walkX += 34*dt;                       // stroll toward the doors
      if(S.pt>3){ Snd.stopTrain(); go("paris", 1.2); }
    }
  },
  draw(){
    const seatY = drawCarriage({
      theme:"platform", scroll:0, doorOpen:S.doorOpen,
      platformSign:(dx,dw)=> destinationBoard(dx+dw/2, 46, S.dest, S.flip, S.phase)
    });

    // Eurostar sliding in beyond the doors
    if(S.trainX<W+30){
      ctx.save(); ctx.beginPath(); ctx.rect(250,30,62,116); ctx.clip();
      modernTrain(S.trainX-90, 70);
      ctx.restore();
    }

    // characters: seated -> standing -> walking right, holding hands
    const yb=150;
    if(S.phase==="arrive"||S.phase==="flip"||S.phase==="trainIn"){
      chibiSeated(122, yb, CHAR_A, { footPhase:t*3, blink:blinkNow(0), smile:true });
      chibiSeated(168, yb, CHAR_B, { footPhase:t*3+1.5, blink:blinkNow(2), smile:true });
    } else {
      // stand, then stroll side by side with inner hands lightly clasped
      const wx = S.walkX;
      const ax = 128 + wx, bx = 150 + wx;    // 22px apart: cosy, hands meet
      const walking = S.phase==="walk";
      chibiWalk(ax, 162, CHAR_A, { stepPhase: walking?S.stepPhase:0, blink:blinkNow(0), hold:"right" });
      chibiWalk(bx, 162, CHAR_B, { stepPhase: walking?S.stepPhase+0.3:0, blink:blinkNow(2), hold:"left" });
      handClasp(ax, bx, 162);
      if(S.phase==="hold"||S.phase==="stand") heartPop((ax+bx)/2, 0.02);
    }
  }
},

/* ---------- PARIS: the Eurostar ride ------------------------------ */
paris:{
  enter(){
    S.scroll=0; S.prog=0;                    // 0..1 across the whole journey
    Snd.startPad();
    setPhase("ride");
  },
  update(dt){
    if(trans.active) return;
    S.scroll += 60*dt;
    S.prog = clamp(S.prog + dt/16, 0, 1);    // ~16s ride
    if(S.phase==="ride" && S.prog>0.86){
      showAnnounce("Bienvenue à Paris.", 4); setPhase("arriving");
    }
    else if(S.phase==="arriving" && S.prog>=1){
      go("finale", 1.4);
    }
  },
  draw(){ drawEurostarInterior(S.prog, S.scroll); }
},

/* ---------- FINALE: Paris, the tower, the letter ------------------ */
finale:{
  enter(){
    S.camX=0; S.night=0; S.tower=0; S.sparkle=0;
    S.walkX=0; S.stepPhase=0; S.env=false; S.envY=-30; S.done=false; S.away=0;
    Snd.startPad();
    setPhase("walkout");
    showAnnounce("Bienvenue à Paris.", 3);
  },
  update(dt){
    if(trans.active) return;

    if(S.phase==="walkout"){
      S.camX += 42*dt; S.stepPhase += dt*6;
      S.tower = clamp(S.pt/6,0,1);            // tower approaches
      S.night = clamp(S.pt/9,0,1);            // dusk -> night
      if(S.pt>6.5){ setPhase("stop"); }
    }
    else if(S.phase==="stop"){
      S.night = clamp(0.72 + S.pt/6, 0, 1);
      S.tower = 1;
      if(S.pt>0.6){ S.sparkle = clamp((S.pt-0.6)/1.5,0,1); }   // tower begins to sparkle
      if(S.pt>2.6 && !S.env){ S.env=true; setPhase("envelope"); }
    }
    else if(S.phase==="envelope"){
      S.sparkle=1;
      S.envY = lerp(-30, 96, easeOut(clamp(S.pt/2,0,1)));       // glowing letter floats down
      if(S.pt>2 && !S.click){
        S.click={ x:160, y:96, r:20, act:()=> openBirthdayLetter(()=> setPhase("away")) };
        showHint("open it");
      }
    }
    else if(S.phase==="away"){
      // after closing the letter, they walk off into the skyline
      S.sparkle=1;
      S.away += dt;
      S.stepPhase += dt*6;
      if(S.away>4 && !S.done){ S.done=true; showEnd(); }
    }
  },
  draw(){
    // tower sparkle keeps going even while the letter is open (draw always runs)
    if(S.sparkle>0 && Math.random()<0.6*S.sparkle){
      const hh=lerp(30,96,S.tower);
      spawn({ x:232-14+Math.random()*28, y:150-Math.random()*hh,
        vx:0, vy:0, life:0.5+Math.random()*0.4, max:0.9, fade:true, s:1,
        c: Math.random()<0.5?"#ffffff":"#ffe9a6" });
    }

    // sky: golden hour -> deep Paris night
    const sky = mixSky(
      ["#f6c88a","#f0a86a","#c77e6e","#6a5a86","#2c2f5c"],   // golden
      ["#0d1030","#141a44","#22285e","#141633","#0a0c22"],   // night
      S.night);
    bandSky(0,0,W,H,sky);

    // stars fade in with the night
    ctx.globalAlpha = clamp(S.night*1.1,0,1);
    for(let i=0;i<60;i++){
      const sx=hash(i*4.1)*W, sy=hash(i*7.3)*90;
      if((Math.sin(t*2+i)>0)) px(sx, sy, 1,1, "#fff");
    }
    ctx.globalAlpha=1;

    // parallax Paris skyline scrolling as they walk
    const camX = S.camX;
    skylineLayer(camX*0.3, 150, 26, 30, 90, "#3a3a5e", null);
    skylineLayer(camX*0.6, 150, 40, 26, 200, "#26264a", "#ffcf7a");

    // the Eiffel Tower, growing then holding
    const towerH = lerp(24, 96, S.tower);
    const towerCol = S.night>0.5 ? "#c9a94b" : "#5a4a5e";
    eiffel(232, 150, towerH, towerCol);
    // warm glow at night — a soft halo around the tower, not a hard box
    if(S.night>0.35){
      const gy = 150 - towerH*0.55, gr = towerH*0.75;
      const grad = ctx.createRadialGradient(232, gy, 2, 232, gy, gr);
      grad.addColorStop(0, `rgba(255,215,120,${0.22*S.night})`);
      grad.addColorStop(1, "rgba(255,215,120,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(232-gr, gy-gr, gr*2, gr*2);
    }

    // quay / street ground
    px(0,150,W,30,"#181a30");
    px(0,150,W,2,"#2a2c4a");
    // reflection shimmer
    ctx.globalAlpha=0.08; px(0,152,W,10,"#ffd76a"); ctx.globalAlpha=1;

    // the couple
    if(S.phase==="away"){
      // they stroll off toward the tower, gently fading into the skyline near the end
      const gx = 150 + (S.away*26);
      const fade = clamp((S.away-2.6)/1.4, 0, 1);   // last ~1.4s
      ctx.globalAlpha = 1 - fade*0.85;
      chibiWalk(gx, 168, CHAR_A, { stepPhase:S.stepPhase, blink:blinkNow(0), hold:"right" });
      chibiWalk(gx+22, 168, CHAR_B, { stepPhase:S.stepPhase+0.3, blink:blinkNow(2), hold:"left" });
      handClasp(gx, gx+22, 168);
      ctx.globalAlpha = 1;
    } else {
      const walking = S.phase==="walkout";
      const gx=150;
      chibiWalk(gx, 168, CHAR_A, { stepPhase: walking?S.stepPhase:0, blink:blinkNow(0), hold:"right" });
      chibiWalk(gx+22, 168, CHAR_B, { stepPhase: walking?S.stepPhase+0.3:0, blink:blinkNow(2), hold:"left" });
      handClasp(gx, gx+22, 168);
    }

    // the glowing envelope floating down
    if(S.env && S.phase==="envelope") envelope(160, S.envY, true);
  }
}
};

/* ============ SCENE SUPPORT PIECES =============================== */

// original transit "roundel" mark for the title
function drawRoundel(cx, cy, sc){
  const rO=18*sc, rI=11*sc;
  for(let y=-rO;y<=rO;y++) for(let x=-rO;x<=rO;x++){
    const d=Math.sqrt(x*x+y*y);
    if(d<=rO && d>=rI) px(cx+x, cy+y, 1,1, "#ffc24b");
  }
  px(cx-rO-4, cy-3, rO*2+8, 6, "#243056");   // bar
  px(cx-rO-4, cy-3, rO*2+8, 2, "#33406a");
}

// background passengers who stand and leave when the doors open
function drawExtras(out){
  const pal={hair:"#4a4453",skin:"#d8b48c",skinSh:"#bd9a72",cloth:"#6b6478",clothSh:"#4f4a5c",shoe:"#2a2530",eye:"#2a2230"};
  const spots=[40,72,220,252];
  spots.forEach((sx,i)=>{
    if(out>=1) return;
    if(out<0.2){ // still seated
      chibiSeated(sx,150,pal,{footPhase:t*2+i, blink:blinkNow(i), smile:false});
    } else {     // walking out to the right, fading
      const gx = sx + easeIn(out)*(280-sx);
      ctx.globalAlpha = 1-out;
      chibiWalk(gx, 162, pal, { stepPhase:t*8+i, blink:false });
      ctx.globalAlpha=1;
    }
  });
}

// split-flap destination board (scene 3)
function destinationBoard(cx, cy, text, flip, phase){
  const w=54,h=16;
  px(cx-w/2-1, cy-1, w+2, h+2, "#0d0b14");
  px(cx-w/2, cy, w, h, "#161320");
  px(cx-w/2, cy, w, 2, "#2a2438");
  // flip squash on the text
  let scaleY=1;
  if(phase==="flip") scaleY = Math.abs(Math.cos(flip*Math.PI));
  ctx.save();
  ctx.translate(cx, cy+h/2);
  ctx.scale(1, Math.max(0.06,scaleY));
  ctx.fillStyle="#ffc24b";
  ctx.font='6px "Press Start 2P", monospace';
  ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText(text, 0, 0);
  ctx.restore();
  // seam line
  px(cx-w/2, cy+h/2, w, 1, "#000");
}

// Eurostar interior + morphing scenery for the Paris ride
function drawEurostarInterior(prog, scroll){
  clearScreen("#e9edf2");
  // ceiling + panoramic window
  px(0,0,W,20,"#cdd4dd"); px(0,20,W,3,"#aeb7c2");
  const wy=24, wh=86;
  ctx.save(); ctx.beginPath(); ctx.rect(10,wy,W-20,wh); ctx.clip();
  morphScenery(prog, scroll);
  ctx.restore();
  // window frame
  px(10,wy,W-20,2,"#8b95a2"); px(10,wy+wh,W-20,2,"#8b95a2");
  for(let x=10;x<=W-10;x+=68) px(x,wy,3,wh,"#8b95a2");
  ctx.globalAlpha=0.1; px(16,wy+3,40,wh-6,"#fff"); ctx.globalAlpha=1;

  // sleek interior lower half
  px(0,wy+wh,W,H-(wy+wh),"#d7dde4");
  const seatY=150;
  px(0,seatY-16,W,18,"#3f4f6b");                 // modern seatbacks
  px(0,seatY-16,W,3,"#54658a");
  px(0,seatY,W,H-seatY,"#c2c9d2");
  // gold trim tray table between them
  px(136,seatY-6,44,4,"#d9b24a");
  px(136,seatY-6,44,1,"#efc766");

  // our two, sitting close, watching the view together
  const bob=Math.sin(t*2)*0.6*MOT;
  chibiSeated(132, seatY+bob, CHAR_A, { footPhase:t*2, blink:blinkNow(0), smile:true, bob });
  chibiSeated(158, seatY+bob, CHAR_B, { footPhase:t*2+1.5, blink:blinkNow(2), smile:true, bob });

  // a shared croissant + coffee on the little table
  croissant(147, seatY-8+bob);
  coffeeCup(169, seatY-7+bob);

  // occasional shared heart near golden hour
  if(prog>0.55 && Math.random()<0.02) heartPop(148);
}

// scenery that morphs EN countryside -> channel -> FR countryside -> Paris
function morphScenery(prog, scroll){
  // pick two adjacent stages and blend by drawing the incoming over outgoing
  const stages=["countryEN","channel","countryFR","paris"];
  const f = prog*(stages.length-1);
  const i = clamp(Math.floor(f),0,stages.length-2);
  const local = f-i;
  paintStage(stages[i], scroll, 1);
  if(local>0){ ctx.globalAlpha=easeInOut(local); paintStage(stages[i+1], scroll, 1); ctx.globalAlpha=1; }
}
function paintStage(stage, scroll){
  const wy=24, wh=86, base=wy+wh;
  if(stage==="countryEN"){
    bandSky(0,wy,W,wh,["#9fc0e6","#c4dcef","#dff0e0"]);
    for(let i=0;i<2;i++) cloud(((-scroll*0.2+i*150)%(W+40))-20, wy+12+i*8, 1);
    px(0,base-24,W,24,"#6fae5c");
    for(let x=-((scroll*1.2)%40);x<W;x+=40){ px(x+14,base-34,4,12,"#5a3b26"); px(x+9,base-44,14,12,"#3f8f52"); }
    // hedgerows
    px(0,base-14,W,3,"#4e8f45");
  }
  else if(stage==="channel"){
    bandSky(0,wy,W,wh,["#6a86b8","#9fb6d6","#c9d8e8"]);
    px(0,base-40,W,40,"#3f6f9e");                 // sea
    for(let x=-((scroll*2)%18);x<W;x+=18) px(x,base-26+Math.sin(x*0.3+t)*2,10,2,"#5f8fbf");
    // a hint of the tunnel mouth passing
    if((scroll%600)<120) px((100-(scroll%600))+40, base-46, 60, 46, "#20242f");
  }
  else if(stage==="countryFR"){
    // south of France: warm sky over a Mediterranean bay and rolling hills
    bandSky(0,wy,W,wh,["#bcd7ec","#dcebf2","#f2e6c8"]);
    for(let i=0;i<2;i++) cloud(((-scroll*0.2+i*150)%(W+40))-20, wy+9+i*7, 1);
    // sea band on the horizon with drifting glints
    const seaY=base-32;
    px(0,seaY,W,12,"#3f8fc4"); px(0,seaY,W,4,"#5aa6d6");
    for(let x=-((scroll*2)%16);x<W;x+=16) px(x, seaY+5+Math.round(Math.sin(x*0.3+t)), 8,1,"#8fc3e6");
    // two parallax layers of rolling hills coming up out of the bay
    for(let x=0;x<W;x++){
      const h1 = 9 + Math.sin((x+scroll*0.6)*0.03)*5 + Math.sin(x*0.011)*3;
      px(x, base-22-h1, 1, h1+8, "#6fa15a");       // far hills
    }
    for(let x=0;x<W;x++){
      const h2 = 6 + Math.sin((x+scroll*1.1)*0.05+2)*5;
      px(x, base-14-h2, 1, h2+16, "#568646");      // near hills
    }
    // lavender rows + the odd cypress on the near slope
    for(let x=-((scroll*1.2)%22);x<W;x+=22) px(x, base-8, 9,3, "#9a63ad");
    for(let x=-((scroll*1.3)%74);x<W;x+=74){ px(x+40, base-30, 3,16, "#33613b"); px(x+39, base-32, 5,4, "#3f6f45"); }
  }
  else if(stage==="paris"){
    bandSky(0,wy,W,wh,["#f2b072","#e08a6a","#8a6a90","#3c3f6c"]); // golden-hour city
    skylineLayer(scroll*0.5, base, 34, 26, 320, "#5a4a68", "#ffcf7a");
    // a distant tower cameo
    eiffel(250, base, 40, "#4a3a52");
    px(0,base-3,W,3,"#2f2a44");
  }
}

/* small effects */
function heartPop(cx, chance=1){
  if(Math.random()>chance && chance<1) return;
  spawn({x:cx, y:132, vx:(Math.random()-0.5)*6, vy:-14, g:6, life:1.1, max:1.1, fade:true, s:2, c:"#e8746b"});
}

/* ============ LETTER CONTENT ====================================== */
/* CUSTOMISE: replace this placeholder copy with your own words. */
function openLetterAct(n, next){
  const acts = {
    1:{ title:"Act I",
        body:`<p>Our Very First Date</p>
              <p>It was a decently sunny February weekend in Stratford - and my first weekend in London too. I got lost in the massive station, and I found you standing by a hotdog stand.I remember thinking you looked very kind in your grey coat. We spent 5 hours together clocking 12,000 steps as we walked around Hackney Wick, Queen Elizabeth Olympic Park (where you questioned my cute camera), and then Whitechapel. And we ended at Costa Coffee, where you bought me a flat white - which I now realise you rarely do.
 </p>
              <p>I quote myself from my diary “I think this is good”.</p>` },
    2:{ title:"Act II",
        body:`<p>Summer Comes!</p>
              <p>I feel like Hampton Court Palace was a special date for us. It felt almost like a day trip and I think that was also the first time I stayed over 2 nights in a row. We took many cute pictures that day, and sat by the topiaries and gardens basking in nice weather.</p>
              <p>Oh and that was indeed the day where regular feeding times became a thing lol. Thank you for always managing my hanger and being so patient with me x</p>` }
  };
  openLetter({ ...acts[n], onContinue: next });
}
function openBirthdayLetter(next){
  openLetter({
    finale:true,
    title:"For You",
    button:"Close",
    body:`<p>My dearest David, Happy Birthday!</p>
          <p>I hope you’ve been enjoying this website so far :) I also know you aren’t too fond of reading too many words, so I will try to keep this short and sweet.</p>

<p>Firstly, you are a great human being and I hope you’re currently surrounded by people who love you and that your birthday ushers in a year of joy, love, and all the best things in the world like chocolate, roasted peking duck, crispy chips, lots of money and you getting to manage people & go home at 3pm. 

I am so happy we met.</p> 

<p>You are a man of many layers, and I’ve enjoyed discovering and learning about your different sides. You are stoic (yes), yet deeply connected to your emotions. Measured, yet passionate. Highly independent, but still so caring and generous with the people you care about. 
And you continue to surprise me with your vocabulary, your knowledge of the world, your love for fruits, your GenZness, and your capacity to care for me in ways that no one has before.</p>  
<p>Thank you for being such a sweet boyfriend (hehe boyfriend!!), and for being there for me. I truly appreciate you so much and I want you to know that! And I hope that I can do the same for you.</p>  
<p>Again, happy birthday!!! We’ll go for more venchi chocolate when you’re back x</p>
          <p>Happy Birthday <span class="heart">❤️</span></p>`,
    onContinue: next
  });
}

/* end-of-journey card + replay */
function showEnd(){
  D.replay.classList.remove("hidden");
  showAnnounce("missing you loads,happy birthday ❤", 0);
}
D.replay.addEventListener("click", ()=>{
  D.replay.classList.add("hidden");
  Snd.stopPad(); Snd.stopTrain();
  go("title", 1);
});

/* sky mixing helper for finale (array A -> array B) */
function mixSky(A,B,f){
  const out=[]; for(let i=0;i<A.length;i++) out.push(mixHex(A[i],B[i],f)); return out;
}
function mixHex(a,b,f){
  const pa=[parseInt(a.slice(1,3),16),parseInt(a.slice(3,5),16),parseInt(a.slice(5,7),16)];
  const pb=[parseInt(b.slice(1,3),16),parseInt(b.slice(3,5),16),parseInt(b.slice(5,7),16)];
  const c=pa.map((v,i)=>Math.round(lerp(v,pb[i],f)));
  return "#"+c.map(v=>v.toString(16).padStart(2,"0")).join("");
}

/* ============ 10. TITLE FLOW & CONTROLS =========================== */
D.pressStart.addEventListener("click", ()=>{
  Snd.init(); Snd.resume();
  D.pressStart.classList.add("hidden");
  D.begin.classList.remove("hidden");
  D.begin.focus();
});
D.begin.addEventListener("click", ()=>{
  Snd.init(); Snd.resume(); Snd.setOn(true);
  D.sound.textContent="♪ on"; D.sound.setAttribute("aria-pressed","true");
  D.title.classList.add("hidden");
  go("s1", 1.1);
});
D.sound.addEventListener("click", ()=>{
  Snd.init(); Snd.resume();
  const on=!Snd.on; Snd.setOn(on);
  D.sound.textContent = on?"♪ on":"♪ off";
  D.sound.setAttribute("aria-pressed", on?"true":"false");
});

/* ============ 11. MAIN LOOP ======================================= */
setScene("title");
let last=performance.now();
function frame(now){
  let dt=(now-last)/1000; last=now; dt=Math.min(dt,0.05);
  t+=dt;

  updateParticles(dt);
  if(trans.active) updateTrans(dt);
  if(!phaseLock){ S.t+=dt; S.pt+=dt; current.update(dt); }

  current.draw();
  drawParticles();
  drawTransOverlay();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

})();
