// Keyframe animation for rigid-segment models (the RE1-3 approach: per-part
// rotations keyed over time plus a root offset), with crossfades.
// Base poses come from the model scripts (data/poses.json).

const lerp = (a, b, t) => a + (b - a) * t;

export function mix(a, b, t) {                  // blend two poses
  const out = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = a[k] || [0, 0, 0], y = b[k] || [0, 0, 0];
    out[k] = [lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)];
  }
  return out;
}

export function add(base, delta, k = 1) {       // base + k * delta (additive layer)
  const out = { ...base };
  for (const [p, v] of Object.entries(delta)) {
    const b = out[p] || [0, 0, 0];
    out[p] = [b[0] + v[0] * k, b[1] + v[1] * k, b[2] + v[2] * k];
  }
  return out;
}

// clip: {len, loop, keys: [[t, pose], ...]} or {len, loop, fn: t -> pose}
export function sample(clip, t) {
  if (clip.fn) return clip.fn(clip.loop ? ((t % clip.len) + clip.len) % clip.len : Math.min(t, clip.len));
  const K = clip.keys;
  let tt = clip.loop ? ((t % clip.len) + clip.len) % clip.len : Math.min(t, clip.len);
  if (tt <= K[0][0]) return K[0][1];
  for (let i = 0; i < K.length - 1; i++) {
    if (tt <= K[i + 1][0]) {
      const u = (tt - K[i][0]) / (K[i + 1][0] - K[i][0]);
      return mix(K[i][1], K[i + 1][1], u * u * (3 - 2 * u));   // eased, like hand-keyed curves
    }
  }
  if (clip.loop) {                                             // wrap last -> first
    const last = K[K.length - 1], u = (tt - last[0]) / (clip.len - last[0]);
    return mix(last[1], K[0][1], u);
  }
  return K[K.length - 1][1];
}

export class Animator {
  constructor(clips) { this.clips = clips; this.cur = null; this.t = 0; this.prev = null; this.fade = 0; this.fadeLen = 0.15; this.speed = 1; }
  play(name, { restart = false, fade = 0.15, speed = 1 } = {}) {
    this.speed = speed;
    if (this.cur === name && !restart) return;
    if (this.cur) { this.prev = this.pose(); this.fade = fade; this.fadeLen = fade; }
    this.cur = name; this.t = 0;
  }
  update(dt) { this.t += dt * this.speed; if (this.fade > 0) this.fade = Math.max(0, this.fade - dt); }
  done() { const c = this.clips[this.cur]; return !c.loop && this.t >= c.len; }
  pose() {
    const p = sample(this.clips[this.cur], this.t);
    if (this.prev && this.fade > 0) return mix(p, this.prev, this.fade / this.fadeLen);
    return p;
  }
}

// ---------------------------------------------------------------- gaits
function gait(base, amp, { lean = 0, bob = 12, sway = 3, armSwing = 1, kneeLift = 1, legs = 1 } = {}) {
  // returns fn(phase 0..1) -> pose; phase 0 = right heel strike
  return (ph) => {
    const a = ph * Math.PI * 2;
    const s = Math.sin(a), c = Math.cos(a);
    const p = { ...base };
    const put = (k, v) => { const b = base[k] || [0, 0, 0]; p[k] = [b[0] + v[0], b[1] + v[1], b[2] + v[2]]; };
    put('thigh_r', [-24 * amp * c * legs, 0, 0]);
    put('thigh_l', [24 * amp * c * legs, 0, 0]);
    put('shin_r', [Math.max(0, 40 * amp * Math.sin(a + 1.2)) * kneeLift * legs, 0, 0]);
    put('shin_l', [Math.max(0, 40 * amp * Math.sin(a + 1.2 + Math.PI)) * kneeLift * legs, 0, 0]);
    put('foot_r', [-8 * amp * s, 0, 0]);
    put('foot_l', [8 * amp * s, 0, 0]);
    put('upperarm_r', [20 * amp * c * armSwing, 0, 0]);
    put('upperarm_l', [-20 * amp * c * armSwing, 0, 0]);
    put('forearm_r', [-12 - 10 * amp * Math.max(0, c) * armSwing, 0, 0]);
    put('forearm_l', [-12 - 10 * amp * Math.max(0, -c) * armSwing, 0, 0]);
    put('torso', [lean, 0, sway * amp * c]);
    put('hips', [0, 0, -sway * amp * c]);
    put('head', [0, 0, -sway * 0.5 * amp * c]);
    const r = base._root || [0, 0, 0];
    p._root = [r[0], r[1], r[2] - bob * amp * Math.abs(Math.sin(a))];
    return p;
  };
}

