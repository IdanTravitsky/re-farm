// Actors: the player (tank controls, data-driven weapons) and enemies whose
// behaviour comes from content/actors.json: chaser (dogs), shambler
// (infected), stalker (unkillable, staggers, follows you through doors).
import { Animator, CLIPSETS, wiggle } from './anim.js';

export const DT = 1 / 30;
const D2R = Math.PI / 180;
export const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
export const fwd = (yaw) => [Math.sin(yaw * D2R), -Math.cos(yaw * D2R)];
export const yawTo = (ax, ay, bx, by) => Math.atan2(bx - ax, -(by - ay)) / D2R;

class Actor {
  constructor(g, modelName, clipset, x, y, yaw) {
    this.g = g;
    this.model = g.A.models[modelName];
    this.anim = new Animator(CLIPSETS[clipset](g.A.poses[modelName] || {}));
    this.x = x; this.y = y; this.z = g.room.floor(x, y); this.yaw = yaw;
    this.scale = 1; this.hide = new Set(); this.flashT = 0; this.r = 0.3; this.wig = 1;
    this.scripted = null; this.arrived = true;
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
  // cutscene control: {move_to:[x,y], run, anim, face:[x,y], yaw}
  script(v) {
    this.scripted = { ...v };
    this.arrived = !v.move_to;
    if (v.face) this.yaw = yawTo(this.x, this.y, v.face[0], v.face[1]);
    if (v.yaw !== undefined) this.yaw = v.yaw;
    if (v.anim) this.anim.play(v.anim, { restart: true });
  }
  updateScripted() {
    const s = this.scripted;
    if (!s || !s.move_to) return false;
    const [tx, ty] = s.move_to, d = Math.hypot(tx - this.x, ty - this.y);
    if (d < 0.2) { this.arrived = true; s.move_to = null; this.anim.play(s.idle || 'idle'); return true; }
    this.yaw = yawTo(this.x, this.y, tx, ty);
    const sp = (s.run ? 3.0 : 1.3) * DT, f = fwd(this.yaw);
    this.move(f[0] * Math.min(sp, d), f[1] * Math.min(sp, d));
    this.anim.play(s.run ? 'run' : 'walk');
    this.anim.update(DT);
    return true;
  }
  instance(ci, boost = 0) {
    const pose = wiggle(this.anim.pose(), this.model, this.g.time, this.wig);
    return { model: this.model, x: this.x, y: this.y, z: this.z, yaw: this.yaw, pose, hide: this.hide, scale: this.scale,
      tint: this.flashT > 0 ? [1.3, 0.9, 0.85] : [1, 1, 1], lights: this.g.room.lightsFor(ci, this.x, this.y, this.z, boost) };
  }
}

// ------------------------------------------------------------------ player
export class Player extends Actor {
  constructor(g, x, y, yaw) {
    super(g, g.A.content.actors.bryan.model, 'bryan', x, y, yaw);
    this.mode = 'move'; this.cool = 0; this.quickTurn = 0; this.target = null; this.hurtT = 0;
    this.anim.play('idle');
    this.updateHide();
  }
  get S() { return this.g.state; }
  weapon() { const it = this.g.A.content.items[this.S.equipped]; return it && it.weapon ? it.weapon : null; }
  status() { const h = this.S.hp; return h > 66 ? 'FINE' : h > 33 ? 'CAUTION' : 'DANGER'; }
  updateHide() {
    const items = this.g.A.content.items;
    this.hide = new Set(Object.values(items).filter(i => i.weapon).map(i => i.weapon.part));
    const w = this.weapon();
    if (w && (this.mode === 'aim' || this.mode === 'fire')) this.hide.delete(w.part);
  }
  hurt(dmg) {
    if (this.mode === 'dead' || this.g.god) return;
    const S = this.S;
    S.hp -= dmg; S.stats.damage += dmg; this.flashT = 0.25;
    this.g.sfx('hurt');
    this.g.blood(this.x, this.y, this.z + 1.3, 10);
    if (S.hp <= 0) { S.hp = 0; this.mode = 'dead'; this.anim.play('death', { restart: true }); this.g.onPlayerDeath(); }
    else { this.mode = 'hurt'; this.hurtT = 0.5; this.anim.play('hurt', { restart: true, fade: 0.05 }); }
    this.updateHide();
  }
  heal(n) { this.S.hp = Math.min(100, this.S.hp + n); this.g.sfx('heal'); }

