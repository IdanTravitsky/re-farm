// Actors: the player (tank controls, data-driven weapons, getting grabbed) and
// enemies whose behaviour comes from content/actors.json:
//   chaser   fast, lunges (dogs)
//   shambler slow; its attack is a grab you can mash out of, or it bites (infected)
//   stalker  can't be killed, staggers, knocks you back, follows through doors (the Amalgam)
//   leaper   perches out of sight, drops when you pass, fast pounces
//   spitter  keeps its distance and lobs acid; weak up close
//   swarm    tiny, fast, many (rats)
//   brute    boss: slow, heavy grabs, charges, fires hp-threshold events
//   hazard   rooted growth that lashes when you get close
//   npc      friendly, scripted (Paul, Maxine, the lab team)
import { Animator, CLIPSETS, wiggle } from './anim.js';

export const DT = 1 / 30;
const D2R = Math.PI / 180;
export const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
export const fwd = (yaw) => [Math.sin(yaw * D2R), -Math.cos(yaw * D2R)];
export const yawTo = (ax, ay, bx, by) => Math.atan2(bx - ax, -(by - ay)) / D2R;
const turnTo = (a, want, rate) => { const d = angDiff(want, a.yaw); a.yaw += Math.sign(d) * Math.min(Math.abs(d), rate * DT); return d; };

class Actor {
  constructor(g, modelName, clipset, x, y, yaw) {
    this.g = g;
    this.model = g.A.models[modelName];
    if (!this.model) throw new Error('model not loaded: ' + modelName);
    this.anim = new Animator(CLIPSETS[clipset](g.A.poses[modelName] || {}));
    this.x = x; this.y = y; this.z = g.room.floor(x, y); this.yaw = yaw;
    this.scale = 1; this.hide = new Set(); this.flashT = 0; this.r = 0.3; this.wig = 1;
    this.scripted = null; this.arrived = true; this.hidden = false;
  }
  move(dx, dy) {
    const R = this.g.room;
    let moved = false;
    if (R.walkable(this.x + dx, this.y + dy)) { this.x += dx; this.y += dy; moved = true; }
    else if (R.walkable(this.x + dx, this.y)) { this.x += dx; moved = true; }
    else if (R.walkable(this.x, this.y + dy)) { this.y += dy; moved = true; }
    this.z += (R.floor(this.x, this.y) - this.z) * 0.5;       // settle onto steps smoothly
    return moved;
  }
  // cutscene control: {move_to:[x,y], run, anim, face:[x,y] or "player", yaw, at:[x,y], hidden}
  script(v) {
    this.scripted = { ...v };
    if (v.at) { this.x = v.at[0]; this.y = v.at[1]; this.z = this.g.room.floor(this.x, this.y); }
    if (v.hidden !== undefined) this.hidden = !!v.hidden;
    this.arrived = !v.move_to;
    const f = v.face === 'player' ? [this.g.player.x, this.g.player.y] : v.face;
    if (f) this.yaw = yawTo(this.x, this.y, f[0], f[1]);
    if (v.yaw !== undefined) this.yaw = v.yaw;
    if (v.anim) this.anim.play(v.anim, { restart: true, fade: 0.1 });
    if (!v.move_to && !v.anim) this.scripted = null;
  }
  updateScripted() {
    const s = this.scripted;
    if (!s) return false;
    if (!s.move_to) { this.anim.update(DT); return !!s.hold; }
    const [tx, ty] = s.move_to, d = Math.hypot(tx - this.x, ty - this.y);
    if (d < 0.2) { this.arrived = true; this.scripted = s.hold ? { hold: true } : null; if (!s.keep_anim) this.anim.play(s.then || 'idle'); return true; }
    if (!s.keep_yaw) { if (s.turn) turnTo(this, yawTo(this.x, this.y, tx, ty), s.turn); else this.yaw = yawTo(this.x, this.y, tx, ty); }   // vehicles steer
    const f0 = fwd(yawTo(this.x, this.y, tx, ty));
    const sp = (s.speed || (s.run ? 3.0 : 1.3)) * DT, f = fwd(this.yaw);
    const x0 = this.x, y0 = this.y;
    this.move(f0[0] * Math.min(sp, d), f0[1] * Math.min(sp, d));
    s.stuck = Math.hypot(this.x - x0, this.y - y0) < sp * 0.3 ? (s.stuck || 0) + DT : 0;
    if ((s.through || s.stuck > 0.5) && s.stuck > 0) { this.x = x0 + f0[0] * Math.min(sp, d); this.y = y0 + f0[1] * Math.min(sp, d); }   // cutscenes never hang on a wall
    if (!s.keep_anim) this.anim.play(s.run ? 'run' : 'walk');
    this.anim.update(DT);
    return true;
  }
  instance(ci, boost = 0) {
    const pose = wiggle(this.staticPose || this.anim.pose(), this.model, this.g.time, this.wig);
    return { model: this.model, x: this.x, y: this.y, z: this.z, yaw: this.yaw, pose, hide: this.hide, scale: this.scale,
      tint: this.flashT > 0 ? [1.3, 0.9, 0.85] : [1, 1, 1], partTint: this.partTint, roll: this.roll, lights: this.g.room.lightsFor(ci, this.x, this.y, this.z, boost, this.g.lampList?.filter(l => l.owner !== this || l.self)) };
  }
}