function quadGait(base, amp, speedLean = 0) {
  return (ph) => {
    const a = ph * Math.PI * 2;
    const p = { ...base };
    const put = (k, v) => { const b = base[k] || [0, 0, 0]; p[k] = [b[0] + v[0], b[1] + v[1], b[2] + v[2]]; };
    // rotary gallop: fronts together-ish, hinds together-ish, offset by half a cycle
    put('fleg_up_r', [-40 * amp * Math.cos(a), 0, 0]); put('fleg_lo_r', [30 * amp * Math.max(0, Math.sin(a)), 0, 0]);
    put('fleg_up_l', [-40 * amp * Math.cos(a + 0.5), 0, 0]); put('fleg_lo_l', [30 * amp * Math.max(0, Math.sin(a + 0.5)), 0, 0]);
    put('hleg_up_r', [40 * amp * Math.cos(a + Math.PI), 0, 0]); put('hleg_lo_r', [-25 * amp * Math.max(0, Math.sin(a + Math.PI)), 0, 0]);
    put('hleg_up_l', [40 * amp * Math.cos(a + Math.PI + 0.5), 0, 0]); put('hleg_lo_l', [-25 * amp * Math.max(0, Math.sin(a + Math.PI + 0.5)), 0, 0]);
    put('body', [8 * amp * Math.sin(a) + speedLean, 0, 0]);
    put('neck', [-8 * amp * Math.sin(a), 0, 0]);
    put('tail', [15 * amp * Math.sin(a * 2), 10 * Math.sin(a), 0]);
    p._root = [0, 0, 30 * amp * Math.abs(Math.sin(a))];
    return p;
  };
}

const K = (pairs) => pairs;

// ---------------------------------------------------------------- clip sets
export function bryanClips(P) {
  const idle = P.idle, walkBase = { ...P.idle };
  const aimS = P.aim_shotgun, aimP = P.aim_pistol;
  const breathe = (base) => ({ len: 2.6, loop: true, keys: K([[0, base], [1.3, add(base, { torso: [2, 0, 0], head: [-2, 0, 0], upperarm_r: [1, 0, 0], upperarm_l: [1, 0, 0] })]]) });
  const recoil = (base, k) => ({
    len: 0.42, loop: false, keys: K([[0, base],
      [0.05, add(base, { upperarm_r: [18 * k, 0, 0], upperarm_l: [16 * k, 0, 0], hand_r: [-20 * k, 0, 0], torso: [-6 * k, 0, 0], head: [-6 * k, 0, 0] })],
      [0.42, base]]),
  });
  const danger = { torso: [16, 0, 8], head: [10, 0, 0], upperarm_l: [-30, -10, 0], forearm_l: [-60, 0, 0] };
  return {
    idle: breathe(idle),
    idle_danger: breathe(add(idle, danger)),
    walk: { len: 1.0, loop: true, fn: (t) => gait(walkBase, 1)(t / 1.0) },
    walk_danger: { len: 1.3, loop: true, fn: (t) => gait(add(walkBase, danger), 0.7, { lean: 6, armSwing: 0.4 })(t / 1.3) },
    run: { len: 0.62, loop: true, fn: (t) => gait(add(walkBase, { forearm_r: [-60, 0, 0], forearm_l: [-60, 0, 0] }), 1.6, { lean: 12, bob: 22, armSwing: 1.2 })(t / 0.62) },
    back: { len: 1.2, loop: true, fn: (t) => gait(walkBase, 0.7)(1 - t / 1.2) },
    turn: { len: 0.9, loop: true, fn: (t) => gait(walkBase, 0.35, { armSwing: 0.3 })(t / 0.9) },
    aim_shotgun: breathe(aimS),
    aim_pistol: breathe(aimP),
    fire_shotgun: recoil(aimS, 1.5),
    fire_pistol: recoil(aimP, 0.8),
    hurt: { len: 0.5, loop: false, keys: K([[0, idle], [0.1, add(idle, { torso: [-18, 0, 10], head: [-24, 0, 0], upperarm_r: [-30, 20, 0], upperarm_l: [-30, -20, 0] })], [0.5, idle]]) },
    pickup: { len: 0.9, loop: false, keys: K([[0, idle], [0.35, add(idle, { _root: [0, 0, -330], thigh_r: [-85, 0, 0], thigh_l: [-70, 0, 0], shin_r: [120, 0, 0], shin_l: [110, 0, 0], foot_r: [-30, 0, 0], foot_l: [-35, 0, 0], torso: [38, 0, 0], upperarm_r: [-55, 0, 0], forearm_r: [-20, 0, 0] })], [0.55, add(idle, { _root: [0, 0, -330], thigh_r: [-85, 0, 0], thigh_l: [-70, 0, 0], shin_r: [120, 0, 0], shin_l: [110, 0, 0], foot_r: [-30, 0, 0], foot_l: [-35, 0, 0], torso: [38, 0, 0], upperarm_r: [-55, 0, 0], forearm_r: [-20, 0, 0] })], [0.9, idle]]) },
    death: { len: 1.6, loop: false, keys: K([[0, idle],
      [0.45, add(idle, { _root: [0, 0, -380], thigh_r: [-70, 0, 0], thigh_l: [-60, 0, 0], shin_r: [115, 0, 0], shin_l: [105, 0, 0], torso: [30, 0, 10], head: [30, 0, 0], upperarm_r: [-20, 0, 0], upperarm_l: [-20, 0, 0] })],
      [1.1, add(idle, { _root: [0, 0, -820], hips: [82, 0, 8], thigh_r: [-5, 0, 0], thigh_l: [5, 0, 0], shin_r: [20, 0, 0], torso: [6, 0, 0], head: [-20, 0, 30], upperarm_r: [-150, 30, 0], upperarm_l: [-160, -20, 0] })],
      [1.6, add(idle, { _root: [0, 0, -840], hips: [86, 0, 8], torso: [4, 0, 0], head: [-18, 0, 34], upperarm_r: [-150, 30, 0], upperarm_l: [-160, -20, 0] })]]) },
  };
}

