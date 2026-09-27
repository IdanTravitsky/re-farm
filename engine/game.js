// The game: a mode state machine over rooms loaded on demand.
// Everything location-specific (cameras, doors, pickups, enemies, story) is data.
import * as PSX from './psx.js';
import * as Audio from './audio.js';
import { Music } from './music.js';
import { GameState, Saves } from './state.js';
import { Script, check } from './script.js';
import { Player, Enemy, DT, angDiff, fwd, yawTo } from './actors.js';
import { UI } from './ui.js';

const D2R = Math.PI / 180;

export class Game {
  constructor(A, { headless = false } = {}) {
    this.A = A; this.headless = headless;
    this.fb = new PSX.Frame(320, 240);
    this.ui = new UI(this); this.script = new Script(this);
    this.music = new Music(); this.music.register(A.content.music);
    this.mode = 'title'; this.t = 0; this.time = 0; this.sel = 0;
    this.fx = { shake: 0, whiteout: 0 }; this.particles = []; this.enemies = [];
    this.slots = A.content.game.inventory_slots || 8;
    this.state = null; this.room = null; this.location = null; this.player = null;
    this.cam = -1; this.forcedCamera = null; this.cinematic = false; this.god = false; this.muzzle = null;
  }
  async init() {
    const start = this.A.content.game.start;
    const room = await this.A.room(start.room);
    this.titleCam = room.cameras.find(c => c.id === this.A.content.game.title_camera) || room.cameras[0];
    return this;
  }

