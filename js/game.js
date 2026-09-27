// Gameplay: tank controls, auto-aim, enemies, items, story beats, menus.
import * as PSX from './psx.js';
import { Animator, bryanClips, zombieClips, dogClips, wiggle } from './anim.js';
import { sfx, wind, init as audioInit } from './audio.js';

const DT = 1 / 30;
const D2R = Math.PI / 180;
const OUTSIDE = 1, HOUSE = 2;
const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
const fwd = (yaw) => [Math.sin(yaw * D2R), -Math.cos(yaw * D2R)];
const yawTo = (ax, ay, bx, by) => Math.atan2(bx - ax, -(by - ay)) / D2R;

// ---------------------------------------------------------------- per-camera lights (positions in world m)
const LIGHTS = {
  C01_road: { pts: [[[17.4, -20.2, 1.9], [0.7, 0.1, 0.08], 6], [[17.6, -20.4, 1.9], [0.1, 0.2, 0.7], 6], [[-8, 10, 12], [0.2, 0.24, 0.42], 0]], amb: [0.24, 0.24, 0.3] },
  C02_yard: { pts: [[[5.2, 2.0, 6.6], [1.05, 0.6, 0.26], 12], [[-8, 10, 12], [0.2, 0.26, 0.45], 0]], amb: [0.22, 0.22, 0.3] },
  C03_porch: { pts: [[[0, 9.6, 2.4], [1.0, 0.7, 0.42], 7], [[5.2, 2.0, 6.6], [0.6, 0.35, 0.15], 12], [[-8, 2, 10], [0.22, 0.26, 0.45], 0]], amb: [0.28, 0.25, 0.28] },
  C04_barn_ext: { pts: [[[5.2, 2.0, 6.6], [0.9, 0.52, 0.22], 14], [[-8, 10, 12], [0.2, 0.26, 0.45], 0]], amb: [0.22, 0.22, 0.3] },
  C05_barn_in: { pts: [[[-16.5, 3.0, 4.1], [1.2, 0.88, 0.55], 7], [[-11, -1, 2.5], [0.25, 0.3, 0.5], 0]], amb: [0.34, 0.29, 0.26] },
  C06_barn_spray: { pts: [[[-16.5, 3.0, 4.1], [1.1, 0.8, 0.5], 7], [[-11, -1, 2.5], [0.25, 0.3, 0.5], 0]], amb: [0.3, 0.26, 0.24] },
  C07_living: { pts: [[[-4.1, 14.0, 0.9], [1.0, 0.45, 0.16], 5], [[-2.4, 14.0, 3.3], [0.55, 0.45, 0.32], 6], [[-4.2, 15.5, 1.6], [0.5, 0.35, 0.2], 3]], amb: [0.2, 0.17, 0.15] },
  C11_living_rev: { pts: [[[-4.1, 14.0, 0.9], [1.0, 0.45, 0.16], 5], [[-2.4, 14.0, 3.3], [0.55, 0.45, 0.32], 6], [[-4.2, 15.5, 1.6], [0.5, 0.35, 0.2], 3]], amb: [0.2, 0.17, 0.15] },
  C08_kitchen: { pts: [[[2.5, 14.5, 2.9], [1.0, 0.8, 0.55], 6], [[3.0, 18.5, 2.0], [0.12, 0.16, 0.3], 0]], amb: [0.22, 0.2, 0.18] },
  C10_entry: { pts: [[[2.5, 14.5, 2.9], [1.0, 0.8, 0.55], 6], [[0, 9.6, 2.4], [0.4, 0.3, 0.2], 4]], amb: [0.22, 0.2, 0.18] },
  C09_drive: { pts: [[[5.2, 2.0, 6.6], [0.7, 0.4, 0.18], 14], [[17.5, -20.3, 1.9], [0.3, 0.1, 0.25], 10], [[-8, 10, 12], [0.2, 0.26, 0.45], 0]], amb: [0.2, 0.2, 0.28] },
};
const CAM_AREA = { C01_road: 1, C02_yard: 1, C03_porch: 1, C04_barn_ext: 1, C05_barn_in: 1, C06_barn_spray: 1, C09_drive: 1, C07_living: 2, C08_kitchen: 2, C10_entry: 2, C11_living_rev: 2 };

function lightsFor(camName, x, y, z, boost = 0) {
  const L = LIGHTS[camName];
  const dirs = [], cols = [];
  for (const [p, c, range] of L.pts) {
    const d = [x - p[0], y - p[1], (z + 1.0) - p[2]];
    let k = 1;
    if (range) { const dist = Math.hypot(...d); k = Math.max(0.25, Math.min(1.25, range / (dist + 0.5))); }
    dirs.push(d); cols.push(c.map(v => v * k));
  }
  const amb = L.amb.map(v => v + boost);
  return new PSX.Lights(dirs, cols, amb);
}

// ---------------------------------------------------------------- items
const ITEMS = {
  pistol: { name: 'HANDGUN', model: 'pistol', desc: "Deputy Wilson's service pistol.", weapon: true, h: 0.22, tz: 0.0 },
  shotgun: { name: 'SHOTGUN', model: 'shotgun', desc: 'Double-barreled shotgun from the farmhouse wall.', weapon: true, h: 1.2, tz: 0.0 },
  shells: { name: 'SHELLS', model: 'shotgun_shells', desc: '12-gauge shotgun shells. Loaded two at a time.', h: 0.28, tz: 0.03 },
  herb: { name: 'GREEN HERB', model: 'herb', desc: 'A medicinal herb. Restores some health.', h: 0.42, tz: 0.2 },
  fas: { name: 'FIRST AID SPRAY', model: 'first_aid_spray', desc: 'A disinfectant spray. Fully restores health.', h: 0.3, tz: 0.11 },
  diary: { name: 'FARM DIARY', model: 'diary', desc: 'A diary left open on the kitchen table.', file: true, h: 0.36, tz: 0.02 },
};

const DIARY = [
  ['Dec 2', "Buster's off his food. Won't come out", 'of the barn. Growled at me like he', "didn't know me. Twelve years that dog", 'has slept at the foot of our bed.'],
  ['Dec 3', 'Radio says there was an accident at a', 'plant outside the city. Umbrella trucks', 'all over the county road. Martha', 'has a fever. Won\'t eat either.'],
  ['Dec 4', 'Martha bit my hand when I brought her', "the aspirin. She didn't mean it.", 'Her skin is as cold as the pump', 'handle. Buster howled all night.'],
  ['Dec 5', 'Something moves under her skin, at the', 'back of the neck. Under mine too now.', 'It itches like crazy.', 'I am so hungry.'],
];