export function zombieClips(P, heavy = false) {
  const base = P.lurch;
  const len = heavy ? 1.5 : 1.7;
  const walk = (t) => gait(base, heavy ? 0.9 : 0.75, { lean: 8, bob: 16, sway: 8, armSwing: 0.15, kneeLift: 0.6 })(t / len);
  return {
    idle: { len: 3, loop: true, keys: K([[0, base], [1.5, add(base, { head: [8, 0, -14], torso: [4, 0, -4] })]]) },
    walk: { len, loop: true, fn: walk },
    attack: { len: 1.0, loop: false, keys: K([[0, base],
      [0.35, add(base, { torso: [-12, 0, 0], head: [-18, 0, 0], upperarm_r: [-40, 0, 0], upperarm_l: [-40, 0, 0] })],
      [0.55, add(base, { torso: [30, 0, 0], head: [20, 0, 0], upperarm_r: [-30, -10, 0], upperarm_l: [-30, 10, 0], forearm_r: [30, 0, 0], forearm_l: [30, 0, 0] })],
      [1.0, base]]) },
    hurt: { len: 0.55, loop: false, keys: K([[0, base], [0.12, add(base, { torso: [-26, 0, 12], head: [-30, 0, 0], _root: [0, 60, 0] })], [0.55, base]]) },
    death: { len: 1.4, loop: false, keys: K([[0, base],
      [0.5, add(base, { _root: [0, 150, -300], torso: [-30, 0, 0], thigh_r: [-50, 0, 0], thigh_l: [-40, 0, 0], shin_r: [80, 0, 0], shin_l: [70, 0, 0] })],
      [1.4, add(base, { _root: [0, 400, -720], hips: [-84, 0, 0], torso: [-4, 0, 0], head: [-20, 0, 30], thigh_r: [10, 0, 0], thigh_l: [-5, 0, 0], shin_r: [15, 0, 0], upperarm_r: [-120, 30, 0], upperarm_l: [-160, -30, 0] })]]) },
    rise: { len: 2.2, loop: false, keys: K([[0, add(base, { _root: [0, 0, -900], hips: [80, 0, 0] })], [1.1, add(base, { _root: [0, 0, -420], thigh_r: [-70, 0, 0], thigh_l: [-70, 0, 0], shin_r: [110, 0, 0], shin_l: [110, 0, 0], torso: [40, 0, 0] })], [2.2, base]]) },
  };
}

export function dogClips(P) {
  const snarl = P.snarl, lunge = P.lunge;
  const run = quadGait({ ...snarl, head: [0, 0, 0], jaw: [-18, 0, 0], tail: [-120, 0, 0] }, 1.0, -2);
  return {
    idle: { len: 1.2, loop: true, keys: K([[0, snarl], [0.6, add(snarl, { body: [2, 0, 0], jaw: [8, 0, 0], neck: [3, 0, 0] })]]) },
    run: { len: 0.45, loop: true, fn: (t) => run(t / 0.45) },
    attack: { len: 0.7, loop: false, keys: K([[0, snarl], [0.2, add(snarl, { body: [-10, 0, 0], _root: [0, 0, -60] })], [0.38, add(lunge, { _root: [0, -300, 260] })], [0.7, snarl]]) },
    hurt: { len: 0.4, loop: false, keys: K([[0, snarl], [0.1, add(snarl, { body: [-14, 0, 12], neck: [20, 0, 0], _root: [0, 80, 0] })], [0.4, snarl]]) },
    death: { len: 1.0, loop: false, keys: K([[0, snarl], [0.4, add(snarl, { body: [0, 50, 0], _root: [0, 0, -200] })],
      [1.0, add(snarl, { body: [0, 88, 0], _root: [0, 0, -330], neck: [10, 0, 20], head: [20, 0, 0], jaw: [-30, 0, 0], tail: [-170, 0, 0] })]]) },
  };
}

// procedural wriggle for every tentacle segment
export function wiggle(pose, model, t, amt = 1) {
  const out = { ...pose };
  for (const p of model.parts) {
    if (!p.name.includes('tent')) continue;
    const k = p.name.charCodeAt(p.name.length - 1) + p.name.charCodeAt(p.name.length - 3) * 7;
    const b = out[p.name] || [0, 0, 0];
    out[p.name] = [b[0] + Math.sin(t * 3.1 + k) * 9 * amt, b[1] + Math.cos(t * 2.3 + k * 1.7) * 9 * amt, b[2]];
  }
  return out;
}