  // ---------------------------------------------------------------- flow
  async newGame() {
    const start = this.A.content.game.start, items = this.A.content.items;
    this.state = new GameState(start);
    for (const [id, n] of start.inventory) this.state.add(id, n, items, this.slots);
    this.player = null;
    const yaw = start.face ? yawTo(start.at[0], start.at[1], start.face[0], start.face[1]) : 0;
    await this.enterRoom(start.room, start.at[0], start.at[1], yaw);
    this.mode = 'play'; this.t = 0;
    this.script.fire('new_game');
  }
  async enterRoom(roomId, x, y, yaw, opts = {}) {
    const S = this.state, prev = this.room;
    if (prev) {
      // a stalker that was after you follows you through the door, a few seconds behind
      const hunter = opts.door && this.enemies.find(e => e.alive() && e.def.follow_doors && e.state !== 'idle');
      this.stashEnemies();
      if (hunter) { delete S.enemies[hunter.id]; S.pursuit = { id: hunter.id, snap: hunter.snapshot(), door: opts.door, room: roomId, timer: hunter.def.door_delay || 7 }; }
      else if (S.pursuit && opts.door) Object.assign(S.pursuit, { door: opts.door, room: roomId, timer: this.A.content.actors[S.pursuit.snap.type].door_delay || 7 });
    }
    const locId = this.A.content.world.rooms[roomId].location;
    if (!this.location || this.location.id !== locId) this.location = await this.A.location(locId);
    const room = await this.A.room(roomId);
    this.room = room; S.room = roomId; S.location = locId; S.visited[roomId] = true;
    if (!this.player) this.player = new Player(this, x, y, yaw);
    const p = this.player;
    [p.x, p.y] = room.nearestWalkable(x, y);
    p.z = room.floor(p.x, p.y); p.yaw = yaw; p.mode = 'move'; p.quickTurn = 0; p.scripted = null;
    p.anim.play('idle', { restart: true, fade: 0 }); p.updateHide();
    this.cam = -1; this.forcedCamera = null; this.flowField = null; this.particles = []; this.muzzle = null;
    this.updateCamera();
    this.spawnRoomEnemies();
    this.music.play(room.music);
    Audio.wind(true, room.wind);
    for (const d of this.location.doors) for (const s of [d.a, d.b]) if (s.room === roomId) this.A.prefetch((s === d.a ? d.b : d.a).room);
    this.script.fire('enter_room', { room: roomId });
  }
  spawnRoomEnemies() {
    const S = this.state, rid = S.room;
    this.enemies = [];
    for (const sp of this.location.enemies || []) {
      if (sp.room === rid && !S.dead[sp.id] && !S.enemies[sp.id] && S.pursuit?.id !== sp.id) this.enemies.push(new Enemy(this, sp));
    }
    for (const [id, snap] of Object.entries(S.enemies)) if (snap.room === rid) this.enemies.push(new Enemy(this, { ...snap, id }));
  }
  stashEnemies() {
    for (const e of this.enemies) {
      if (e.state === 'gone') continue;
      if (e.alive()) this.state.enemies[e.id] = e.snapshot(); else delete this.state.enemies[e.id];
    }
  }
  spawnEnemy(spec) {
    const s = { room: this.state.room, ...spec };
    if (s.room !== this.state.room) { this.state.enemies[s.id] = { type: s.type, room: s.room, at: s.at, yaw: s.yaw || 0, state: s.state || 'chase' }; return; }
    const e = new Enemy(this, s);
    this.enemies.push(e);
    return e;
  }
  removeEnemy(id) {
    const e = this.enemies.find(x => x.id === id);
    if (e) e.state = 'gone';
    delete this.state.enemies[id];
    this.state.dead[id] = true;
  }
  // replace some enemies with a new one (the fusion): placed at their midpoint, but never on top
  // of the player nor between the player and a given escape point
  transform(v) {
    const gone = this.enemies.filter(e => v.remove.includes(e.id));
    let [mx, my] = gone.length ? [gone.reduce((s, e) => s + e.x, 0) / gone.length, gone.reduce((s, e) => s + e.y, 0) / gone.length] : [this.player.x, this.player.y];
    v.remove.forEach(id => this.removeEnemy(id));
    const p = this.player, R = this.room, minD = v.min_dist || 0;
    if (Math.hypot(mx - p.x, my - p.y) < minD || !R.walkable(mx, my)) {
      const [ex, ey] = v.away_from ? [v.away_from[0] - p.x, v.away_from[1] - p.y] : [0, 0];
      const el = Math.hypot(ex, ey) || 1;
      let best = null, bs = -1e9;
      for (let k = 0; k < 32; k++) {
        const a = k / 32 * Math.PI * 2, cx = p.x + Math.cos(a) * (minD || 5), cy = p.y + Math.sin(a) * (minD || 5);
        if (!R.walkable(cx, cy)) continue;
        const sc = -(Math.cos(a) * ex + Math.sin(a) * ey) / el;
        if (sc > bs) { bs = sc; best = [cx, cy]; }
      }
      if (best) [mx, my] = best;
    }
    this.spawnEnemy({ ...v.spawn, at: [mx, my], face: 'player' });
  }
  chapterEnd(v) {
    this.stashEnemies();
    this.chapter = { ...v, hasNext: !!this.A.content.world.locations[v.next] };
    this.mode = 'chapter'; this.t = 0;
    this.music.play(null);
  }
  async continueToNext() {
    const loc = await this.A.location(this.chapter.next);
    const e = loc.entry || {};
    const room = e.room || loc.rooms[0];
    this.mode = 'loading';
    await this.enterRoom(room, ...(e.at || [0, 0]), e.yaw || 0);
    this.mode = 'play';
  }

  // ---------------------------------------------------------------- saving
  saveTo(slot) {
    const S = this.state, p = this.player;
    this.stashEnemies();
    S.pos = { x: p.x, y: p.y, yaw: p.yaw };
    S.consume('ink_ribbon', 1);
    S.saves++;
    Saves.write(slot, S, this.room.name);
  }
  async loadFrom(slot) {
    const st = Saves.read(slot);
    if (!st) return false;
    this.mode = 'loading';
    this.state = st; this.player = null; this.room = null; this.location = null;
    await this.enterRoom(st.room, st.pos.x, st.pos.y, st.pos.yaw, { load: true });
    this.mode = 'play'; this.t = 0;
    return true;
  }