// ---------------------------------------------------------------- actors
class Actor {
  constructor(game, model, clips, x, y, yaw, area) {
    this.g = game; this.model = model; this.anim = new Animator(clips);
    this.x = x; this.y = y; this.z = game.grid.floor(x, y); this.yaw = yaw; this.area = area;
    this.scale = 1; this.hide = new Set(); this.tint = [1, 1, 1]; this.flash = 0; this.r = 0.3;
  }
  move(dx, dy) {
    const G = this.g.grid;
    let moved = false;
    if (G.walkable(this.x + dx, this.y + dy, this.area)) { this.x += dx; this.y += dy; moved = true; }
    else if (G.walkable(this.x + dx, this.y, this.area)) { this.x += dx; moved = true; }
    else if (G.walkable(this.x, this.y + dy, this.area)) { this.y += dy; moved = true; }
    const fz = G.floor(this.x, this.y);
    this.z += (fz - this.z) * 0.5;                    // settle onto steps smoothly
    return moved;
  }
  instance(camName, boost = 0) {
    const pose = wiggle(this.anim.pose(), this.model, this.g.time, this.wig || 1);
    const t = this.flash > 0 ? [1.3, 0.9, 0.85] : this.tint;
    return { model: this.model, x: this.x, y: this.y, z: this.z, yaw: this.yaw, pose, hide: this.hide, scale: this.scale, tint: t,
      lights: lightsFor(camName, this.x, this.y, this.z, boost) };
  }
}

class Player extends Actor {
  constructor(game, x, y, yaw) {
    super(game, game.A.models.bryan, bryanClips(game.A.poses.bryan), x, y, yaw, OUTSIDE);
    this.hp = 100; this.mode = 'move'; this.equipped = 'pistol'; this.pistolAmmo = 13; this.loaded = 0; this.shells = 0;
    this.inv = [{ id: 'pistol', n: 13 }];
    this.anim.play('idle'); this.cool = 0; this.stepPhase = 0; this.target = null; this.quickTurn = 0;
    this.updateHide();
  }
  status() { return this.hp > 66 ? 'FINE' : this.hp > 33 ? 'CAUTION' : 'DANGER'; }
  updateHide() {
    this.hide = new Set(['shotgun', 'pistol']);
    if (this.equipped && (this.mode === 'aim' || this.mode === 'fire')) this.hide.delete(this.equipped);
  }
  hurt(dmg, fromX, fromY) {
    if (this.mode === 'dead') return;
    this.hp -= dmg; this.flash = 0.25; sfx.hurt();
    this.g.blood(this.x, this.y, this.z + 1.3, 10);
    if (this.hp <= 0) { this.hp = 0; this.mode = 'dead'; this.anim.play('death', { restart: true }); this.g.onDeath(); }
    else { this.mode = 'hurt'; this.hurtT = 0.5; this.anim.play('hurt', { restart: true, fade: 0.05 }); }
    this.updateHide();
  }
  heal(n) { this.hp = Math.min(100, this.hp + n); sfx.heal(); }
  update(I) {
    const g = this.g;
    this.cool = Math.max(0, this.cool - DT); this.flash = Math.max(0, this.flash - DT);
    const danger = this.hp <= 33;
    if (this.mode === 'dead') { this.anim.update(DT); return; }
    if (this.mode === 'hurt') { this.hurtT -= DT; if (this.hurtT <= 0) this.mode = 'move'; this.anim.update(DT); return; }
    if (this.mode === 'pickup') { this.anim.update(DT); if (this.anim.done()) { this.mode = 'move'; this.pickDone && this.pickDone(); } return; }
    if (this.quickTurn > 0) {                                  // RE3-style 180
      const step = Math.min(this.quickTurn, 900 * DT);
      this.yaw += step; this.quickTurn -= step;
      this.anim.play('turn'); this.anim.update(DT); return;
    }
    const aiming = I.aim && this.equipped && this.mode !== 'fire';
    if (this.mode === 'fire') {
      this.anim.update(DT);
      if (this.anim.done()) { this.mode = I.aim ? 'aim' : 'move'; this.updateHide(); }
      return;
    }
    if (aiming) {
      if (this.mode !== 'aim') { this.mode = 'aim'; this.target = g.pickTarget(); this.updateHide(); }
      const clip = this.equipped === 'shotgun' ? 'aim_shotgun' : 'aim_pistol';
      this.anim.play(clip, { fade: 0.12 });
      if (I.left) { this.yaw += 110 * DT; this.target = null; }
      if (I.right) { this.yaw -= 110 * DT; this.target = null; }
      if (this.target && this.target.alive()) {
        const want = yawTo(this.x, this.y, this.target.x, this.target.y);
        const d = angDiff(want, this.yaw);
        this.yaw += Math.sign(d) * Math.min(Math.abs(d), 420 * DT);
      }
      if (I.firePressed && this.cool <= 0) this.fire();
      this.anim.update(DT);
      return;
    }
    if (this.mode === 'aim') { this.mode = 'move'; this.updateHide(); }
    // tank controls
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
    const prevPh = this.anim.t;
    this.anim.update(DT);
    // footsteps on the gait's two contacts
    const c = this.anim.clips[this.anim.cur];
    if (c.loop && (clip === 'walk' || clip === 'run' || clip === 'back' || clip === 'walk_danger')) {
      const a = (prevPh % c.len) / c.len, b = (this.anim.t % c.len) / c.len;
      if ((a < 0.25 && b >= 0.25) || (a < 0.75 && b >= 0.75)) sfx.step(g.grid.surface(this.x, this.y));
    }
    if (I.actionPressed) g.interact();
  }
  fire() {
    const g = this.g;
    const w = this.equipped;
    if (w === 'pistol') {
      if (this.pistolAmmo <= 0) { sfx.dryfire(); this.cool = 0.4; g.say(['Out of ammo.']); return; }
      this.pistolAmmo--; this.syncInv(); sfx.pistol(); this.cool = 0.38;
      this.anim.play('fire_pistol', { restart: true, fade: 0.02 });
      g.muzzle = { part: 'pistol', local: [0, -200, 20], t: 2 };
      g.shoot(this, 16, 20, () => 14, false);
    } else if (w === 'shotgun') {
      if (this.loaded <= 0) {
        if (this.shells <= 0) { sfx.dryfire(); this.cool = 0.5; g.say(['No shells left.']); return; }
        const n = Math.min(2, this.shells); this.shells -= n; this.loaded = n; this.syncInv(); sfx.reload(); this.cool = 1.1; return;
      }
      this.loaded--; sfx.shotgun(); this.cool = 1.0;
      this.anim.play('fire_shotgun', { restart: true, fade: 0.02 });
      g.muzzle = { part: 'shotgun', local: [0, -860, 50], t: 3 };
      g.shoot(this, 9, 26, (d) => (d < 3 ? 60 : d < 6 ? 40 : 20), true);
      if (this.loaded === 0 && this.shells > 0) { const n = Math.min(2, this.shells); this.shells -= n; this.loaded = n; this.syncInv(); setTimeout(() => sfx.reload(), 500); this.cool = 1.5; }
    }
    this.mode = 'fire';
    g.stats.shots++;
  }
  syncInv() {
    for (const it of this.inv) {
      if (it.id === 'pistol') it.n = this.pistolAmmo;
      if (it.id === 'shells') it.n = this.shells;
      if (it.id === 'shotgun') it.n = this.loaded;
    }
    this.inv = this.inv.filter(it => it.id !== 'shells' || it.n > 0);
  }
}

