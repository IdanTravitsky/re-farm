// Procedural sound (WebAudio). Everything is synthesised: filtered noise bursts,
// oscillators and envelopes, in the spirit of the era's low-rate sample banks.

let ctx = null, master = null, noiseBuf = null, windNode = null;

export function context() { return ctx; }

export function init() {
  if (ctx) return;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return;                                     // headless (tests): silent
  ctx = new AC({ sampleRate: 22050 });                  // PS1-ish rate
  master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function noise(t0, dur, { type = 'lowpass', f0 = 1200, f1 = 300, q = 0.7, gain = 0.6, attack = 0.002, pan = 0 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const flt = ctx.createBiquadFilter();
  flt.type = type; flt.Q.value = q;
  flt.frequency.setValueAtTime(f0, t0);
  flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const p = ctx.createStereoPanner(); p.pan.value = pan;
  src.connect(flt).connect(g).connect(p).connect(master);
  src.start(t0, Math.random());
  src.stop(t0 + dur + 0.05);
}

function tone(t0, dur, { type = 'sine', f0 = 440, f1 = null, gain = 0.3, attack = 0.005, pan = 0 } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const p = ctx.createStereoPanner(); p.pan.value = pan;
  o.connect(g).connect(p).connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

const now = () => ctx.currentTime;

export const sfx = {
  pistol() { if (!ctx) return; const t = now(); noise(t, 0.28, { f0: 5000, f1: 400, gain: 0.9 }); tone(t, 0.12, { type: 'square', f0: 180, f1: 50, gain: 0.35 }); },
  shotgun() { if (!ctx) return; const t = now(); noise(t, 0.7, { f0: 3500, f1: 120, gain: 1.0 }); tone(t, 0.3, { type: 'sawtooth', f0: 90, f1: 30, gain: 0.5 }); noise(t + 0.05, 0.9, { type: 'bandpass', f0: 600, f1: 150, q: 0.4, gain: 0.25 }); },
  dryfire() { if (!ctx) return; const t = now(); noise(t, 0.05, { type: 'highpass', f0: 3000, f1: 2000, gain: 0.3 }); },
  reload() { if (!ctx) return; const t = now(); noise(t, 0.06, { type: 'bandpass', f0: 2500, f1: 1800, q: 3, gain: 0.35 }); noise(t + 0.35, 0.08, { type: 'bandpass', f0: 1800, f1: 1200, q: 3, gain: 0.4 }); },
  step(surface, pan = 0) {
    if (!ctx) return; const t = now();
    if (surface === 1) noise(t, 0.09, { type: 'bandpass', f0: 900, f1: 500, q: 2, gain: 0.25, pan });          // wood
    else if (surface === 2) noise(t, 0.08, { type: 'lowpass', f0: 700, f1: 200, gain: 0.2, pan });            // dirt/hay
    else if (surface === 3) noise(t, 0.07, { type: 'bandpass', f0: 1400, f1: 900, q: 1.5, gain: 0.18, pan }); // asphalt
    else if (surface === 4) noise(t, 0.06, { type: 'bandpass', f0: 1900, f1: 1200, q: 2.2, gain: 0.2, pan }); // concrete
    else if (surface === 5) { noise(t, 0.22, { type: 'bandpass', f0: 1200, f1: 400, q: 0.8, gain: 0.3, pan }); noise(t + 0.03, 0.18, { type: 'highpass', f0: 3000, f1: 5000, gain: 0.08, pan }); } // water
    else if (surface === 6) noise(t, 0.05, { type: 'bandpass', f0: 2600, f1: 1800, q: 3, gain: 0.2, pan });   // tile
    else if (surface === 7) { noise(t, 0.06, { type: 'bandpass', f0: 1500, f1: 1100, q: 5, gain: 0.22, pan }); tone(t, 0.08, { type: 'triangle', f0: 320, f1: 260, gain: 0.03, pan }); } // metal
    else { noise(t, 0.16, { type: 'bandpass', f0: 2600, f1: 900, q: 1.2, gain: 0.22, pan }); }                // snow crunch
  },
  hurt() { if (!ctx) return; const t = now(); tone(t, 0.35, { type: 'sawtooth', f0: 220, f1: 110, gain: 0.25 }); noise(t, 0.2, { f0: 1500, f1: 300, gain: 0.3 }); },
  hit(pan = 0) { if (!ctx) return; const t = now(); noise(t, 0.12, { type: 'lowpass', f0: 900, f1: 150, gain: 0.5, pan }); },
  growl(pan = 0) { if (!ctx) return; const t = now(); tone(t, 0.8, { type: 'sawtooth', f0: 70, f1: 55, gain: 0.25, attack: 0.1, pan }); noise(t, 0.8, { type: 'bandpass', f0: 400, f1: 250, q: 5, gain: 0.3, attack: 0.1, pan }); },
  bark(pan = 0) { if (!ctx) return; const t = now(); tone(t, 0.14, { type: 'sawtooth', f0: 520, f1: 260, gain: 0.35, pan }); noise(t, 0.14, { type: 'bandpass', f0: 1100, f1: 600, q: 3, gain: 0.4, pan }); },
  moan(pan = 0, deep = false) { if (!ctx) return; const t = now(); const f = deep ? 60 : 95 + Math.random() * 25; tone(t, 1.6, { type: 'sawtooth', f0: f, f1: f * 0.8, gain: 0.12, attack: 0.3, pan }); noise(t, 1.6, { type: 'bandpass', f0: deep ? 300 : 500, f1: deep ? 200 : 350, q: 6, gain: 0.18, attack: 0.3, pan }); },
  door() {
    if (!ctx) return; const t = now();
    noise(t + 0.05, 0.12, { type: 'bandpass', f0: 1200, f1: 800, q: 4, gain: 0.5 });                        // latch
    tone(t + 0.3, 1.3, { type: 'sawtooth', f0: 380, f1: 520, gain: 0.05, attack: 0.2 });                      // creak
    noise(t + 0.3, 1.3, { type: 'bandpass', f0: 1800, f1: 2600, q: 18, gain: 0.25, attack: 0.2 });
    noise(t + 1.9, 0.3, { type: 'lowpass', f0: 500, f1: 80, gain: 0.7 });                                    // shut
  },
  pickup() { if (!ctx) return; const t = now(); tone(t, 0.12, { type: 'square', f0: 660, gain: 0.12 }); tone(t + 0.1, 0.25, { type: 'square', f0: 990, gain: 0.12 }); },
  cursor() { if (!ctx) return; tone(now(), 0.05, { type: 'square', f0: 1200, gain: 0.06 }); },
  confirm() { if (!ctx) return; const t = now(); tone(t, 0.08, { type: 'square', f0: 880, gain: 0.08 }); tone(t + 0.07, 0.1, { type: 'square', f0: 1320, gain: 0.08 }); },
  heal() { if (!ctx) return; const t = now(); noise(t, 0.6, { type: 'highpass', f0: 4000, f1: 6000, gain: 0.25, attack: 0.05 }); },
  hiss() { if (!ctx) return; const t = now(); noise(t, 2.2, { type: 'bandpass', f0: 3800, f1: 2600, q: 0.7, gain: 0.22, attack: 0.25 }); },   // decontamination spray
  squelch() { if (!ctx) return; const t = now(); for (let i = 0; i < 4; i++) noise(t + i * 0.18, 0.25, { type: 'lowpass', f0: 600, f1: 120, gain: 0.4 }); tone(t, 1.6, { type: 'sawtooth', f0: 50, f1: 35, gain: 0.3, attack: 0.3 }); },
  heartbeat() { if (!ctx) return; const t = now(); tone(t, 0.12, { f0: 60, f1: 40, gain: 0.5 }); tone(t + 0.22, 0.12, { f0: 55, f1: 38, gain: 0.35 }); },
  sting() { if (!ctx) return; const t = now(); tone(t, 1.8, { type: 'sawtooth', f0: 110, gain: 0.15, attack: 0.01 }); tone(t, 1.8, { type: 'sawtooth', f0: 116.5, gain: 0.15, attack: 0.01 }); noise(t, 1.2, { type: 'highpass', f0: 3000, f1: 800, gain: 0.3 }); },
  // transition variants (the door-screen sound matches the kind of passage)
  door_metal() {
    if (!ctx) return; const t = now();
    noise(t + 0.05, 0.1, { type: 'bandpass', f0: 2400, f1: 1600, q: 6, gain: 0.5 });
    tone(t + 0.3, 1.2, { type: 'square', f0: 140, f1: 120, gain: 0.05, attack: 0.3 });
    noise(t + 0.3, 1.2, { type: 'bandpass', f0: 900, f1: 1300, q: 12, gain: 0.2, attack: 0.3 });
    noise(t + 1.9, 0.45, { type: 'lowpass', f0: 1400, f1: 90, gain: 0.8 }); tone(t + 1.9, 0.5, { type: 'triangle', f0: 180, f1: 120, gain: 0.2 });
  },
  stairs() { if (!ctx) return; const t = now(); for (let i = 0; i < 8; i++) noise(t + 0.3 + i * 0.26, 0.09, { type: 'lowpass', f0: 700, f1: 180, gain: 0.5 }); },
  ladder() { if (!ctx) return; const t = now(); for (let i = 0; i < 6; i++) { noise(t + 0.3 + i * 0.34, 0.06, { type: 'bandpass', f0: 2200, f1: 1500, q: 5, gain: 0.35 }); tone(t + 0.3 + i * 0.34, 0.12, { type: 'triangle', f0: 620, f1: 540, gain: 0.08 }); } },
  elevator() { if (!ctx) return; const t = now(); tone(t + 0.1, 0.4, { f0: 880, gain: 0.12 }); tone(t + 0.3, 2.0, { type: 'sawtooth', f0: 55, f1: 58, gain: 0.12, attack: 0.4 }); noise(t + 0.3, 2.0, { type: 'lowpass', f0: 300, f1: 250, gain: 0.25, attack: 0.4 }); tone(t + 2.3, 0.5, { f0: 660, gain: 0.12 }); },
  manhole() { if (!ctx) return; const t = now(); noise(t + 0.1, 0.6, { type: 'bandpass', f0: 500, f1: 300, q: 3, gain: 0.6 }); tone(t + 0.1, 0.6, { type: 'triangle', f0: 240, f1: 200, gain: 0.15 }); for (let i = 0; i < 3; i++) noise(t + 1.2 + i * 0.3, 0.08, { type: 'bandpass', f0: 2000, f1: 1400, q: 5, gain: 0.3 }); noise(t + 2.2, 0.4, { type: 'highpass', f0: 1500, f1: 700, gain: 0.3 }); },
  gate() { if (!ctx) return; const t = now(); noise(t + 0.2, 1.4, { type: 'bandpass', f0: 2600, f1: 3400, q: 20, gain: 0.3, attack: 0.1 }); tone(t + 0.2, 1.4, { type: 'sawtooth', f0: 600, f1: 760, gain: 0.04, attack: 0.1 }); noise(t + 1.9, 0.35, { type: 'bandpass', f0: 1200, f1: 400, q: 2, gain: 0.6 }); },
  locked() { if (!ctx) return; const t = now(); for (let i = 0; i < 2; i++) noise(t + i * 0.16, 0.08, { type: 'bandpass', f0: 1500, f1: 1000, q: 5, gain: 0.5 }); },
  unlock() { if (!ctx) return; const t = now(); noise(t, 0.05, { type: 'bandpass', f0: 3000, f1: 2500, q: 5, gain: 0.4 }); noise(t + 0.2, 0.12, { type: 'bandpass', f0: 1400, f1: 900, q: 4, gain: 0.6 }); },
  squeak(pan = 0) { if (!ctx) return; const t = now(); tone(t, 0.09, { type: 'square', f0: 2600, f1: 3400, gain: 0.05, pan }); tone(t + 0.11, 0.07, { type: 'square', f0: 3000, f1: 2500, gain: 0.04, pan }); },
  retch(pan = 0) { if (!ctx) return; const t = now(); tone(t, 0.6, { type: 'sawtooth', f0: 150, f1: 70, gain: 0.2, attack: 0.1, pan }); noise(t, 0.7, { type: 'bandpass', f0: 800, f1: 300, q: 2, gain: 0.35, attack: 0.1, pan }); },
  splat(pan = 0) { if (!ctx) return; const t = now(); noise(t, 0.3, { type: 'lowpass', f0: 1400, f1: 200, gain: 0.5, pan }); noise(t + 0.05, 0.5, { type: 'highpass', f0: 3000, f1: 5000, gain: 0.12, attack: 0.05, pan }); },
  roar(pan = 0) { if (!ctx) return; const t = now(); tone(t, 1.3, { type: 'sawtooth', f0: 75, f1: 45, gain: 0.35, attack: 0.08, pan }); tone(t, 1.3, { type: 'sawtooth', f0: 79, f1: 47, gain: 0.3, attack: 0.08, pan }); noise(t, 1.3, { type: 'bandpass', f0: 600, f1: 200, q: 3, gain: 0.45, attack: 0.08, pan }); },
  shriek(pan = 0) { if (!ctx) return; const t = now(); tone(t, 0.5, { type: 'sawtooth', f0: 900, f1: 1400, gain: 0.12, pan }); noise(t, 0.5, { type: 'bandpass', f0: 2500, f1: 3500, q: 6, gain: 0.3, pan }); },
  box() { if (!ctx) return; const t = now(); noise(t, 0.15, { type: 'lowpass', f0: 900, f1: 200, gain: 0.5 }); noise(t + 0.25, 0.12, { type: 'lowpass', f0: 700, f1: 150, gain: 0.4 }); },
  combine() { if (!ctx) return; const t = now(); tone(t, 0.1, { type: 'square', f0: 520, gain: 0.1 }); tone(t + 0.1, 0.1, { type: 'square', f0: 780, gain: 0.1 }); tone(t + 0.2, 0.25, { type: 'square', f0: 1040, gain: 0.1 }); },
  engine() { if (!ctx) return; const t = now(); tone(t, 2.4, { type: 'sawtooth', f0: 38, f1: 52, gain: 0.25, attack: 0.3 }); noise(t, 2.4, { type: 'lowpass', f0: 220, f1: 380, gain: 0.35, attack: 0.3 }); },
  crash() { if (!ctx) return; const t = now(); noise(t, 1.4, { type: 'lowpass', f0: 6000, f1: 100, gain: 1.0 }); tone(t, 0.6, { type: 'sawtooth', f0: 70, f1: 25, gain: 0.5 }); for (let i = 0; i < 6; i++) noise(t + 0.3 + Math.random() * 1.2, 0.1, { type: 'highpass', f0: 4000, f1: 2500, gain: 0.3 }); },
  glass() { if (!ctx) return; const t = now(); for (let i = 0; i < 7; i++) tone(t + Math.random() * 0.3, 0.3, { type: 'triangle', f0: 3000 + Math.random() * 3000, gain: 0.06 }); noise(t, 0.4, { type: 'highpass', f0: 5000, f1: 3000, gain: 0.35 }); },
  radio() { if (!ctx) return; const t = now(); noise(t, 0.35, { type: 'bandpass', f0: 1800, f1: 1800, q: 1.5, gain: 0.2 }); tone(t + 0.3, 0.05, { type: 'square', f0: 1400, gain: 0.05 }); },
};

export function wind(on, level = 0.12) {
  if (!ctx) return;
  if (on && !windNode) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 400; f.Q.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lg = ctx.createGain(); lg.gain.value = 250;
    lfo.connect(lg).connect(f.frequency);
    const g = ctx.createGain(); g.gain.value = level;
    src.connect(f).connect(g).connect(master);
    src.start(); lfo.start();
    windNode = { src, lfo, g };
  } else if (!on && windNode) {
    windNode.g.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    const w = windNode; windNode = null;
    setTimeout(() => { w.src.stop(); w.lfo.stop(); }, 1500);
  } else if (on && windNode) {
    windNode.g.gain.setTargetAtTime(level, ctx.currentTime, 0.5);
  }
}