// ------------------------------------------------------------------ player
export class Player extends Actor {
  constructor(g, x, y, yaw) {
    super(g, g.A.content.actors.bryan.model, 'bryan', x, y, yaw);
    this.mode = 'move'; this.cool = 0; this.quickTurn = 0; this.target = null; this.hurtT = 0; this.grab = null; this.slowT = 0;
    this.anim.play('idle');
    this.updateHide();
  }
  get S() { return this.g.state; }
  weapon() { const it = this.g.A.content.items[this.S.equipped]; return it && it.weapon && this.S.has(this.S.equipped) ? it.weapon : null; }
  status() { const h = this.S.hp; return h > 66 ? 'FINE' : h > 33 ? 'CAUTION' : 'DANGER'; }
  updateHide() {
    const items = this.g.A.content.items;
    this.hide = new Set([...Object.values(items).filter(i => i.weapon).map(i => i.weapon.part), 'handset', 'cellphone']);   // phones: cutscene props only
    const w = this.weapon();
    if (w && (this.mode === 'aim' || this.mode === 'fire')) this.hide.delete(w.part);
  }
  // the bite wound spreads up the right arm as the infection grows
  updateInfection() {
    const k = Math.min(1, (this.S.infection || 0) / 100);
    if (k <= 0) { this.partTint = null; return; }
    // inflamed round the bite first, then necrotic black as it climbs ("black to the elbow")
    const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t), SORE = [1.1, 0.76, 0.8], DEAD = [0.07, 0.06, 0.07];
    const rot = (a) => a < 0.35 ? mix([1, 1, 1], SORE, a / 0.35) : mix(SORE, DEAD, (a - 0.35) / 0.65);
    // (the hand is mostly dead by the hospital, ~17%; the forearm by the lab, ~45%)
    this.partTint = { hand_r: rot(Math.min(1, k * 5)), forearm_r: rot(Math.max(0, Math.min(1, k * 3 - 0.2))), upperarm_r: rot(Math.max(0, Math.min(1, k * 2 - 0.5))) };
  }
  hurt(dmg, opts = {}) {
    if (this.mode === 'dead' || this.g.god) return;
    const S = this.S;
    S.hp -= dmg; S.stats.damage += dmg; this.flashT = 0.25;
    this.g.sfx('hurt');
    this.g.blood(this.x, this.y, this.z + 1.3, 10);
    if (opts.slow) this.slowT = opts.slow;
    if (S.hp <= 0) { S.hp = 0; this.releaseGrab(false); this.mode = 'dead'; this.anim.play('death', { restart: true }); this.g.onPlayerDeath(); }
    else if (this.mode !== 'grabbed' && !opts.light) { this.mode = 'hurt'; this.hurtT = 0.5; this.anim.play('hurt', { restart: true, fade: 0.05 }); }
    this.updateHide();
  }
  // RE2-style grab: mash any direction / action to break free before the bite lands
  grabbedBy(e) {
    if (this.mode === 'dead' || this.g.god) return false;
    this.mode = 'grabbed'; this.grab = { e, t: e.def.grab_time || 1.6, struggle: 0 };
    this.yaw = yawTo(this.x, this.y, e.x, e.y);
    this.anim.play('grabbed', { restart: true, fade: 0.05 });
    this.g.sfx('hurt');
    this.updateHide();
    return true;
  }
  releaseGrab(pushed) {
    const G = this.grab;
    this.grab = null;
    if (!G) return;
    const e = G.e;
    if (pushed) {
      const f = fwd(this.yaw);
      for (let i = 0; i < 6; i++) e.move(f[0] * 0.1, f[1] * 0.1);
      e.stagger(0.9);
      this.anim.play('push', { restart: true, fade: 0.05 });
      this.mode = 'hurt'; this.hurtT = 0.45;
    } else if (this.mode !== 'dead') { this.mode = 'move'; }
    e.releasePlayer();
  }
  heal(n) { this.S.hp = Math.min(100, this.S.hp + n); this.g.sfx('heal'); }

  update(I) {
    const g = this.g;
    this.cool = Math.max(0, this.cool - DT); this.flashT = Math.max(0, this.flashT - DT); this.slowT = Math.max(0, this.slowT - DT);
    this.updateInfection();
    if (this.updateScripted()) return;
    if (g.cinematic) {                                        // cutscenes take the controls: drop any aim or shot
      if (this.mode === 'pickup') { const f = this.pickDone; this.pickDone = null; this.mode = 'move'; f && f(); }
      if (this.mode === 'fire' || this.mode === 'aim') { this.mode = 'move'; this.updateHide(); }
      this.anim.play('idle'); this.anim.update(DT); return;
    }
    const danger = this.S.hp <= 33;
    if (this.mode === 'dead') { this.anim.update(DT); return; }
    if (this.mode === 'grabbed') {
      const G = this.grab;
      if (!G || !G.e.alive()) { this.releaseGrab(false); return; }
      if (I.leftPressed || I.rightPressed || I.upPressed || I.downPressed || I.confirmPressed || I.firePressed || I.runPressed) G.struggle += 0.2;
      G.t -= DT;
      this.anim.update(DT);
      if (G.struggle >= 1) return this.releaseGrab(true);
      if (G.t <= 0) { const e = G.e; this.releaseGrab(false); g.blood(this.x, this.y, this.z + 1.5, 16); this.hurt(e.def.bite || e.def.damage * 1.5); }
      return;
    }
    if (this.mode === 'hurt') { this.hurtT -= DT; if (this.hurtT <= 0) this.mode = 'move'; this.anim.update(DT); return; }
    if (this.mode === 'pickup') { this.anim.update(DT); if (this.anim.done()) { this.mode = 'move'; const f = this.pickDone; this.pickDone = null; f && f(); } return; }
    if (this.quickTurn > 0) {
      const step = Math.min(this.quickTurn, 900 * DT);
      this.yaw += step; this.quickTurn -= step;
      this.anim.play('turn'); this.anim.update(DT); return;
    }
    const w = this.weapon();
    if (this.mode === 'fire') {
      this.anim.update(DT);
      if (this.anim.done() || this.anim.cur !== w?.fire) { this.mode = I.aim ? 'aim' : 'move'; this.updateHide(); }
      return;
    }
    if (I.aim && w) {
      if (this.mode !== 'aim') { this.mode = 'aim'; this.target = g.pickTarget(); this.updateHide(); }
      this.anim.play(w.aim, { fade: 0.12 });
      if (I.left) { this.yaw += 110 * DT; this.target = null; }
      if (I.right) { this.yaw -= 110 * DT; this.target = null; }
      if (this.target && this.target.alive()) turnTo(this, yawTo(this.x, this.y, this.target.x, this.target.y), 420);
      if (I.firePressed && this.cool <= 0) this.fire(w);
      this.anim.update(DT);
      return;
    }
    if (this.mode === 'aim') { this.mode = 'move'; this.updateHide(); }
    const run = I.run && !danger && this.slowT <= 0;
    if (I.back && I.runPressed) { this.quickTurn = 180; return; }
    const turn = run ? 200 : 150;
    if (I.left) this.yaw += turn * DT;
    if (I.right) this.yaw -= turn * DT;
    let speed = 0, clip = danger ? 'idle_danger' : 'idle';
    if (I.up) { speed = run ? 3.3 : danger || this.slowT > 0 ? 0.9 : 1.35; clip = run ? 'run' : danger || this.slowT > 0 ? 'walk_danger' : 'walk'; }
    else if (I.back) { speed = -0.85; clip = 'back'; }
    else if (I.left || I.right) clip = 'turn';
    if (speed) { const f = fwd(this.yaw); this.move(f[0] * speed * DT, f[1] * speed * DT); }
    this.anim.play(clip, { fade: 0.15 });
    const prev = this.anim.t;
    this.anim.update(DT);
    const c = this.anim.clips[this.anim.cur];
    if (c.loop && ['walk', 'run', 'back', 'walk_danger'].includes(clip)) {
      const a = (prev % c.len) / c.len, b = (this.anim.t % c.len) / c.len;
      if ((a < 0.25 && b >= 0.25) || (a < 0.75 && b >= 0.75)) g.sfx('step', g.room.surface(this.x, this.y));
    }
    if (I.actionPressed) g.interact();
  }
  fire(w) {
    const g = this.g, S = this.S, id = S.equipped;
    let mag = S.mag[id] ?? 0;
    if (mag <= 0) {
      if (w.ammo && S.has(w.ammo)) { this.reload(w); return; }
      g.sfx('dryfire'); this.cool = 0.4; g.ui.say(['Out of ammo.']); return;
    }
    S.mag[id] = --mag; this.sync();
    g.sfx(w.sfx); this.cool = w.cooldown;
    this.anim.play(w.fire, { restart: true, fade: 0.02 });
    g.muzzle = { part: w.part, muzzle: w.muzzle, t: 2 + (w.muzzle.size > 3 ? 1 : 0) };
    g.shoot(this, w);
    this.mode = 'fire';
    S.stats.shots++;
    if (mag === 0 && w.ammo && S.has(w.ammo)) { this.reload(w, true); this.cool = Math.max(this.cool, w.cooldown + w.reload * 0.5); }
  }
  reload(w) {
    const S = this.S, id = S.equipped;
    const n = Math.min(w.mag - (S.mag[id] || 0), S.count(w.ammo));
    if (n <= 0) return;
    S.consume(w.ammo, n); S.mag[id] = (S.mag[id] || 0) + n; this.sync();
    this.g.sfx('reload'); this.cool = Math.max(this.cool, w.reload);
  }
  sync() { for (const it of this.S.inventory) if (this.g.A.content.items[it.id]?.weapon) it.n = this.S.mag[it.id] ?? it.n; }
}