class Enemy extends Actor {
  constructor(game, kind, x, y, yaw, area) {
    const M = game.A.models, P = game.A.poses;
    const spec = {
      dog: { m: M.dog, clips: dogClips(P.dog), hp: 45, speed: 4.1, range: 1.5, dmg: 12, hitT: 0.38, turn: 360, scale: 1.2, r: 0.4 },
      farmwife: { m: M.farmwife, clips: zombieClips(P.farmwife), hp: 70, speed: 0.72, range: 1.0, dmg: 15, hitT: 0.55, turn: 90, scale: 1, r: 0.3 },
      farmer: { m: M.farmer, clips: zombieClips(P.farmer), hp: 75, speed: 0.68, range: 1.0, dmg: 17, hitT: 0.55, turn: 85, scale: 1, r: 0.32 },
      amalgam: { m: M.amalgam, clips: zombieClips(P.amalgam, true), hp: 9999, speed: 1.45, range: 1.5, dmg: 22, hitT: 0.55, turn: 110, scale: 1.05, r: 0.55 },
    }[kind];
    [x, y] = game.grid.nearestWalkable(x, y, area);
    super(game, spec.m, spec.clips, x, y, yaw, area);
    Object.assign(this, { kind, spec, hp: spec.hp, scale: spec.scale, r: spec.r });
    this.state = 'idle'; this.t = 0; this.hitDone = false; this.flowT = 0; this.voice = 1 + Math.random() * 3;
    this.anim.play('idle');
    this.wig = kind === 'amalgam' ? 1.6 : 1;
  }
  alive() { return this.state !== 'dead' && this.state !== 'gone'; }
  chest() { return this.kind === 'dog' ? 0.6 : this.kind === 'amalgam' ? 1.3 : 1.2; }
  damage(n, heavy) {
    if (!this.alive()) return;
    const g = this.g;
    g.blood(this.x, this.y, this.z + (this.kind === 'dog' ? 0.6 : 1.2), heavy ? 16 : 8);
    sfx.hit(g.pan(this.x, this.y));
    this.flash = 0.07;
    if (this.kind !== 'amalgam') this.hp -= n;
    if (this.hp <= 0) { this.state = 'dead'; this.anim.play('death', { restart: true, fade: 0.05 }); g.onEnemyDead(this); return; }
    if (heavy || this.kind === 'amalgam' || this.state !== 'attack') {
      this.state = 'hurt'; this.t = this.kind === 'amalgam' ? (heavy ? 1.0 : 0.35) : 0.5;
      this.anim.play('hurt', { restart: true, fade: 0.04 });
      if (heavy) { const f = fwd(this.g.player.yaw); this.move(f[0] * 0.35, f[1] * 0.35); }
    }
  }
  update() {
    const g = this.g, p = g.player, s = this.spec;
    this.flash = Math.max(0, this.flash - DT);
    this.anim.update(DT);
    if (!this.alive()) return;
    if (this.area !== p.area) { this.anim.play('idle'); return; }
    const dx = p.x - this.x, dy = p.y - this.y, dist = Math.hypot(dx, dy);
    const face = yawTo(this.x, this.y, p.x, p.y);
    this.voice -= DT;
    if (this.voice <= 0 && dist < 12) {
      this.voice = 3 + Math.random() * 4;
      if (this.kind === 'dog') (this.state === 'idle' ? sfx.growl : sfx.bark)(g.pan(this.x, this.y));
      else sfx.moan(g.pan(this.x, this.y), this.kind === 'amalgam');
    }
    if (this.state === 'idle') {
      if (this.kind === 'dog') {
        const see = (dist < 8 && g.grid.los(this.x, this.y, p.x, p.y, this.area, 0.45)) || (p.x < -12.3 && p.y > -2 && p.y < 8);
        if (see) { this.state = 'chase'; sfx.bark(g.pan(this.x, this.y)); }
      } else this.state = 'chase';
      this.yaw += Math.sign(angDiff(face, this.yaw)) * Math.min(Math.abs(angDiff(face, this.yaw)), 60 * DT);
      return;
    }
    if (this.state === 'rise') { if (this.anim.done()) this.state = 'chase'; return; }
    if (this.state === 'hurt') { this.t -= DT; if (this.t <= 0) this.state = 'chase'; return; }
    if (p.mode === 'dead') { this.anim.play('idle'); return; }
    if (this.state === 'attack') {
      this.t += DT;
      if (!this.hitDone && this.t >= s.hitT) {
        this.hitDone = true;
        const ad = Math.abs(angDiff(face, this.yaw));
        if (dist < s.range + 0.5 && ad < 60) {
          p.hurt(s.dmg, this.x, this.y);
          if (this.kind === 'amalgam' && p.mode !== 'dead') {        // swatted away, then it lumbers after you
            const k = 0.9 / Math.max(dist, 0.1);
            for (let i = 0; i < 6; i++) p.move(dx * k / 6, dy * k / 6);
            this.cool = 1.6;
          }
        }
      }
      if (this.kind === 'dog' && this.t < 0.45) { const f = fwd(this.yaw); this.move(f[0] * 3 * DT, f[1] * 3 * DT); }
      if (this.anim.done()) { this.state = 'chase'; this.cool = Math.max(this.cool || 0, this.kind === 'dog' ? 0.6 : 0.9); }
      return;
    }
    // chase
    this.cool = Math.max(0, (this.cool || 0) - DT);
    const d = angDiff(face, this.yaw);
    this.yaw += Math.sign(d) * Math.min(Math.abs(d), s.turn * DT);
    if (dist < s.range && Math.abs(d) < 35 && this.cool <= 0) {
      this.state = 'attack'; this.t = 0; this.hitDone = false; this.anim.play('attack', { restart: true, fade: 0.08 });
      return;
    }
    let dir = null;
    if (dist > 1.2 && !g.grid.los(this.x, this.y, p.x, p.y, this.area)) {
      if (this.flowT <= 0 || !g.flowField) { g.refreshFlow(); this.flowT = 0.3; }
      this.flowT -= DT;
      dir = g.flowField && g.grid.flowDir(g.flowField, this.x, this.y, this.area);
    }
    const f = fwd(this.yaw);
    let mvx = f[0], mvy = f[1];
    if (dir) { mvx = dir[0]; mvy = dir[1]; this.yaw += Math.sign(angDiff(yawTo(0, 0, dir[0], dir[1]), this.yaw)) * s.turn * DT * 0.5; }
    if (dist > s.range * 0.8 && (Math.abs(d) < 70 || dir)) this.move(mvx * s.speed * DT, mvy * s.speed * DT);
    this.anim.play(this.kind === 'dog' ? 'run' : 'walk', { fade: 0.15 });
  }
}