  // ---------------------------------------------------------------- interaction
  candidates() {
    const S = this.state, L = this.location, rid = S.room, out = [];
    for (const d of L.doors || []) for (const side of ['a', 'b']) if (d[side].room === rid) out.push({ kind: 'door', at: d[side].at, r: d[side].r, door: d, side });
    for (const pk of L.pickups || []) if (pk.room === rid && !S.taken[pk.id] && check(pk.when, this)) out.push({ kind: 'pickup', at: pk.at, r: pk.r, pk });
    for (const ex of L.examine || []) if (ex.room === rid && check(ex.when, this)) out.push({ kind: 'examine', at: ex.at, r: ex.r, ex });
    for (const tw of L.typewriters || []) if (tw.room === rid) out.push({ kind: 'typewriter', at: tw.at, r: tw.r });
    return out;
  }
  interact() {
    const p = this.player;
    let best = null, bd = 1e9;
    for (const c of this.candidates()) {
      const d = Math.hypot(c.at[0] - p.x, c.at[1] - p.y);
      if (d > c.r) continue;
      if (d > 0.6 && Math.abs(angDiff(yawTo(p.x, p.y, c.at[0], c.at[1]), p.yaw)) > 75) continue;
      // pickups/typewriters win over plain examine text at the same spot
      const score = d - (c.kind === 'pickup' || c.kind === 'typewriter' || c.kind === 'door' ? 0.5 : 0);
      if (score < bd) { bd = score; best = c; }
    }
    if (!best) return;
    this.sfx('confirm');
    if (best.kind === 'door') return this.startDoor(best.door, best.side);
    if (best.kind === 'examine') { this.ui.say(best.ex.text); if (best.ex.do) this.script.start(best.ex.do); return; }
    if (best.kind === 'typewriter') {
      if (!this.state.has('ink_ribbon')) return this.ui.say(["It's a typewriter.", 'You need an INK RIBBON to record your progress.']);
      return this.ui.ask('Will you use an INK RIBBON to record your progress?', () => { this.mode = 'save'; this.sel = 0; });
    }
    const pk = best.pk, S = this.state, def = this.A.content.items[pk.item];
    const stacks = S.inventory.find(i => i.id === pk.item) && def.kind !== 'weapon';
    if (!stacks && S.inventory.length >= this.slots) return this.ui.say(['There is no more room to carry anything.']);
    this.ui.ask(pk.ask, () => {
      p.mode = 'pickup'; p.anim.play('pickup', { restart: true });
      p.pickDone = () => {
        S.add(pk.item, pk.count ?? 1, this.A.content.items, this.slots);
        S.taken[pk.id] = true;
        this.sfx('pickup');
        if (pk.taken) this.ui.say(pk.taken);
        if (pk.do) this.script.start(pk.do, pk.id);
        this.script.fire('pickup', { id: pk.id });
      };
    });
  }
  give(id, n) { this.state.add(id, n, this.A.content.items, this.slots); }

  // ---------------------------------------------------------------- doors & room changes
  startDoor(door, side) {
    const to = side === 'a' ? door.b : door.a;
    this.mode = 'door'; this.t = 0; this.sfx('door');
    this.door = { door, to, ready: false, finishing: false };
    this.A.room(to.room).then(() => { this.door.ready = true; });
  }
  gotoRoom(room, at, yaw) {
    this.mode = 'door'; this.t = 0;
    this.door = { door: { id: null, fade: true }, to: { room, spawn: at, yaw }, ready: false, finishing: false };
    this.A.room(room).then(() => { this.door.ready = true; });
  }
  updateCamera() {
    const p = this.player;
    if (this.forcedCamera) { const k = this.room.cameras.findIndex(c => c.id === this.forcedCamera); if (k >= 0) { this.cam = k; return; } }
    const c = this.room.camera(p.x, p.y, this.cam);
    if (c >= 0 && c !== this.cam) { this.cam = c; this.flowField = null; }
    if (this.cam < 0) this.cam = 0;
  }
  prefetchVisited() { for (const r of this.location.rooms) if (this.state.visited[r]) this.A.prefetch(r); }

