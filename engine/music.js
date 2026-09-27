// A small tracker-style sequencer for room music (content/music/<id>.json),
// voiced like a PS1 SPU: a few synth/sampler voices, ADSR, filters, one reverb.
//
// track = {
//   bpm, steps: 16 (per bar), gain, reverb (0..1),
//   instruments: { name: { wave: sine|triangle|square|sawtooth|noise, detune: [cents..], octave,
//                          adsr: [a, d, s, r], gain, filter: {type, freq, q}, vibrato: [rate, cents] } },
//   patterns: { name: [[instrument, step, "A2 C3 E3", lengthSteps, velocity], ...] },
//   song: [patternName | [patternNames...], ...]     // one entry per bar, loops
// }
import { context } from './audio.js';

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function freq(n) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(n);
  if (!m) return 0;
  const semi = NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (parseInt(m[3]) + 1) * 12;
  return 440 * Math.pow(2, (semi - 69) / 12);
}

export class Music {
  constructor() { this.tracks = {}; this.cur = null; this.name = null; }
  register(tracks) { Object.assign(this.tracks, tracks || {}); }

  play(name) {
    const ctx = context();
    if (name === this.name) return;
    this.name = name;
    if (this.cur) { this.cur.stop(); this.cur = null; }
    if (!ctx || !name || !this.tracks[name]) return;
    this.cur = new Player(ctx, this.tracks[name]);
  }
  stop() { this.play(null); }
}

class Player {
  constructor(ctx, T) {
    this.ctx = ctx; this.T = T;
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.out.gain.exponentialRampToValueAtTime(T.gain ?? 0.5, ctx.currentTime + 2.0);    // fade in
    const dry = ctx.createGain(), wet = ctx.createGain(), rev = ctx.createConvolver();
    rev.buffer = impulse(ctx, 3.2, 2.5);
    wet.gain.value = T.reverb ?? 0.3; dry.gain.value = 1 - (T.reverb ?? 0.3) * 0.5;
    this.bus = ctx.createGain();
    this.bus.connect(dry).connect(this.out);
    this.bus.connect(rev).connect(wet).connect(this.out);
    this.out.connect(ctx.destination);
    this.stepDur = 60 / (T.bpm || 60) / 4;
    this.bar = 0; this.next = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 50);
    this.schedule();
  }
  schedule() {
    const ctx = this.ctx, T = this.T, steps = T.steps || 16;
    while (this.next < ctx.currentTime + 0.3) {
      const entry = T.song[this.bar % T.song.length];
      for (const pn of [].concat(entry)) {
        for (const [inst, step, notes, len, vel] of T.patterns[pn] || []) {
          const t = this.next + step * this.stepDur;
          for (const n of String(notes).split(/\s+/)) this.voice(T.instruments[inst], n, t, len * this.stepDur, vel ?? 0.8);
        }
      }
      this.next += steps * this.stepDur;
      this.bar++;
    }
  }
  voice(I, note, t, dur, vel) {
    if (!I) return;
    const ctx = this.ctx;
    const [a, d, s, r] = I.adsr || [0.01, 0.2, 0.6, 0.4];
    const g = ctx.createGain();
    const peak = (I.gain ?? 0.2) * vel;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(peak * s, 0.0001), t + a + d);
    g.gain.setValueAtTime(Math.max(peak * s, 0.0001), t + Math.max(dur, a + d));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, a + d) + r);
    let node = g;
    if (I.filter) {
      const f = ctx.createBiquadFilter();
      f.type = I.filter.type || 'lowpass'; f.frequency.value = I.filter.freq || 1200; f.Q.value = I.filter.q || 0.7;
      g.connect(f); node = f;
    }
    node.connect(this.bus);
    const end = t + Math.max(dur, a + d) + r + 0.05;
    if (I.wave === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx); src.loop = true;
      src.connect(g); src.start(t, Math.random()); src.stop(end);
      return;
    }
    const hz = freq(note) * Math.pow(2, I.octave || 0);
    if (!hz) return;
    for (const cents of I.detune || [0]) {
      const o = ctx.createOscillator();
      o.type = I.wave || 'sine';
      o.frequency.setValueAtTime(hz, t);
      o.detune.value = cents;
      if (I.vibrato) {
        const l = ctx.createOscillator(), lg = ctx.createGain();
        l.frequency.value = I.vibrato[0]; lg.gain.value = I.vibrato[1];
        l.connect(lg).connect(o.detune); l.start(t); l.stop(end);
      }
      o.connect(g); o.start(t); o.stop(end);
    }
  }
  stop() {
    clearInterval(this.timer);
    const ctx = this.ctx, g = this.out.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(Math.max(g.value, 0.0001), ctx.currentTime);
    g.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.5);             // fade out
    setTimeout(() => this.out.disconnect(), 1800);
  }
}

let _noise = null;
function noiseBuffer(ctx) {
  if (_noise) return _noise;
  _noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = _noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return _noise;
}
function impulse(ctx, secs, decay) {
  const n = ctx.sampleRate * secs, b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  }
  return b;
}