// ---------------------------------------------------------------- the game
export class Game {
  constructor(assets, canvas) {
    this.A = assets; this.grid = assets.grid; this.font = assets.font;
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.fb = new PSX.Frame(320, 240);
    this.img = this.ctx.createImageData(320, 240);
    this.icons = this.makeIcons();
    this.state = 'title'; this.t = 0; this.time = 0;
    this.newGame();
  }
  newGame() {
    const [sx, sy] = this.A.level.spawns.outside;
    this.player = new Player(this, sx, sy, yawTo(sx, sy, 8, 2));
    this.enemies = [new Enemy(this, 'dog', -18.2, 4.0, 90, OUTSIDE)];
    this.cam = -1; this.updateCamera();
    this.present = new Set(['shotgun', 'shells', 'herb', 'diary', 'fas0', 'fas1']);
    this.flags = {}; this.msg = null; this.particles = []; this.muzzle = null; this.shake = 0; this.fade = 0; this.flowField = null;
    this.stats = { shots: 0, start: performance.now() };
    this.objects = this.makeObjects();
  }
  // ---------------------------------------------------------- objects & interaction
  makeObjects() {
    const give = (id, n, msg) => () => { this.take(id, n); this.say(msg); };
    return [
      { area: HOUSE, x: -4.35, y: 14.0, r: 1.7, when: () => this.present.has('shotgun'), ask: 'A double-barreled shotgun hangs over the fireplace. Will you take it?', take: () => { this.present.delete('shotgun'); this.take('shotgun', 0); this.flags.shotgun = true; this.say(['Took the SHOTGUN.', "It's empty. There must be shells somewhere..."]); } },
      { area: HOUSE, x: -4.35, y: 14.0, r: 1.7, when: () => !this.present.has('shotgun'), text: ['The fire is burning down to embers.'] },
      { area: HOUSE, x: 2.0, y: 16.95, r: 1.6, when: () => this.present.has('shells'), ask: 'A drawer left open. SHOTGUN SHELLS inside! Will you take them?', take: () => { this.present.delete('shells'); this.player.shells += 8; this.take('shells', 0); this.player.syncInv(); this.say(['Took 8 SHOTGUN SHELLS.', 'Nowhere near the gun, naturally.']); } },
      { area: HOUSE, x: 4.05, y: 17.72, r: 1.7, when: () => this.present.has('herb'), ask: 'A potted GREEN HERB on the shelf. Will you take it?', take: () => { this.present.delete('herb'); give('herb', 1, ['Took the GREEN HERB.'])(); } },
      { area: HOUSE, x: 2.72, y: 14.77, r: 1.8, when: () => this.present.has('diary'), ask: 'A diary lies open on the table. Will you take it?', take: () => { this.present.delete('diary'); this.take('diary', 1); this.readFile(); } },
      { area: HOUSE, x: 4.85, y: 13.6, r: 1.3, text: ['The phone. Dead. Not even a dial tone.'] },
      { area: HOUSE, x: -2.9, y: 17.9, r: 1.3, text: ['Snow is piling up against the window.'] },
      { area: HOUSE, x: 0.0, y: 10.15, r: 1.6, door: 'out' },
      { area: OUTSIDE, x: 0.0, y: 9.7, r: 1.25, door: 'in' },
      { area: OUTSIDE, x: -14.9, y: 1.1, r: 1.45, when: () => this.present.has('fas0'), ask: 'A crate. A FIRST AID SPRAY sits on top. Will you take it?', take: () => { this.present.delete('fas0'); give('fas', 1, ['Took the FIRST AID SPRAY.'])(); } },
      { area: OUTSIDE, x: -14.9, y: 1.1, r: 1.45, when: () => !this.present.has('fas0') && this.present.has('fas1'), ask: 'Another FIRST AID SPRAY. Will you take it?', take: () => { this.present.delete('fas1'); give('fas', 1, ['Took the FIRST AID SPRAY.'])(); } },
      { area: OUTSIDE, x: -18.3, y: 5.2, r: 1.4, text: ["A ladder up to the hay loft.", "Nothing up there I need."] },
      { area: OUTSIDE, x: -10.1, y: -2.0, r: 1.4, text: ['A doghouse. The chain has been snapped clean through.'] },
      { area: OUTSIDE, x: 9.5, y: 9.0, r: 2.6, text: ["The family's pickup. No keys.", "Even if there were, the snow's too deep."] },
      { area: OUTSIDE, x: 7.2, y: -13.2, r: 1.3, text: ['The mailbox is stuffed with unopened mail.'] },
      { area: OUTSIDE, x: 17.5, y: -19.3, r: 2.4, text: ["Deputy Wilson's cruiser. He's dead.", "The lights are still going. Nobody's coming."] },
      { area: OUTSIDE, x: -8.1, y: 4.3, r: 1.3, text: ['The water trough has frozen solid.'] },
      { area: OUTSIDE, x: 7.5, y: 12.0, r: 1.3, text: ['An axe buried in the chopping block. It won\'t budge.'] },
    ];
  }
  interact() {
    const p = this.player;
    let best = null, bd = 1e9;
    for (const o of this.objects) {
      if (o.area !== p.area || (o.when && !o.when())) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d > o.r) continue;
      if (Math.abs(angDiff(yawTo(p.x, p.y, o.x, o.y), p.yaw)) > 75 && d > 0.6) continue;
      if (d < bd) { bd = d; best = o; }
    }
    if (!best) return;
    sfx.confirm();
    if (best.door) return this.startDoor(best.door);
    if (best.text) return this.say(best.text);
    if (best.ask) {
      if (this.player.inv.length >= 6 && !this.player.inv.find(i => i.id === 'shells')) return this.say(['There is no more room to carry anything.']);
      this.ask(best.ask, () => { p.mode = 'pickup'; p.anim.play('pickup', { restart: true }); p.pickDone = () => { sfx.pickup(); best.take(); }; });
    }
  }
  take(id, n) {
    const inv = this.player.inv;
    const it = inv.find(i => i.id === id);
    if (it && (id === 'herb' || id === 'fas')) it.n += n;
    else if (!it) inv.push({ id, n });
    this.player.syncInv();
  }
  // ---------------------------------------------------------- combat
  pickTarget() {
    const p = this.player;
    let best = null, bs = 1e9;
    for (const e of this.enemies) {
      if (!e.alive() || e.area !== p.area) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      const a = Math.abs(angDiff(yawTo(p.x, p.y, e.x, e.y), p.yaw));
      if (d > 16 || a > 80 || !this.grid.shotLos(p.x, p.y, p.z + 1.35, e.x, e.y, e.z + e.chest())) continue;
      const s = d + a / 20;
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }
  shoot(p, range, cone, dmgAt, spread) {
    let hitAny = false;
    for (const e of this.enemies) if (e.state === 'idle' && e.area === p.area && Math.hypot(e.x - p.x, e.y - p.y) < 22) e.state = 'chase';   // gunfire carries
    const targets = this.enemies.filter(e => e.alive() && e.area === p.area)
      .map(e => ({ e, d: Math.hypot(e.x - p.x, e.y - p.y), a: Math.abs(angDiff(yawTo(p.x, p.y, e.x, e.y), p.yaw)) }))
      .filter(t => t.d < range && t.a < cone && this.grid.shotLos(p.x, p.y, p.z + 1.35, t.e.x, t.e.y, t.e.z + t.e.chest()))
      .sort((a, b) => a.d - b.d);
    for (const t of spread ? targets : targets.slice(0, 1)) { t.e.damage(dmgAt(t.d), spread && t.d < 6); hitAny = true; }
    return hitAny;
  }
  blood(x, y, z, n) {
    for (let i = 0; i < n; i++) {
      this.particles.push({ x, y, z, vx: (Math.random() - 0.5) * 2.2, vy: (Math.random() - 0.5) * 2.2, vz: Math.random() * 2.2, t: 0.5 + Math.random() * 0.4 });
    }
  }
  refreshFlow() { this.flowField = this.grid.flow(this.player.x, this.player.y, this.player.area); }
  pan(x, y) {
    const c = this.A.cams[this.cam].cam.project(x, y, 1);
    return c ? Math.max(-0.8, Math.min(0.8, (c[0] - 160) / 200)) : 0;
  }
  onEnemyDead(e) {
    this.stats.kills = (this.stats.kills || 0) + 1;
    if ((e.kind === 'farmwife' || e.kind === 'farmer') && !this.flags.fused) {
      const pair = this.enemies.filter(x => x.kind === 'farmwife' || x.kind === 'farmer');
      if (pair.every(x => !x.alive())) this.fusionT = 2.2;
      else if (!this.fusionT) this.fusionT = 14;            // one down: the other drags it in soon enough
    }
  }
  onDeath() { this.deathT = 0; }
  // ---------------------------------------------------------- story
  story() {
    const p = this.player;
    if (this.flags.shotgun && p.area === OUTSIDE && !this.flags.ambush) {
      this.flags.ambush = true;
      const w = new Enemy(this, 'farmwife', -2.4, 4.6, 0, OUTSIDE), f = new Enemy(this, 'farmer', 3.4, 4.9, 0, OUTSIDE);
      for (const e of [w, f]) { e.yaw = yawTo(e.x, e.y, p.x, p.y); e.state = 'idle'; this.enemies.push(e); }
      sfx.sting(); this.shake = 0.3;
      this.say(['The couple from the house...', "They're coming this way!"]);
    }
    if (this.fusionT > 0 && !this.flags.fused) {
      this.fusionT -= DT;
      if (this.fusionT <= 0) this.fuse();
    }
    if (this.flags.fused && p.area === OUTSIDE && p.x > 12 && p.y < -13.4 && !this.flags.escaped) {
      this.flags.escaped = true; this.state = 'ending'; this.t = 0; sfx.sting();
    }
  }
  fuse() {
    this.flags.fused = true;
    const pair = this.enemies.filter(x => x.kind === 'farmwife' || x.kind === 'farmer');
    let mx = pair.reduce((s, e) => s + e.x, 0) / pair.length, my = pair.reduce((s, e) => s + e.y, 0) / pair.length;
    const p0 = this.player;
    if (Math.hypot(mx - p0.x, my - p0.y) < 5 || !this.grid.walkable(mx, my, OUTSIDE)) {
      // never rise on top of the player, and never between the player and the way out (the gate)
      const ex = 4 - p0.x, ey = -12.5 - p0.y, el = Math.hypot(ex, ey) || 1;
      let best = null, bs = -1e9;
      for (let k = 0; k < 32; k++) {
        const a = k / 32 * Math.PI * 2, cx = p0.x + Math.cos(a) * 5.5, cy = p0.y + Math.sin(a) * 5.5;
        if (!this.grid.walkable(cx, cy, OUTSIDE)) continue;
        const sc = -(Math.cos(a) * ex + Math.sin(a) * ey) / el;
        if (sc > bs) { bs = sc; best = [cx, cy]; }
      }
      if (best) [mx, my] = best;
    }
    [mx, my] = this.grid.nearestWalkable(mx, my, OUTSIDE, 6);
    for (const e of pair) e.state = 'gone';
    const a = new Enemy(this, 'amalgam', mx, my, yawTo(mx, my, this.player.x, this.player.y), OUTSIDE);
    a.state = 'rise'; a.anim.play('rise', { restart: true, fade: 0 });
    this.enemies.push(a);
    sfx.squelch(); this.shake = 1.2; this.whiteout = 0.6;
    this.say(["They're... melting into each other.", 'Nothing can kill that. Get to the road. RUN.']);
  }
  // ---------------------------------------------------------- messages
  say(lines, then) { this.msg = { lines: [].concat(lines), shown: 0, then, page: 0 }; }
  ask(q, yes) { this.msg = { lines: [q], shown: 0, choice: 0, yes, page: 0 }; }
  readFile(page = 0) { this.fileView = { page }; }
  // ---------------------------------------------------------- doors
  startDoor(dir) {
    this.state = 'door'; this.t = 0; this.doorDir = dir; sfx.door();
  }
  finishDoor() {
    const p = this.player;
    if (this.doorDir === 'in') { p.area = HOUSE; [p.x, p.y] = this.grid.nearestWalkable(0.35, 10.9, HOUSE); p.yaw = 180; }
    else { p.area = OUTSIDE; [p.x, p.y] = this.grid.nearestWalkable(0.0, 9.05, OUTSIDE); p.yaw = 0; }
    p.z = this.grid.floor(p.x, p.y); p.mode = 'move'; p.anim.play('idle', { restart: true, fade: 0 });
    this.cam = -1; this.updateCamera(); this.state = 'play';
    wind(true, p.area === OUTSIDE ? 0.12 : 0.03);
  }
  updateCamera() {
    const p = this.player;
    const c = this.grid.camera(p.x, p.y, this.cam);
    if (c >= 0 && c !== this.cam) { this.cam = c; this.flowField = null; }
    if (this.cam < 0) this.cam = 0;
  }
  // ---------------------------------------------------------- icons (pre-rendered, like the originals)
  // bounding sphere of a model in its rest pose (metres), for framing icons / examine
  bounds(m) {
    const mats = PSX.partMatrices(m, {});
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    m.parts.forEach((p, pi) => {
      for (let i = 0; i < p.nv; i++) {
        const w = PSX.xform(mats[pi], p.verts[i * 3], p.verts[i * 3 + 1], p.verts[i * 3 + 2]);
        for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k] / 1000); mx[k] = Math.max(mx[k], w[k] / 1000); }
      }
    });
    const c = [0, 1, 2].map(k => (mn[k] + mx[k]) / 2);
    const r = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2;
    return { c, r };
  }
  framed(m, w, h, yaw, fill = 0.9, elev = 0.45) {
    const { c, r } = this.bounds(m);
    const dist = r * 3.2;
    const a = (yaw + 90) * D2R;                          // look at the model from its side
    const eye = [c[0] + Math.cos(a) * dist * Math.cos(elev), c[1] + Math.sin(a) * dist * Math.cos(elev), c[2] + dist * Math.sin(elev)];
    return PSX.Camera.lookAt(eye, c, (Math.min(w, h) * 0.5 * fill) * dist / r, w, h);
  }
  makeIcons() {
    const icons = {};
    for (const [id, it] of Object.entries(ITEMS)) {
      const fb = new PSX.Frame(64, 44);
      fb.fill(0, 0, 0);
      const m = this.A.models[it.model];
      const gun = id === 'shotgun' || id === 'pistol';
      const cam = this.framed(m, 64, 44, gun ? -90 : -30, gun ? 1.25 : 1.0, gun ? 0.15 : 0.45);
      PSX.render(fb, cam, [{ model: m, x: 0, y: 0, z: 0, yaw: 0, pose: {} }],
        new PSX.Lights([[0.5, 0.7, -0.6], [-0.6, -0.2, -0.2]], [[0.9, 0.88, 0.8], [0.3, 0.32, 0.4]], [0.45, 0.45, 0.48]));
      icons[id] = fb;
    }
    return icons;
  }
  // ---------------------------------------------------------- main update
  update(I) {
    this.time += DT; this.t += DT;
    this.shake = Math.max(0, this.shake - DT);
    this.whiteout = Math.max(0, (this.whiteout || 0) - DT);
    if (this.state === 'title') { if (I.confirmPressed) { audioInit(); sfx.confirm(); this.state = 'intro'; this.t = 0; } return; }
    if (this.state === 'intro') { if (I.confirmPressed && this.t > 0.8) { this.state = 'play'; this.t = 0; wind(true); this.say(['Deputy Wilson is dead. So is the woman who bit me.', "My arm won't stop bleeding.", 'There are lights at a farm up the road.']); } return; }
    if (this.state === 'dead') { this.player.anim.update(DT); if (I.confirmPressed && this.t > 2) { this.newGame(); this.state = 'play'; this.t = 0; } return; }
    if (this.state === 'ending') { if (I.confirmPressed && this.t > 4) { this.newGame(); this.state = 'title'; } return; }
    if (this.state === 'door') { if (this.t >= 2.6) this.finishDoor(); return; }
    if (this.fileView) { return this.updateFile(I); }
    if (this.state === 'menu') return this.updateMenu(I);
    if (this.msg) return this.updateMsg(I);
    if (I.menuPressed && this.player.mode !== 'dead') { this.state = 'menu'; this.menu = { sel: 0, sub: null, check: null }; sfx.cursor(); return; }
    this.player.update(I);
    for (const e of this.enemies) e.update();
    this.separate();
    this.updateCamera();
    this.story();
    for (const q of this.particles) { q.x += q.vx * DT; q.y += q.vy * DT; q.z += q.vz * DT; q.vz -= 9 * DT; q.t -= DT; }
    this.particles = this.particles.filter(q => q.t > 0);
    if (this.muzzle) { this.muzzle.t--; if (this.muzzle.t <= 0) this.muzzle = null; }
    if (this.player.mode === 'dead') { this.deathT = (this.deathT || 0) + DT; if (this.deathT > 1.8) { this.state = 'dead'; this.t = 0; } }
    if (this.player.hp <= 33 && Math.floor(this.time * 1.2) !== Math.floor((this.time - DT) * 1.2)) sfx.heartbeat();
  }
  separate() {
    const all = [this.player, ...this.enemies.filter(e => e.alive() && e.area === this.player.area)];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (a.area !== b.area) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = a.r + b.r;
      if (d > 0 && d < m) { const k = (m - d) / d * 0.5; b.move(dx * k, dy * k); a.move(-dx * k, -dy * k); }
    }
  }
  updateMsg(I) {
    const m = this.msg;
    m.shown += 90 * DT;
    const full = m.lines[m.page].length;
    if (m.choice !== undefined && m.shown >= full) {
      if (I.leftPressed || I.rightPressed) { m.choice ^= 1; sfx.cursor(); }
      if (I.confirmPressed) { const yes = m.choice === 0; this.msg = null; if (yes) m.yes(); else sfx.cursor(); }
      if (I.cancelPressed) this.msg = null;
      return;
    }
    if (I.confirmPressed || I.cancelPressed) {
      if (m.shown < full) m.shown = full;
      else if (m.page < m.lines.length - 1) { m.page++; m.shown = 0; }
      else { this.msg = null; m.then && m.then(); }
    }
  }
  updateFile(I) {
    const f = this.fileView;
    if (I.rightPressed && f.page < DIARY.length - 1) { f.page++; sfx.cursor(); }
    if (I.leftPressed && f.page > 0) { f.page--; sfx.cursor(); }
    if (I.confirmPressed) { if (f.page < DIARY.length - 1) { f.page++; sfx.cursor(); } else this.fileView = null; }
    if (I.cancelPressed) this.fileView = null;
  }
  updateMenu(I) {
    const M = this.menu, p = this.player;
    if (M.check) { M.check.t += DT; if (I.confirmPressed || I.cancelPressed) M.check = null; return; }
    const n = 6;
    if (M.sub) {
      if (I.upPressed || I.downPressed) { M.sub.sel = (M.sub.sel + M.sub.opts.length + (I.upPressed ? -1 : 1)) % M.sub.opts.length; sfx.cursor(); }
      if (I.cancelPressed) { M.sub = null; return; }
      if (I.confirmPressed) {
        const it = p.inv[M.sel], opt = M.sub.opts[M.sub.sel];
        M.sub = null; sfx.confirm();
        if (opt === 'EQUIP') { p.equipped = it.id; p.updateHide(); }
        if (opt === 'USE') {
          if (it.id === 'herb') { p.heal(35); it.n--; }
          if (it.id === 'fas') { p.heal(100); it.n--; }
          p.inv = p.inv.filter(i => !((i.id === 'herb' || i.id === 'fas') && i.n <= 0));
        }
        if (opt === 'CHECK') M.check = { id: it.id, t: 0 };
        if (opt === 'READ') { this.state = 'play'; this.readFile(); }
      }
      return;
    }
    if (I.leftPressed || I.rightPressed) { M.sel ^= 1; sfx.cursor(); }
    if (I.upPressed) { M.sel = (M.sel + n - 2) % n; sfx.cursor(); }
    if (I.downPressed) { M.sel = (M.sel + 2) % n; sfx.cursor(); }
    if (I.cancelPressed || I.menuPressed) { this.state = 'play'; return; }
    if (I.confirmPressed && p.inv[M.sel]) {
      const it = ITEMS[p.inv[M.sel].id];
      M.sub = { sel: 0, opts: it.weapon ? ['EQUIP', 'CHECK'] : it.file ? ['READ', 'CHECK'] : (p.inv[M.sel].id === 'shells' ? ['CHECK'] : ['USE', 'CHECK']) };
      sfx.cursor();
    }
  }
  // ---------------------------------------------------------- drawing
  draw() {
    const fb = this.fb, F = this.font;
    if (this.state === 'title') this.drawTitle();
    else if (this.state === 'intro') this.drawIntro();
    else if (this.state === 'door') this.drawDoor();
    else if (this.state === 'ending') this.drawEnding();
    else {
      this.drawWorld();
      if (this.state === 'menu') this.drawMenu();
      else if (this.fileView) this.drawFile();
      else if (this.msg) this.drawMsg();
      if (this.state === 'dead') {
        PSX.darken(fb, Math.max(0.25, 1 - this.t * 0.4));
        PSX.tintScreen(fb, 90, 0, 0, Math.min(0.5, this.t * 0.25));
        const s = 'YOU DIED';
        F.draw(fb, s, 160 - F.width(s), 100, [200, 16, 16], 2);
        if (this.t > 2) { const r = 'Press ENTER to try again'; F.draw(fb, r, 160 - (F.width(r) >> 1), 150, [200, 200, 200]); }
      }
    }
    this.img.data.set(fb.px);
    this.ctx.putImageData(this.img, 0, 0);
  }
  drawWorld() {
    const fb = this.fb, C = this.A.cams[this.cam];
    fb.blit(C.plate.px);
    fb.depth = C.depth;
    for (const s of C.sprites) {
      const id = s.item;
      if (this.present.has(id)) PSX.blitSprite(fb, { w: s.img.w, h: s.img.h, px: s.img.px }, s.x, s.y);
    }
    const area = CAM_AREA[C.name];
    const boost = this.muzzle ? 0.5 : 0;
    const inst = [];
    if (this.player.area === area) inst.push(this.player.instance(C.name, boost));
    for (const e of this.enemies) if (e.area === area && e.state !== 'gone') inst.push(e.instance(C.name, boost * 0.6));
    const cam = this.shake > 0 ? this.shaken(C.cam) : C.cam;
    PSX.render(fb, cam, inst, null);
    // muzzle flash
    if (this.muzzle && this.player.area === area) {
      const pi = inst[0];
      const loc = this.muzzleLocal();
      const w = PSX.partPoint(pi, this.muzzle.part, loc);
      const pr = cam.project(w[0], w[1], w[2]);
      if (pr) { const r = this.muzzle.part === 'shotgun' ? 5 : 3; this.star(pr[0] | 0, pr[1] | 0, r); }
    }
    for (const q of this.particles) {
      const pr = cam.project(q.x, q.y, q.z);
      if (!pr) continue;
      const x = pr[0] | 0, y = pr[1] | 0;
      if (x < 0 || y < 0 || x >= 319 || y >= 239 || pr[2] > C.depth[y * 320 + x] + 0.05) continue;
      PSX.rect(fb, x, y, 2, 2, 128, 8, 8);
    }
    if (this.whiteout > 0) PSX.tintScreen(fb, 255, 255, 255, Math.min(1, this.whiteout * 1.6));
    if (this.player.flash > 0) PSX.tintScreen(fb, 160, 0, 0, 0.18);
  }
  muzzleLocal() {
    // the weapon meshes are built with their grip rotation baked in (see weapons.py)
    const m = this.muzzle;
    const [ax, deg] = m.part === 'shotgun' ? [[0, -860 + 0, 40], 45] : [[0, -175, 86], 70];
    const c = Math.cos(deg * D2R), s = Math.sin(deg * D2R);
    return [ax[0], ax[1] * c - ax[2] * s, ax[1] * s + ax[2] * c];
  }
  star(x, y, r) {
    const fb = this.fb;
    for (let i = -r; i <= r; i++) {
      PSX.rect(fb, x + i, y, 1, 1, 255, 240, 160); PSX.rect(fb, x, y + i, 1, 1, 255, 240, 160);
      if (Math.abs(i) < r * 0.6) { PSX.rect(fb, x + i, y + i, 1, 1, 255, 200, 90); PSX.rect(fb, x + i, y - i, 1, 1, 255, 200, 90); }
    }
    PSX.rect(fb, x - 1, y - 1, 3, 3, 255, 255, 230);
  }
  shaken(cam) {
    const k = this.shake * 0.02;
    const m = cam.m.slice();
    m[3] += (Math.random() - 0.5) * k * 10; m[7] += (Math.random() - 0.5) * k * 10;
    return new PSX.Camera(m, cam.f);
  }
  box(x, y, w, h, fill = [0, 0, 0], a = 0.85, border = [150, 150, 140]) {
    const fb = this.fb;
    PSX.rect(fb, x, y, w, h, fill[0], fill[1], fill[2], a);
    PSX.rect(fb, x, y, w, 1, ...border); PSX.rect(fb, x, y + h - 1, w, 1, ...border);
    PSX.rect(fb, x, y, 1, h, ...border); PSX.rect(fb, x + w - 1, y, 1, h, ...border);
  }
  wrap(text, width) {
    const words = text.split(' '), lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (this.font.width(t) > width) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  drawMsg() {
    const m = this.msg, F = this.font;
    this.box(8, 186, 304, 48);
    const text = m.lines[m.page].slice(0, Math.floor(m.shown));
    const lines = this.wrap(text, 290);
    lines.slice(0, 3).forEach((l, i) => F.draw(this.fb, l, 16, 191 + i * 13));
    if (m.choice !== undefined && m.shown >= m.lines[m.page].length) {
      F.draw(this.fb, 'YES', 110, 218, m.choice === 0 ? [255, 230, 120] : [140, 140, 140]);
      F.draw(this.fb, 'NO', 190, 218, m.choice === 1 ? [255, 230, 120] : [140, 140, 140]);
      F.draw(this.fb, '>', m.choice === 0 ? 100 : 180, 218, [255, 230, 120]);
    }
  }
  drawTitle() {
    const fb = this.fb, F = this.font, C = this.A.cams[2];
    fb.blit(C.plate.px);
    PSX.darken(fb, 0.35);
    const flick = 0.85 + 0.15 * Math.sin(this.time * 7) * Math.sin(this.time * 2.3);
    const t1 = 'RESIDENT EVIL';
    F.draw(fb, t1, 160 - F.width(t1), 58, [Math.floor(200 * flick), 10, 10], 2);
    const t2 = 'THE FARM';
    F.draw(fb, t2, 160 - (F.width(t2) >> 1), 92, [210, 200, 180]);
    const t3 = 'a PlayStation-style fan demo';
    F.draw(fb, t3, 160 - (F.width(t3) >> 1), 108, [130, 124, 116]);
    if (Math.floor(this.time * 2) % 2 === 0) { const s = 'PRESS ENTER'; F.draw(fb, s, 160 - (F.width(s) >> 1), 150, [230, 230, 220]); }
    const c = ['ARROWS: move    SHIFT: run    DOWN+SHIFT: 180', 'Z: aim    X: fire    ENTER: action', 'TAB: status    ESC: back'];
    c.forEach((l, i) => { const w = F.width(l); F.draw(fb, l, 160 - (w >> 1), 186 + i * 13, [150, 146, 138], 1, true); });
  }
  drawIntro() {
    const fb = this.fb, F = this.font;
    fb.fill(0, 0, 0);
    const lines = ['Colorado. December.', '', 'A medical courier took one last delivery:', 'a sealed package for Raccoon City General.', '',
      'A woman stepped into his headlights.', 'The deputy who came to help is dead.', '', 'Something bit him. The road is empty.', 'There are lights at a farm up ahead.'];
    const shown = Math.floor(this.t * 40);
    let n = 0;
    lines.forEach((l, i) => {
      const s = l.slice(0, Math.max(0, shown - n)); n += l.length + 8;
      F.draw(fb, s, 160 - (F.width(l) >> 1), 36 + i * 15, [200, 196, 186]);
    });
    if (this.t > 3 && Math.floor(this.time * 2) % 2 === 0) { const s = 'PRESS ENTER'; F.draw(fb, s, 160 - (F.width(s) >> 1), 214, [120, 120, 120]); }
  }
  drawDoor() {
    const fb = this.fb, t = this.t;
    fb.fill(0, 0, 0); fb.depth = null;
    const open = Math.max(0, Math.min(1, (t - 0.6) / 1.4));
    const dolly = Math.max(0, Math.min(1, (t - 0.3) / 2.3));
    const e = 3.4 - 2.1 * dolly * dolly;
    const cam = PSX.Camera.lookAt([0, -e, 1.25], [0, 0, 1.1], 230);
    const inst = { model: this.A.models.door, x: 0, y: 0, z: 0, yaw: 0, pose: { leaf: [0, 0, 100 * open * open] } };
    const L = new PSX.Lights([[0.3, 1, -0.5], [0, 1, 0]], [[0.75, 0.6, 0.45], [0.25, 0.22, 0.2]], [0.18, 0.16, 0.14]);
    PSX.render(fb, cam, [inst], L);
    const f = t < 0.4 ? 1 - t / 0.4 : t > 2.2 ? (t - 2.2) / 0.4 : 0;
    if (f > 0) PSX.darken(fb, 1 - Math.min(1, f));
  }
  drawEnding() {
    const fb = this.fb, F = this.font;
    this.drawWorld();
    PSX.darken(fb, Math.max(0, 1 - this.t / 2));
    if (this.t < 2) return;
    const secs = Math.floor((performance.now() - this.stats.start) / 1000);
    const lines = ['Bryan ran until the farm lights were gone.', '', 'Behind him, something dragged itself', 'out onto the county road.', '', 'Ahead: the tunnel. And Raccoon City.', '',
      'TO BE CONTINUED', '', `Time ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}    Shots ${this.stats.shots}    Kills ${this.stats.kills || 0}`];
    lines.forEach((l, i) => F.draw(fb, l, 160 - (F.width(l) >> 1), 40 + i * 15, l === 'TO BE CONTINUED' ? [200, 20, 20] : [200, 196, 186]));
  }
  drawFile() {
    const fb = this.fb, F = this.font, f = this.fileView;
    PSX.darken(fb, 0.3);
    this.box(30, 24, 260, 180, [58, 52, 40], 0.95, [120, 104, 80]);
    const pg = DIARY[f.page];
    F.draw(fb, 'FARM DIARY', 44, 32, [230, 200, 140]);
    F.draw(fb, pg[0], 44, 54, [220, 200, 160]);
    pg.slice(1).forEach((l, i) => F.draw(fb, l, 44, 76 + i * 16, [220, 214, 196]));
    F.draw(fb, `${f.page + 1}/${DIARY.length}`, 250, 186, [160, 150, 130]);
  }
  drawMenu() {
    const fb = this.fb, F = this.font, p = this.player, M = this.menu;
    PSX.darken(fb, 0.18);
    PSX.tintScreen(fb, 0, 10, 40, 0.5);
    if (M.check) return this.drawCheck();
    // status / ECG
    this.box(8, 8, 150, 86, [0, 0, 0], 0.9);
    F.draw(fb, 'CONDITION', 16, 12, [200, 200, 190]);
    const st = p.status(), col = st === 'FINE' ? [40, 220, 60] : st === 'CAUTION' ? [230, 190, 30] : [230, 40, 30];
    for (let gx = 16; gx < 150; gx += 10) PSX.rect(fb, gx, 30, 1, 44, 0, 40, 0);
    for (let gy = 30; gy < 74; gy += 11) PSX.rect(fb, 16, gy, 134, 1, 0, 40, 0);
    const speed = st === 'FINE' ? 1 : st === 'CAUTION' ? 1.4 : 2;
    const head = (this.time * 60 * speed) % 134;
    const ecgY = (i) => {                                   // P wave, QRS spike, T wave every 45 px
      const ph = (i % 45) / 45;
      if (ph > 0.12 && ph < 0.2) return 52 - 3 * Math.sin((ph - 0.12) / 0.08 * Math.PI);
      if (ph >= 0.34 && ph < 0.37) return 52 + (ph - 0.34) / 0.03 * 5;
      if (ph >= 0.37 && ph < 0.41) return 57 - (ph - 0.37) / 0.04 * 25;
      if (ph >= 0.41 && ph < 0.45) return 32 + (ph - 0.41) / 0.04 * 26;
      if (ph >= 0.45 && ph < 0.47) return 58 - (ph - 0.45) / 0.02 * 6;
      if (ph > 0.58 && ph < 0.72) return 52 - 5 * Math.sin((ph - 0.58) / 0.14 * Math.PI);
      return 52;
    };
    for (let i = 1; i < 134; i++) {
      const age = (head - i + 134) % 134;
      if (age > 100) continue;
      const k = 1 - age / 100;
      const y0 = Math.round(ecgY(i - 1)), y1 = Math.round(ecgY(i));
      PSX.rect(fb, 16 + i, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 2, col[0] * k, col[1] * k, col[2] * k);
    }
    F.draw(fb, st, 16, 78, col);
    // equipped weapon
    this.box(8, 100, 150, 58, [0, 0, 0], 0.9);
    F.draw(fb, 'EQUIPPED', 16, 104, [200, 200, 190]);
    if (p.equipped) {
      PSX.blitSprite(fb, this.icons[p.equipped], 16, 116);
      const ammo = p.equipped === 'pistol' ? `${p.pistolAmmo}` : `${p.loaded} / ${p.shells}`;
      F.draw(fb, ammo, 92, 132, [230, 230, 120]);
    }
    // item grid 2x3
    for (let k = 0; k < 6; k++) {
      const x = 170 + (k % 2) * 72, y = 8 + Math.floor(k / 2) * 52;
      this.box(x, y, 68, 48, [0, 0, 0], 0.9, k === M.sel ? [255, 220, 90] : [110, 110, 104]);
      const it = p.inv[k];
      if (it) {
        PSX.blitSprite(fb, this.icons[it.id], x + 2, y + 2);
        if (it.id !== 'diary') F.draw(fb, String(it.id === 'shotgun' ? it.n : it.n), x + 52, y + 34, [230, 230, 120]);
        if (p.equipped === it.id) F.draw(fb, 'E', x + 4, y + 34, [120, 220, 255]);
      }
    }
    // description
    this.box(8, 166, 304, 66, [0, 0, 0], 0.9);
    const it = p.inv[M.sel];
    if (it) {
      F.draw(fb, ITEMS[it.id].name, 16, 172, [255, 220, 90]);
      this.wrap(ITEMS[it.id].desc, 290).forEach((l, i) => F.draw(fb, l, 16, 190 + i * 13));
    }
    if (M.sub) {
      const x = 170 + (M.sel % 2) * 72 + 30, y = 8 + Math.floor(M.sel / 2) * 52 + 10;
      this.box(x, y, 60, 8 + M.sub.opts.length * 13, [20, 20, 30], 0.97, [255, 220, 90]);
      M.sub.opts.forEach((o, i) => F.draw(fb, o, x + 8, y + 4 + i * 13, i === M.sub.sel ? [255, 230, 120] : [180, 180, 170]));
    }
  }
  drawCheck() {
    const fb = this.fb, F = this.font, id = this.menu.check.id, it = ITEMS[id];
    fb.fill(0, 0, 8); fb.depth = null;
    const m = this.A.models[it.model];
    const cam = this.framed(m, 320, 240, -90, 0.8, 0.3);
    PSX.render(fb, cam, [{ model: m, x: 0, y: 0, z: 0, yaw: this.menu.check.t * 50, pose: {} }],
      new PSX.Lights([[0.4, 0.8, -0.5], [-0.6, -0.2, -0.3]], [[0.95, 0.9, 0.82], [0.3, 0.34, 0.44]], [0.4, 0.4, 0.44]));
    F.draw(fb, it.name, 160 - (F.width(it.name) >> 1), 12, [255, 220, 90]);
    this.wrap(it.desc, 290).forEach((l, i) => F.draw(fb, l, 160 - (F.width(l) >> 1), 200 + i * 13));
  }
}