  // ---------------------------------------------------------------- combat
  pickTarget() {
    const p = this.player, R = this.room;
    let best = null, bs = 1e9;
    for (const e of this.enemies) {
      if (!e.alive()) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y), a = Math.abs(angDiff(yawTo(p.x, p.y, e.x, e.y), p.yaw));
      if (d > 16 || a > 80 || !R.shotLos(p.x, p.y, p.z + 1.35, e.x, e.y, e.z + e.chest())) continue;
      if (d + a / 20 < bs) { bs = d + a / 20; best = e; }
    }
    return best;
  }
  shoot(p, w) {
    const R = this.room;
    for (const e of this.enemies) if (e.state === 'idle' && Math.hypot(e.x - p.x, e.y - p.y) < (e.def.hear || 20)) e.alert();
    const targets = this.enemies.filter(e => e.alive())
      .map(e => ({ e, d: Math.hypot(e.x - p.x, e.y - p.y), a: Math.abs(angDiff(yawTo(p.x, p.y, e.x, e.y), p.yaw)) }))
      .filter(t => t.d < w.range && t.a < w.cone && R.shotLos(p.x, p.y, p.z + 1.35, t.e.x, t.e.y, t.e.z + t.e.chest()))
      .sort((a, b) => a.d - b.d);
    for (const t of w.spread ? targets : targets.slice(0, 1)) {
      const dmg = (w.damage.find(([dd]) => t.d < dd) || [0, 0])[1];
      t.e.damage(dmg, w.spread && t.d < (w.heavy_within || 0), p.yaw);
    }
  }
  refreshFlow() { this.flowField = this.room.flow(this.player.x, this.player.y); }
  blood(x, y, z, n) {
    if (this.headless) return;
    for (let i = 0; i < n; i++) this.particles.push({ x, y, z, vx: (Math.random() - 0.5) * 2.2, vy: (Math.random() - 0.5) * 2.2, vz: Math.random() * 2.2, t: 0.5 + Math.random() * 0.4 });
  }
  onEnemyDead(e) { this.state.dead[e.id] = true; this.state.stats.kills++; delete this.state.enemies[e.id]; }
  onPlayerDeath() { this.deathT = 0; }
  pan(x, y) {
    if (!this.room) return 0;
    const c = this.room.cameras[this.cam].cam.project(x, y, 1);
    return c ? Math.max(-0.8, Math.min(0.8, (c[0] - 160) / 200)) : 0;
  }
  sfx(name, arg) {
    const s = Audio.sfx;
    if (name === 'moan_deep') return s.moan(arg, true);
    if (s[name]) s[name](arg);
  }
  separate() {
    const all = [this.player, ...this.enemies.filter(e => e.alive())];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = a.r + b.r;
      if (d > 0 && d < m) { const k = (m - d) / d * 0.5; b.move(dx * k, dy * k); a.move(-dx * k, -dy * k); }
    }
  }

  // ---------------------------------------------------------------- per-frame
  update(I) {
    this.time += DT; this.t += DT;
    this.fx.shake = Math.max(0, this.fx.shake - DT); this.fx.whiteout = Math.max(0, this.fx.whiteout - DT);
    switch (this.mode) {
      case 'title': return this.updateTitle(I);
      case 'intro':
        if (I.confirmPressed && this.t > 0.8) { this.mode = 'loading'; this.newGame(); }
        return;
      case 'loading': return;
      case 'load': case 'save': return this.updateSlots(I);
      case 'door':
        if (this.t >= 2.6 && this.door.ready && !this.door.finishing) {
          this.door.finishing = true;
          const to = this.door.to;
          this.enterRoom(to.room, to.spawn[0], to.spawn[1], to.yaw ?? 0, { door: this.door.door.id }).then(() => { this.mode = 'play'; this.t = 0; });
        }
        return;
      case 'dead':
        this.player.anim.update(DT);
        if (this.t > 2 && I.confirmPressed) { if (Saves.any()) { this.mode = 'load'; this.sel = 0; this.slotBack = 'dead'; } else { this.mode = 'loading'; this.newGame(); } }
        if (this.t > 2 && I.cancelPressed) { this.mode = 'title'; this.t = 0; this.music.play(null); }
        return;
      case 'chapter':
        if (this.t > 4 && I.confirmPressed) { if (this.chapter.hasNext) this.continueToNext(); else { this.mode = 'title'; this.t = 0; } }
        return;
      case 'play': return this.updatePlay(I);
    }
  }
  updateTitle(I) {
    const has = Saves.any();
    if (I.upPressed || I.downPressed) { this.sel = has ? 1 - this.sel : 0; this.sfx('cursor'); }
    if (I.confirmPressed) {
      Audio.init();
      this.sfx('confirm');
      if (this.sel === 1 && has) { this.mode = 'load'; this.sel = 0; this.slotBack = 'title'; }
      else { this.mode = 'intro'; this.t = 0; }
    }
  }
  updateSlots(I) {
    if (I.upPressed || I.downPressed) { this.sel = (this.sel + (I.upPressed ? 2 : 1)) % 3; this.sfx('cursor'); }
    if (I.cancelPressed) { this.mode = this.mode === 'save' ? 'play' : this.slotBack || 'title'; return; }
    if (!I.confirmPressed) return;
    if (this.mode === 'save') { this.saveTo(this.sel); this.sfx('confirm'); this.mode = 'play'; this.ui.say(['Your progress has been recorded.']); }
    else if (Saves.list()[this.sel]) { this.sfx('confirm'); this.loadFrom(this.sel); }
  }
  updatePlay(I) {
    const S = this.state, p = this.player;
    S.time += DT;
    if (this.ui.update(I)) return;                            // messages / menu / files pause the world
    if (!this.cinematic && p.mode !== 'dead') {
      if (I.menuPressed) return this.ui.openMenu('items');
      if (I.mapPressed) return this.ui.openMenu('map');
    }
    p.update(I);
    for (const e of this.enemies) e.update();
    this.separate();
    this.updateCamera();
    this.script.tick();
    this.script.update(DT);
    if (S.pursuit && S.pursuit.room === S.room && (S.pursuit.timer -= DT) <= 0) this.pursuerArrives();
    for (const q of this.particles) { q.x += q.vx * DT; q.y += q.vy * DT; q.z += q.vz * DT; q.vz -= 9 * DT; q.t -= DT; }
    this.particles = this.particles.filter(q => q.t > 0);
    if (this.muzzle && --this.muzzle.t <= 0) this.muzzle = null;
    if (p.mode === 'dead' && (this.deathT += DT) > 1.8 && this.mode === 'play') { this.mode = 'dead'; this.t = 0; this.music.play(null); }
    if (S.hp <= 33 && S.hp > 0 && Math.floor(this.time * 1.2) !== Math.floor((this.time - DT) * 1.2)) this.sfx('heartbeat');
  }
  pursuerArrives() {
    const P = this.state.pursuit, d = this.location.doors.find(x => x.id === P.door);
    this.state.pursuit = null;
    if (!d) return;
    const side = d.a.room === this.state.room ? d.a : d.b;
    this.sfx('door');
    this.spawnEnemy({ ...P.snap, id: P.id, room: this.state.room, at: side.spawn, face: 'player', state: 'chase' });
  }

  // ---------------------------------------------------------------- drawing
  draw() {
    if (this.headless) return;
    const fb = this.fb, U = this.ui;
    switch (this.mode) {
      case 'title': U.drawTitle(this.sel, Saves.any()); break;
      case 'intro': U.drawIntro(this.t); break;
      case 'loading': fb.fill(0, 0, 0); if (this.time % 1 < 0.5) U.center('NOW LOADING', 112, [140, 140, 140]); break;
      case 'door': this.drawDoor(); break;
      case 'load': this.state ? this.drawWorld() : fb.fill(0, 0, 0); U.drawSlots('LOAD', this.sel); break;
      case 'save': this.drawWorld(); U.drawSlots('SAVE', this.sel); break;
      case 'dead': this.drawWorld(); U.drawDead(this.t); break;
      case 'chapter': this.drawWorld(); U.drawChapter(this.chapter, this.t); break;
      default: this.drawWorld(); U.drawOverlays();
    }
    if (this.debug) this.debug.draw();
  }
  drawWorld() {
    const fb = this.fb, R = this.room, C = R.cameras[this.cam], S = this.state;
    if (C.plate) fb.blit(C.plate.px); else fb.fill(0, 0, 0);
    fb.depth = C.depth;
    for (const s of C.sprites) if (s.img && !S.taken[s.pickup]) PSX.blitSprite(fb, s.img, s.x, s.y);
    const boost = this.muzzle ? 0.5 : 0;
    const inst = [this.player.instance(this.cam, boost)];
    for (const e of this.enemies) if (e.state !== 'gone') inst.push(e.instance(this.cam, boost * 0.6));
    const cam = this.fx.shake > 0 ? shaken(C.cam, this.fx.shake) : C.cam;
    PSX.render(fb, cam, inst, null);
    if (this.muzzle) {
      const m = this.muzzle.muzzle, c = Math.cos(m.rot * D2R), s = Math.sin(m.rot * D2R), L = m.local;
      const w = PSX.partPoint(inst[0], this.muzzle.part, [L[0], L[1] * c - L[2] * s, L[1] * s + L[2] * c]);
      const pr = cam.project(w[0], w[1], w[2]);
      if (pr) star(fb, pr[0] | 0, pr[1] | 0, m.size);
    }
    for (const q of this.particles) {
      const pr = cam.project(q.x, q.y, q.z);
      if (!pr) continue;
      const x = pr[0] | 0, y = pr[1] | 0;
      if (x < 0 || y < 0 || x >= 319 || y >= 239 || pr[2] > C.depth[y * 320 + x] + 0.05) continue;
      PSX.rect(fb, x, y, 2, 2, 128, 8, 8);
    }
    if (this.fx.whiteout > 0) PSX.tintScreen(fb, 255, 255, 255, Math.min(1, this.fx.whiteout * 1.6));
    if (this.player.flashT > 0) PSX.tintScreen(fb, 160, 0, 0, 0.18);
    if (this.cinematic) { PSX.rect(fb, 0, 0, 320, 26, 0, 0, 0); PSX.rect(fb, 0, 214, 320, 26, 0, 0, 0); }
  }
  drawDoor() {
    const fb = this.fb, t = this.t, D = this.door;
    fb.fill(0, 0, 0); fb.depth = null;
    if (!D.door.fade) {
      const open = Math.max(0, Math.min(1, (t - 0.6) / 1.4)), dolly = Math.max(0, Math.min(1, (t - 0.3) / 2.3));
      const cam = PSX.Camera.lookAt([0, -(3.4 - 2.1 * dolly * dolly), 1.25], [0, 0, 1.1], 230);
      const model = this.A.models[D.door.model || 'door'];
      PSX.render(fb, cam, [{ model, x: 0, y: 0, z: 0, yaw: 0, pose: { leaf: [0, 0, 100 * open * open] } }],
        new PSX.Lights([[0.3, 1, -0.5], [0, 1, 0]], [[0.75, 0.6, 0.45], [0.25, 0.22, 0.2]], [0.18, 0.16, 0.14]));
    }
    const f = t < 0.4 ? 1 - t / 0.4 : t > 2.2 ? (t - 2.2) / 0.4 : 0;
    if (f > 0) PSX.darken(fb, 1 - Math.min(1, f));
  }
}

function shaken(cam, amt) {
  const m = cam.m.slice(), k = amt * 0.2;
  m[3] += (Math.random() - 0.5) * k; m[7] += (Math.random() - 0.5) * k;
  return new PSX.Camera(m, cam.f);
}
function star(fb, x, y, r) {
  for (let i = -r; i <= r; i++) {
    PSX.rect(fb, x + i, y, 1, 1, 255, 240, 160); PSX.rect(fb, x, y + i, 1, 1, 255, 240, 160);
    if (Math.abs(i) < r * 0.6) { PSX.rect(fb, x + i, y + i, 1, 1, 255, 200, 90); PSX.rect(fb, x + i, y - i, 1, 1, 255, 200, 90); }
  }
  PSX.rect(fb, x - 1, y - 1, 3, 3, 255, 255, 230);
}