  update(I) {
    const g = this.g;
    this.cool = Math.max(0, this.cool - DT); this.flashT = Math.max(0, this.flashT - DT);
    if (this.updateScripted()) return;
    if (g.cinematic) { this.anim.play('idle'); this.anim.update(DT); return; }
    const danger = this.S.hp <= 33;
    if (this.mode === 'dead') { this.anim.update(DT); return; }
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
      if (this.anim.done()) { this.mode = I.aim ? 'aim' : 'move'; this.updateHide(); }
      return;
    }
    if (I.aim && w) {
      if (this.mode !== 'aim') { this.mode = 'aim'; this.target = g.pickTarget(); this.updateHide(); }
      this.anim.play(w.aim, { fade: 0.12 });
      if (I.left) { this.yaw += 110 * DT; this.target = null; }
      if (I.right) { this.yaw -= 110 * DT; this.target = null; }
      if (this.target && this.target.alive()) {
        const d = angDiff(yawTo(this.x, this.y, this.target.x, this.target.y), this.yaw);
        this.yaw += Math.sign(d) * Math.min(Math.abs(d), 420 * DT);
      }
      if (I.firePressed && this.cool <= 0) this.fire(w);
      this.anim.update(DT);
      return;
    }
    if (this.mode === 'aim') { this.mode = 'move'; this.updateHide(); }
    const run = I.run && !danger;
    if (I.back && I.runPressed) { this.quickTurn = 180; return; }
    const turn = run ? 200 : 150;
    if (I.left) this.yaw += turn * DT;
    if (I.right) this.yaw -= turn * DT;
    let speed = 0, clip = danger ? 'idle_danger' : 'idle';
    if (I.up) { speed = run ? 3.3 : danger ? 0.9 : 1.35; clip = run ? 'run' : danger ? 'walk_danger' : 'walk'; }
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
  reload(w, quiet = false) {
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
    let [x, y] = g.room.nearestWalkable(spec.at[0], spec.at[1]);
    const yaw = spec.face === 'player' && g.player ? yawTo(x, y, g.player.x, g.player.y) : (spec.yaw || 0);
    super(g, def.model, def.clips, x, y, yaw);
    Object.assign(this, { id: spec.id, type: spec.type, def, room: spec.room });
    this.hp = spec.hp ?? def.hp; this.scale = def.scale || 1; this.r = def.radius || 0.3; this.wig = def.wiggle || 1;
    this.state = spec.state || (spec.face === 'player' || def.behavior !== 'chaser' ? 'chase' : 'idle');
    this.wake = spec.wake_rect || null;
    this.t = 0; this.hitDone = false; this.cool = 0; this.flowT = 0; this.voice = 1 + Math.random() * 3;
    this.anim.play(this.state === 'rise' ? 'rise' : 'idle', { restart: true, fade: 0 });
  }
  alive() { return this.state !== 'dead' && this.state !== 'gone'; }
  chest() { return this.def.chest || 1.2; }
  snapshot() { return { type: this.type, room: this.room, at: [this.x, this.y], yaw: this.yaw, hp: this.hp, state: this.alive() ? (this.state === 'idle' ? 'idle' : 'chase') : this.state }; }
  alert() { if (this.state === 'idle') this.state = 'chase'; }
  damage(n, heavy, fromYaw) {
    if (!this.alive()) return;
    const g = this.g, def = this.def;
    g.blood(this.x, this.y, this.z + this.chest(), heavy ? 16 : 8);
    g.sfx('hit', g.pan(this.x, this.y));
    this.flashT = 0.07;
    if (!def.invulnerable) this.hp -= n;
    if (this.hp <= 0) { this.state = 'dead'; this.anim.play('death', { restart: true, fade: 0.05 }); g.onEnemyDead(this); return; }
    if (heavy || def.invulnerable || this.state !== 'attack') {
      this.state = 'hurt';
      this.t = def.invulnerable ? (heavy ? def.stagger_heavy || 1 : def.stagger_light || 0.35) : 0.5;
      this.anim.play('hurt', { restart: true, fade: 0.04 });
      if (heavy) { const f = fwd(fromYaw); this.move(f[0] * 0.35, f[1] * 0.35); }
    }
  }
  update() {
    const g = this.g, p = g.player, def = this.def;
    this.flashT = Math.max(0, this.flashT - DT);
    if (this.updateScripted()) return;
    this.anim.update(DT);
    if (!this.alive() || g.cinematic) return;
    const dx = p.x - this.x, dy = p.y - this.y, dist = Math.hypot(dx, dy);
    const face = yawTo(this.x, this.y, p.x, p.y);
    this.voice -= DT;
    if (this.voice <= 0 && dist < 12) { this.voice = 3 + Math.random() * 4; g.sfx(def.voice === 'dog' ? (this.state === 'idle' ? 'growl' : 'bark') : def.voice === 'stalker' ? 'moan_deep' : 'moan', g.pan(this.x, this.y)); }
    if (this.state === 'idle') {
      const inWake = this.wake && p.x >= this.wake[0] && p.x <= this.wake[2] && p.y >= this.wake[1] && p.y <= this.wake[3];
      const sees = def.sight && dist < def.sight && g.room.los(this.x, this.y, p.x, p.y, 0.45);
      if (inWake || sees) { this.state = 'chase'; if (def.voice === 'dog') g.sfx('bark', g.pan(this.x, this.y)); }
      const d = angDiff(face, this.yaw);
      this.yaw += Math.sign(d) * Math.min(Math.abs(d), 60 * DT);
      return;
    }
    if (this.state === 'rise') { if (this.anim.done()) this.state = 'chase'; return; }
    if (this.state === 'hurt') { this.t -= DT; if (this.t <= 0) this.state = 'chase'; return; }
    if (p.mode === 'dead') { this.anim.play('idle'); return; }
    if (this.state === 'attack') {
      this.t += DT;
      if (!this.hitDone && this.t >= def.hit_time) {
        this.hitDone = true;
        if (dist < def.range + 0.5 && Math.abs(angDiff(face, this.yaw)) < 60) {
          p.hurt(def.damage);
          if (def.knockback && p.mode !== 'dead') {                     // swatted away, then it lumbers after you
            const k = def.knockback / Math.max(dist, 0.1);
            for (let i = 0; i < 6; i++) p.move(dx * k / 6, dy * k / 6);
            this.cool = def.recover || 1.5;
          }
        }
      }
      if (def.lunge && this.t < 0.45) { const f = fwd(this.yaw); this.move(f[0] * def.lunge * DT, f[1] * def.lunge * DT); }
      if (this.anim.done()) { this.state = 'chase'; this.cool = Math.max(this.cool, def.cooldown || 0.9); }
      return;
    }
    // chase
    this.cool = Math.max(0, this.cool - DT);
    const d = angDiff(face, this.yaw);
    this.yaw += Math.sign(d) * Math.min(Math.abs(d), def.turn * DT);
    if (dist < def.range && Math.abs(d) < 35 && this.cool <= 0) {
      this.state = 'attack'; this.t = 0; this.hitDone = false; this.anim.play('attack', { restart: true, fade: 0.08 });
      return;
    }
    let dir = null;
    if (dist > 1.2 && !g.room.los(this.x, this.y, p.x, p.y)) {
      if ((this.flowT -= DT) <= 0 || !g.flowField) { g.refreshFlow(); this.flowT = 0.3; }
      dir = g.room.flowDir(g.flowField, this.x, this.y);
    }
    let [mx, my] = fwd(this.yaw);
    if (dir) { [mx, my] = dir; const dd = angDiff(yawTo(0, 0, dir[0], dir[1]), this.yaw); this.yaw += Math.sign(dd) * def.turn * DT * 0.5; }
    if (dist > def.range * 0.8 && (Math.abs(d) < 70 || dir)) this.move(mx * def.speed * DT, my * def.speed * DT);
    this.anim.play(def.behavior === 'chaser' ? 'run' : 'walk', { fade: 0.15 });
  }
}