// ------------------------------------------------------------------ enemies
export class Enemy extends Actor {
  constructor(g, spec) {
    const def = g.A.content.actors[spec.type];
    if (!def) throw new Error('unknown actor type ' + spec.type);
    let [x, y] = spec.through || (spec.behavior || def.behavior) === 'prop' ? spec.at : g.room.nearestWalkable(spec.at[0], spec.at[1]);
    const face = spec.face === 'player' && g.player ? [g.player.x, g.player.y] : Array.isArray(spec.face) ? spec.face : null;
    const yaw = face ? yawTo(x, y, face[0], face[1]) : (spec.yaw || 0);
    super(g, def.model, def.clips, x, y, yaw);
    Object.assign(this, { id: spec.id, type: spec.type, def, room: spec.room, B: spec.behavior || def.behavior || 'shambler' });   // a spawn may freeze its type as a posed prop (the ER crowd at the glass)
    this.hp = spec.hp ?? def.hp ?? 1; this.scale = def.scale || 1; this.r = def.radius || 0.3; this.wig = def.wiggle || 1;
    const idleByDefault = ['chaser', 'leaper', 'hazard', 'npc', 'prop', 'target'].includes(this.B);
    this.state = spec.state || (spec.face === 'player' || !idleByDefault ? 'chase' : 'idle');
    if (this.B === 'leaper' && !spec.state) this.state = 'perched';
    if (this.B === 'npc' || this.B === 'prop') this.state = 'idle';
    const pn = spec.pose || def.pose;
    if (pn) this.staticPose = g.A.poses[def.model]?.[pn] || null;
    this.poseName = pn || undefined;
    if (spec.state === 'dead') {                                    // a corpse: lie where it fell
      this.state = 'dead'; this.anim.play('death', { restart: true, fade: 0 }); this.anim.t = 99;
      if (!this.staticPose) this.staticPose = g.A.poses[def.model]?.dead || null;
    }
    this.roll = spec.roll || 0;                                      // e.g. a wreck on its side
    this.speed = spec.speed;                                        // a spawn can outpace its type (the Amalgam in the open street)
    this.hidden = this.state === 'perched';
    if (spec.z) this.z += spec.z;                                  // props set on a table or bench
    this.zOff = spec.z || 0;
    this.perchZ = spec.perch_z ?? 0;                               // leapers crouched up on a balcony, in plain sight
    if (this.state === 'perched' && this.perchZ) { this.hidden = false; this.z = g.room.floor(x, y) + this.perchZ; }
    this.wake = spec.wake_rect || null;
    this.t = 0; this.hitDone = false; this.cool = 0; this.flowT = 0; this.voice = 1 + Math.random() * 3;
    this.jitter = [(Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2];
    if (this.state !== 'dead') this.anim.play(this.state === 'rise' ? 'rise' : 'idle', { restart: true, fade: 0 });
    this.firedHp = {}; this.follow = !!spec.follow;
    this.hide = new Set(spec.hide || def.hide || []);            // e.g. a holstered pistol on an NPC
    this.lampsOff = spec.lamps === false;                         // a parked car sits dark until a script turns it on
  }
  alive() { return this.state !== 'dead' && this.state !== 'gone'; }
  hostile() { return this.alive() && this.B !== 'npc' && this.B !== 'prop' && this.state !== 'perched'; }
  chest() { return this.def.chest || 1.2; }
  snapshot() {
    return { type: this.type, room: this.room, at: [this.x, this.y], yaw: this.yaw, hp: this.hp,
      state: !this.alive() ? this.state : ['idle', 'perched'].includes(this.state) ? this.state : this.B === 'npc' ? 'idle' : 'chase',
      behavior: this.B !== (this.def.behavior || 'shambler') ? this.B : undefined,
      follow: this.follow || undefined, pose: this.poseName, lamps: this.lampsOff ? false : undefined,
      perch_z: this.state === 'perched' ? this.perchZ || undefined : undefined,
      roll: this.roll || undefined, z: this.zOff || undefined, speed: this.speed };                    // a wreck stays on its side, a wheel on its spindle
  }
  alert() { if (this.state === 'idle' && this.B !== 'npc') this.state = 'chase'; }
  stagger(t) { if (this.alive() && this.B !== 'hazard') { this.state = 'hurt'; this.t = t; this.anim.play('hurt', { restart: true, fade: 0.04 }); } }
  releasePlayer() { if (this.state === 'grab') { this.state = 'chase'; this.cool = Math.max(this.cool, 1.2); } }
  damage(n, heavy, fromYaw) {
    if (!this.hostile()) return;
    const g = this.g, def = this.def;
    g.blood(this.x, this.y, this.z + this.chest(), heavy ? 16 : 8);
    g.sfx('hit', g.pan(this.x, this.y));
    this.flashT = 0.07;
    if (!def.invulnerable) this.hp -= n;
    for (const t of def.hp_events || []) if (this.hp <= t && !this.firedHp[t]) { this.firedHp[t] = true; g.script.fire('enemy_hp', { id: this.id, hp: this.hp }); }
    if (this.state === 'gone') return;                        // a script replaced this enemy (the Swollen Man bursting)
    if (this.hp <= 0) {
      if (this.state === 'grab') g.player.releaseGrab(false);
      this.state = 'dead'; this.staticPose = null; this.poseName = undefined;          // off its meal: fall, then lie flat
      this.anim.play('death', { restart: true, fade: 0.05 }); g.onEnemyDead(this); return;
    }
    const staggers = def.invulnerable || heavy || (this.state !== 'attack' && this.state !== 'grab' && this.state !== 'spit' && !def.no_flinch);
    if (this.B === 'brute' && !heavy) return;                // the boss shrugs off pistol rounds
    if (this.B === 'target') return;                          // a shootable thing: no flinching
    if (staggers) {
      if (this.state === 'grab') g.player.releaseGrab(false);
      this.state = 'hurt';
      this.t = def.invulnerable ? (heavy ? def.stagger_heavy || 1 : def.stagger_light || 0.35) : this.B === 'swarm' ? 0.15 : 0.5;
      this.anim.play('hurt', { restart: true, fade: 0.04 });
      if (heavy) { const f = fwd(fromYaw); this.move(f[0] * 0.35, f[1] * 0.35); }
    }
  }

  update() {
    const g = this.g, p = g.player, def = this.def;
    this.flashT = Math.max(0, this.flashT - DT);
    if (this.state === 'fall') {                                   // off a ledge into the dark (the skybridge)
      this.vz -= 9.8 * DT; this.z += this.vz * DT; this.yaw += 40 * DT; this.anim.update(DT);
      if (this.z < g.room.floor(this.x, this.y) - 45) this.state = 'gone';
      return;
    }
    if (this.updateScripted()) return;
    this.anim.update(DT);
    if (this.state === 'dead' && !this.staticPose && this.anim.done()) this.staticPose = g.A.poses[def.model]?.dead || null;   // settle flat, not arms-out like a plank
    if (!this.alive() || g.cinematic || this.B === 'prop' || this.B === 'target') return;
    if (this.B === 'npc') return this.updateNpc();
    const dx = p.x - this.x, dy = p.y - this.y, dist = Math.hypot(dx, dy);
    const face = yawTo(this.x, this.y, p.x, p.y);
    this.voice -= DT;
    if (this.voice <= 0 && dist < 12 && this.state !== 'perched') {
      this.voice = 3 + Math.random() * 4;
      const v = def.voice;
      g.sfx(v === 'dog' ? (this.state === 'idle' ? 'growl' : 'bark') : v === 'stalker' ? 'moan_deep' : v === 'rat' ? 'squeak' : v === 'none' ? null : 'moan', g.pan(this.x, this.y));
    }
    switch (this.state) {
      case 'perched': {                                       // leapers: out of sight until you pass beneath
        if (dist < (def.sight || 6)) {
          this.state = 'drop'; this.hidden = false; this.t = 0;
          this.yaw = face; this.anim.play('drop', { restart: true, fade: 0 });
          g.sfx('sting'); g.fx.shake = 0.25;
        }
        return;
      }
      case 'drop': {                                          // off the perch: fall to the street, land, then come
        const fl = g.room.floor(this.x, this.y);
        if (this.z > fl + 0.01) {
          this.vz = (this.vz || 0) - 9.8 * DT; this.z = Math.max(fl, this.z + this.vz * DT);
          if (this.z === fl) { this.vz = 0; g.fx.shake = Math.max(g.fx.shake, 0.2); g.sfx('squelch', g.pan(this.x, this.y)); g.script.fire('enemy_land', { id: this.id }); }
          return;
        }
        if (this.anim.done()) this.state = 'chase';
        return;
      }
      case 'idle': {
        const inWake = this.wake && p.x >= this.wake[0] && p.x <= this.wake[2] && p.y >= this.wake[1] && p.y <= this.wake[3];
        const sees = def.sight && dist < def.sight && g.room.los(this.x, this.y, p.x, p.y, 0.45);
        if (inWake || sees) {
          this.state = 'chase'; if (def.voice === 'dog') g.sfx('bark', g.pan(this.x, this.y));
          if (this.staticPose && this.B !== 'prop') { this.staticPose = null; this.poseName = undefined; this.cool = Math.max(this.cool, 0.8); }   // gets up from its meal
        }
        if (this.B !== 'hazard') turnTo(this, face, 60);
        if (this.B === 'hazard') this.state = dist < (def.range || 1.8) + 1 ? 'chase' : 'idle';
        return;
      }
      case 'rise': if (this.anim.done()) this.state = 'chase'; return;
      case 'hurt': this.t -= DT; if (this.t <= 0) this.state = 'chase'; return;
      case 'grab': {                                          // holding the player; the bite lands in Player.update
        turnTo(this, face, 360);
        this.anim.play('bite');
        if (p.mode !== 'grabbed' || p.grab?.e !== this) { this.state = 'chase'; this.cool = 1.2; }
        return;
      }
      case 'spit': {
        this.t += DT;
        turnTo(this, face, 180);
        if (!this.hitDone && this.t >= 0.5) { this.hitDone = true; g.spawnProjectile(this, p); }
        if (this.anim.done()) { this.state = 'chase'; this.cool = def.spit_cooldown || 2.6; }
        return;
      }
      case 'charge': {
        this.t += DT;
        const f = fwd(this.yaw);
        const moved = this.move(f[0] * (def.charge_speed || 3) * DT, f[1] * (def.charge_speed || 3) * DT);
        this.anim.play('run');
        if (dist < def.range + 0.4 && !this.hitDone) { this.hitDone = true; p.hurt(def.charge_damage || def.damage); const k = 1.2 / Math.max(dist, 0.1); for (let i = 0; i < 6; i++) p.move(dx * k / 6, dy * k / 6); }
        if (!moved || this.t > 1.6) { this.state = 'chase'; this.cool = 1.0; }
        return;
      }
      case 'attack': return this.updateAttack(dist, dx, dy, face);
    }
    if (p.mode === 'dead') { this.anim.play('idle'); return; }
    // ---- chase
    this.cool = Math.max(0, this.cool - DT);
    if (this.B === 'hazard') {                                  // rooted: only lashes
      if (dist < (def.range || 1.8) && this.cool <= 0) { this.state = 'attack'; this.t = 0; this.hitDone = false; this.anim.play('attack', { restart: true, fade: 0.05 }); }
      else if (dist > (def.range || 1.8) + 2) { this.state = 'idle'; this.anim.play('idle'); }
      return;
    }
    const d = turnTo(this, face, def.turn || 120);
    if (this.B === 'spitter' && dist > 2.2 && dist < (def.spit_range || 7) && this.cool <= 0 && Math.abs(d) < 25 &&
        g.room.shotLos(this.x, this.y, this.z + 1.5, p.x, p.y, p.z + 1.2)) {
      this.state = 'spit'; this.t = 0; this.hitDone = false; this.anim.play('spit', { restart: true, fade: 0.08 });
      g.sfx('retch', g.pan(this.x, this.y));
      return;
    }
    if (this.B === 'brute' && dist > 3.5 && dist < 9 && this.cool <= 0 && Math.abs(d) < 15 && Math.random() < 0.02) {
      this.state = 'charge'; this.t = 0; this.hitDone = false; g.sfx('roar', g.pan(this.x, this.y));
      return;
    }
    if (dist < def.range && Math.abs(d) < 35 && this.cool <= 0 && p.mode !== 'grabbed') {
      this.state = 'attack'; this.t = 0; this.hitDone = false; this.anim.play('attack', { restart: true, fade: 0.08 });
      return;
    }
    // spitters hold their distance
    const keepAway = this.B === 'spitter' && dist < 4.5 && dist > 2.2;
    let tx = p.x, ty = p.y;
    if (this.B === 'swarm') { tx += this.jitter[0] * Math.min(1, dist / 3); ty += this.jitter[1] * Math.min(1, dist / 3); }
    let dir = null;
    if (dist > 1.2 && !g.room.los(this.x, this.y, p.x, p.y)) {
      if ((this.flowT -= DT) <= 0 || !g.flowField) { g.refreshFlow(); this.flowT = 0.3; }
      dir = g.room.flowDir(g.flowField, this.x, this.y);
    }
    let [mx, my] = fwd(yawTo(this.x, this.y, tx, ty));
    if (dir) { [mx, my] = dir; turnTo(this, yawTo(0, 0, dir[0], dir[1]), (def.turn || 120) * 0.5); }
    if (!keepAway && dist > def.range * 0.8 && (Math.abs(d) < 70 || dir || this.B === 'swarm')) this.move(mx * (this.speed ?? def.speed) * DT, my * (this.speed ?? def.speed) * DT);
    this.anim.play(this.B === 'chaser' || this.B === 'swarm' || this.B === 'leaper' ? 'run' : 'walk', { fade: 0.15 });
  }
  // companions: keep near the player, shoot what's hunting you (def.gun), follow through doors
  script(v) { if ('follow' in v) this.follow = !!v.follow; super.script(v); }
  updateNpc() {
    const g = this.g, p = g.player, def = this.def, gun = def.gun;
    this.cool = Math.max(0, this.cool - DT);
    if (gun) {
      let best = null, bd = gun.range || 10;
      for (const e of g.enemies) {
        if (!e.hostile() || e.state === 'idle') continue;
        const d = Math.hypot(e.x - this.x, e.y - this.y);
        if (d < bd && g.room.shotLos(this.x, this.y, this.z + 1.35, e.x, e.y, e.z + e.chest())) { bd = d; best = e; }
      }
      if (best) {
        const d = turnTo(this, yawTo(this.x, this.y, best.x, best.y), 300);
        this.anim.play('aim', { fade: 0.1 });
        if (Math.abs(d) < 8 && this.cool <= 0) {
          this.cool = gun.cooldown || 0.9; g.sfx(gun.sfx || 'pistol'); best.damage(gun.damage || 3, false, this.yaw);
          this.muzzleT = 2;                                             // frames of muzzle flash
        }
        return;
      }
    }
    if (!this.follow) { this.anim.play('idle', { fade: 0.2 }); return; }
    const dist = Math.hypot(p.x - this.x, p.y - this.y);
    if (dist < 1.8) { this.anim.play('idle', { fade: 0.2 }); return; }
    let [mx, my] = fwd(yawTo(this.x, this.y, p.x, p.y));
    if (!g.room.los(this.x, this.y, p.x, p.y)) {
      if ((this.flowT -= DT) <= 0 || !g.flowField) { g.refreshFlow(); this.flowT = 0.3; }
      const dir = g.room.flowDir(g.flowField, this.x, this.y);
      if (dir) [mx, my] = dir;
    }
    turnTo(this, yawTo(0, 0, mx, my), 240);
    const run = dist > 4;
    this.move(mx * (run ? 2.8 : 1.3) * DT, my * (run ? 2.8 : 1.3) * DT);
    this.anim.play(run ? 'run' : 'walk', { fade: 0.15 });
  }
  updateAttack(dist, dx, dy, face) {
    const g = this.g, p = g.player, def = this.def;
    this.t += DT;
    if (!this.hitDone && this.t >= def.hit_time) {
      this.hitDone = true;
      const inReach = dist < def.range + 0.5 && Math.abs(angDiff(face, this.yaw)) < 60;
      if (inReach) {
        if (def.grab && p.mode !== 'grabbed' && p.mode !== 'dead' && Math.random() < (def.grab_chance ?? 0.7) && p.grabbedBy(this)) {
          this.state = 'grab'; this.anim.play('bite', { restart: true, fade: 0.08 });
          return;
        }
        p.hurt(def.damage, { light: !!def.light_hit });                // rats nibble: no stagger, just damage
        if (def.knockback && p.mode !== 'dead') {                  // swatted away, then it lumbers after you
          const k = def.knockback / Math.max(dist, 0.1);
          for (let i = 0; i < 6; i++) p.move(dx * k / 6, dy * k / 6);
          this.cool = def.recover || 1.5;
        }
      }
    }
    if (def.lunge && this.t < 0.45) { const f = fwd(this.yaw); this.move(f[0] * def.lunge * DT, f[1] * def.lunge * DT); }
    if (this.anim.done()) { this.state = 'chase'; this.cool = Math.max(this.cool, def.cooldown || 0.9); }
  }
}
