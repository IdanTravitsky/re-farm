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
const cl = (a, b, t) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const ease = (k) => k * k * (3 - 2 * k);

// The staged scenes that play while the next room loads. Each takes t in 0..2.6s
// and returns the camera, the model pose and (optionally) a camera shake.
const WARM = [[[0.3, 1, -0.5], [0, 1, 0]], [[0.75, 0.6, 0.45], [0.25, 0.22, 0.2]], [0.18, 0.16, 0.14]];
const COLD = [[[0.3, 1, -0.6], [0, 1, 0]], [[0.55, 0.6, 0.66], [0.2, 0.22, 0.26]], [0.16, 0.17, 0.2]];
const NIGHT = [[[0.2, 0.6, -1], [0, 1, 0]], [[0.4, 0.46, 0.6], [0.1, 0.12, 0.18]], [0.12, 0.13, 0.18]];
const swing = (model, sfx, light, poseFn, far = 3.4, near = 1.3) => ({
  model, sfx, light,
  view: (t) => { const d = ease(cl(0.3, 2.6, t)); return [[0, -(far - (far - near) * d), 1.25], [0, 0, 1.1]]; },
  pose: (t) => poseFn(cl(0.6, 2.0, t) ** 2),
});
export const TRANSITIONS = {
  door: swing('door', 'door', WARM, (o) => ({ leaf: [0, 0, 100 * o] })),
  door_metal: swing('door_metal', 'door_metal', COLD, (o) => ({ leaf: [0, 0, 95 * o] })),
  door_double: swing('door_double', 'door', COLD, (o) => ({ leaf_l: [0, 0, 85 * o], leaf_r: [0, 0, -85 * o] }), 3.6, 1.2),
  gate: swing('gate', 'gate', NIGHT, (o) => ({ leaf: [0, 0, 90 * o] }), 6.0, 2.2),
  stairs_up: { model: 'stairs', sfx: 'stairs', light: COLD, pose: () => ({}),
    view: (t) => { const y = -1.2 + 4.4 * ease(cl(0.2, 2.6, t)), z = (v) => 0.643 * Math.max(0, v); const b = 0.03 * Math.sin(t * 11);
      return [[0.15, y, z(y) + 1.55 + b], [0, y + 2, z(y + 2) + 1.3]]; } },
  stairs_down: { model: 'stairs', sfx: 'stairs', light: COLD, pose: () => ({}),
    view: (t) => { const y = 5.0 - 4.4 * ease(cl(0.2, 2.6, t)), z = (v) => 0.643 * Math.min(4.48, Math.max(0, v)); const b = 0.03 * Math.sin(t * 11);
      return [[-0.15, y, z(y) + 1.55 + b], [0, y - 2, z(y - 2) + 1.0]]; } },
  ladder_up: { model: 'ladder', sfx: 'ladder', light: COLD, pose: () => ({}),
    view: (t) => { const z = 0.9 + 3.6 * ease(cl(0.2, 2.6, t)); return [[0, -0.8, z], [0, 0.2, z + 0.5]]; } },
  ladder_down: { model: 'ladder', sfx: 'ladder', light: COLD, pose: () => ({}),
    view: (t) => { const z = 4.5 - 3.6 * ease(cl(0.2, 2.6, t)); return [[0, -0.8, z], [0, 0.2, z - 0.7]]; } },
  elevator: { model: 'elevator', sfx: 'elevator', light: COLD,
    view: () => [[0, -3.1, 1.5], [0, 0, 1.2]],
    pose: (t) => { const g = 800 * (1 - ease(cl(0, 0.9, t)) + ease(cl(1.9, 2.5, t))); return { leaf_l: [0, 0, 0, -g, 0, 0], leaf_r: [0, 0, 0, g, 0, 0] }; },
    shake: (t) => (t > 0.9 && t < 1.9 ? 0.15 : 0) },
  manhole_down: { model: 'manhole', sfx: 'manhole', light: NIGHT,
    view: (t) => { const z = 3.0 - 5.0 * ease(cl(1.0, 2.6, t)); return [[0, -0.35, z], [0, 0.05, z - 3]]; },
    pose: (t) => ({ cover: [0, 0, 0, 900 * ease(cl(0.1, 0.9, t)), 0, 0] }) },
  manhole_up: { model: 'manhole', sfx: 'manhole', light: NIGHT,
    view: (t) => { const z = -2.2 + 3.8 * ease(cl(0.1, 2.3, t)), k = ease(cl(1.3, 2.6, t)); return [[0, -0.35 * (1 - k), z], [0, 3 * k + 0.05, z + 3 * (1 - k) + 0.2 * k]]; },
    pose: () => ({ cover: [0, 0, 0, 900, 0, 0] }) },
};

export class Game {
  constructor(A, { headless = false, scale = headless ? 1 : 2 } = {}) {
    this.A = A; this.headless = headless;
    this.fb = new PSX.Frame(320, 240, scale);
    this.hints = true; this.reducedMotion = false; this.interactionKey = null;
    this.ui = new UI(this); this.script = new Script(this);
    this.music = new Music(); this.music.register(A.content.music);
    this.mode = 'title'; this.t = 0; this.time = 0; this.sel = 0;
    this.fx = { shake: 0, whiteout: 0, fade: 0, fadeTo: 0, fadeRate: 0, card: null }; this.particles = []; this.enemies = [];
    this.projectiles = []; this.puddles = [];
    this.slots = A.content.game.inventory_slots || 8;
    this.state = null; this.room = null; this.location = null; this.player = null;
    this.cam = -1; this.forcedCamera = null; this.cinematic = false; this.god = false; this.muzzle = null; this.musicOverride = undefined;
  }
  async init() {
    const G = this.A.content.game, start = G.start;
    const room = await this.A.room(G.title_room || start.room);
    this.titleCam = room.cameras.find(c => c.id === this.A.content.game.title_camera) || room.cameras[0];
    return this;
  }

  // ---------------------------------------------------------------- flow
  resetScene() {
    this.ui = new UI(this); this.script = new Script(this);
    this.player = null; this.room = null; this.location = null; this.enemies = [];
    this.cinematic = false; this.forcedCamera = null; this.musicOverride = undefined;
    this.particles = []; this.projectiles = []; this.puddles = []; this.muzzle = null;
    this.interactionKey = null; this.cam = -1;
    this.fx = { shake: 0, whiteout: 0, fade: 0, fadeTo: 0, fadeRate: 0, card: null };
  }
  checkpoint(room, at, yaw) {
    const snapshot = GameState.from(this.state.toJSON());
    snapshot.room = room; snapshot.location = this.A.content.world.rooms[room].location;
    snapshot.pos = { x: at[0], y: at[1], yaw };
    const saved = Saves.writeCheckpoint(snapshot, this.A.content.world.locations[snapshot.location].title);
    if (!saved) this.notice = { text: 'Checkpoint could not save: browser storage is unavailable.', until: this.time + 12 };
    return saved;
  }
  async newGame() {
    this.resetScene();
    const start = this.A.content.game.start, items = this.A.content.items;
    this.state = new GameState(start);
    for (const [id, n] of start.inventory) this.state.add(id, n, items, this.slots);
    this.player = null;
    const yaw = start.face ? yawTo(start.at[0], start.at[1], start.face[0], start.face[1]) : 0;
    this.checkpoint(start.room, start.at, yaw);
    await this.enterRoom(start.room, start.at[0], start.at[1], yaw);
    this.mode = 'play'; this.t = 0;
    this.script.fire('new_game');
  }
  async enterRoom(roomId, x, y, yaw, opts = {}) {
    const S = this.state, prev = this.room;
    if (prev) {
      // a stalker that was after you follows you through the door, a few seconds behind
      const hunter = opts.door && this.enemies.find(e => e.alive() && e.def.follow_doors && e.state !== 'idle');
      const followers = opts.door || opts.party ? this.enemies.filter(e => e.B === 'npc' && e.follow && e.alive()) : [];
      this.stashEnemies();
      followers.forEach((f, i) => Object.assign(S.enemies[f.id], { room: roomId, at: [x - 0.6 * (i + 1) * Math.sin(yaw * D2R), y + 0.6 * (i + 1) * Math.cos(yaw * D2R)], yaw }));
      if (hunter) { delete S.enemies[hunter.id]; S.pursuit = { id: hunter.id, snap: hunter.snapshot(), door: opts.door, room: roomId, timer: hunter.def.door_delay || 7 }; }
      else if (S.pursuit && opts.door) Object.assign(S.pursuit, { door: opts.door, room: roomId, timer: this.A.content.actors[S.pursuit.snap.type].door_delay || 7 });
      else if (S.pursuit && !opts.door) S.pursuit = null;             // cutscene room change: the chase is over
    }
    const locId = this.A.content.world.rooms[roomId].location;
    if (!this.location || this.location.id !== locId) this.location = await this.A.location(locId);
    const room = await this.A.room(roomId);
    this.room = room; S.room = roomId; S.location = locId; S.visited[roomId] = true;
    if (!this.player) this.player = new Player(this, x, y, yaw);
    const p = this.player;
    [p.x, p.y] = room.nearestWalkable(x, y, 4, p.r);
    p.z = room.floor(p.x, p.y); p.yaw = yaw; p.mode = 'move'; p.target = null; p.pickDone = null; p.invulnT = 0.8; p.quickTurn = 0; p.scripted = null; p.grab = null;
    p.anim.play('idle', { restart: true, fade: 0 }); p.updateHide();
    this.cam = -1; this.forcedCamera = null; this.flowField = null; this.particles = []; this.muzzle = null;
    this.projectiles = []; this.puddles = []; this.musicOverride = undefined;
    this.updateCamera();
    this.spawnRoomEnemies();
    this.updateMusic();
    Audio.wind(true, room.wind);
    for (const d of this.location.doors || []) for (const s of [d.a, d.b]) if (s.room === roomId) this.A.prefetch((s === d.a ? d.b : d.a).room);
    this.script.fire('enter_room', { room: roomId });
  }
  spawnRoomEnemies() {
    const S = this.state, rid = S.room;
    this.enemies = [];
    for (const sp of this.location.enemies || []) {
      if (sp.room === rid && !S.dead[sp.id] && !S.enemies[sp.id] && S.pursuit?.id !== sp.id && check(sp.when, this)) this.enemies.push(new Enemy(this, sp));
    }
    for (const [id, snap] of Object.entries(S.enemies)) if (snap.room === rid) this.enemies.push(new Enemy(this, { ...snap, id }));
    // the dead stay where they fell (RE2): corpses persist across room changes and saves
    for (const [id, c] of Object.entries(S.corpses || {})) if (c.room === rid) this.enemies.push(new Enemy(this, { ...c, id, state: 'dead', through: true }));
  }
  stashEnemies() {
    for (const e of this.enemies) {
      if (e.state === 'gone') continue;
      if (e.alive()) this.state.enemies[e.id] = e.snapshot(); else delete this.state.enemies[e.id];
      if (e.state === 'dead' && this.state.corpses?.[e.id]) Object.assign(this.state.corpses[e.id], { at: [e.x, e.y], yaw: e.yaw });
    }
  }
  spawnEnemy(spec) {
    const s = { room: this.state.room, ...spec };
    const c = spec.at_corpse && this.state.corpses?.[spec.at_corpse];
    if (c) { s.at = c.at; s.room = c.room; s.yaw ??= c.yaw; s.through = true; }
    const src = spec.at_actor && this.enemies.find(e => e.id === spec.at_actor);
    if (src) { const j = spec.jitter ?? 0.8; s.at = [src.x + (Math.random() - 0.5) * 2 * j, src.y + (Math.random() - 0.5) * 2 * j]; }
    delete this.state.dead[s.id]; delete this.state.corpses[s.id];
    if (s.room !== this.state.room) { this.state.enemies[s.id] = { ...s, yaw: s.yaw || 0, state: s.state || 'chase' }; return; }
    const old = this.enemies.find(e => e.id === s.id);
    if (old) old.state = 'gone';
    const e = new Enemy(this, s);
    this.enemies.push(e);
    return e;
  }
  removeEnemy(id) {
    const e = this.enemies.find(x => x.id === id);
    if (e) e.state = 'gone';
    delete this.state.enemies[id];
    if (this.state.corpses) delete this.state.corpses[id];
    this.state.dead[id] = true;
  }
  // replace some enemies with a new one, placed at their midpoint (or at v.at)
  transform(v) {
    const gone = this.enemies.filter(e => v.remove.includes(e.id));
    let [mx, my] = v.at || (gone.length ? [gone.reduce((s, e) => s + e.x, 0) / gone.length, gone.reduce((s, e) => s + e.y, 0) / gone.length] : [this.player.x, this.player.y]);
    v.remove.forEach(id => this.removeEnemy(id));
    this.spawnEnemy({ ...v.spawn, at: [mx, my], face: v.spawn.face || 'player' });
  }
  chapterEnd(v) {
    this.stashEnemies();
    this.chapter = { ...v, hasNext: !!this.A.content.world.locations[v.next] };
    this.mode = 'chapter'; this.t = 0;
    this.music.play(null);
  }
  async continueToNext() {
    const next = this.chapter.next;
    this.mode = 'loading';
    const loc = await this.A.location(next);
    const e = loc.entry || {};
    const room = e.room || loc.rooms[0];
    this.mode = 'loading';
    this.state.pursuit = null;
    // a new chapter starts clean: the last one's cutscene state never leaks across
    this.script.running = []; this.cinematic = false; this.forcedCamera = null; this.musicOverride = undefined;
    Object.assign(this.fx, { fade: 0, fadeTo: 0, whiteout: 0, shake: 0, card: null });
    if (this.player) { this.player.hidden = false; this.player.scripted = null; }
    this.state.enemies = {}; this.state.corpses = {}; this.state.dead = {};   // actors belong to their chapter
    this.checkpoint(room, e.at || [0, 0], e.yaw || 0);
    await this.enterRoom(room, ...(e.at || [0, 0]), e.yaw || 0);
    this.mode = 'play'; this.t = 0;
    if (loc.card) this.titleCard(loc.card);
  }
  titleCard(c) { this.fx.card = { text: c.text || c, sub: c.sub || '', t: 0, dur: c.t || 4 }; }

  // ---------------------------------------------------------------- saving
  saveTo(slot) {
    const S = this.state, p = this.player;
    this.stashEnemies();
    S.pos = { x: p.x, y: p.y, yaw: p.yaw };
    const saved = GameState.from(S.toJSON());
    saved.consume('ink_ribbon', 1); saved.saves++;
    if (!Saves.write(slot, saved, this.room.name)) return false;
    S.consume('ink_ribbon', 1); S.saves++;
    return true;
  }
  async loadFrom(slot) {
    const st = slot === 'checkpoint' ? Saves.readCheckpoint() : Saves.read(slot);
    if (!st) return false;
    this.mode = 'loading';
    this.resetScene();
    this.state = st; this.player = null; this.room = null; this.location = null;
    this.cinematic = false; this.fx.fade = this.fx.fadeTo = 0; this.fx.card = null; this.script.running = [];
    await this.enterRoom(st.room, st.pos.x, st.pos.y, st.pos.yaw, { load: true });
    this.mode = 'play'; this.t = 0;
    return true;
  }

  // ---------------------------------------------------------------- interaction
  candidates() {
    const S = this.state, L = this.location, rid = S.room, out = [];
    for (const d of L.doors || []) for (const side of ['a', 'b']) if (d[side].room === rid && check(d.when, this)) out.push({ kind: 'door', at: d[side].at, r: d[side].r, door: d, side });
    for (const pk of L.pickups || []) if (pk.room === rid && !S.taken[pk.id] && check(pk.when, this)) out.push({ kind: 'pickup', at: pk.at, r: pk.r, pk });
    for (const ex of L.examine || []) if (ex.room === rid && check(ex.when, this)) out.push({ kind: 'examine', at: ex.at, r: ex.r, ex });
    for (const tw of L.typewriters || []) if (tw.room === rid) out.push({ kind: 'typewriter', at: tw.at, r: tw.r });
    for (const b of L.item_boxes || []) if (b.room === rid) out.push({ kind: 'box', at: b.at, r: b.r });
    return out;
  }
  interactionId(c) { return [c.kind, c.pk?.id || c.ex?.id || c.door?.id || '', ...c.at].join(':'); }
  nearby(filter = () => true) {
    const p = this.player;
    return this.candidates().filter(c => {
      if (!filter(c)) return false;
      const d = Math.hypot(c.at[0] - p.x, c.at[1] - p.y);
      if (d > c.r) return false;
      // Small pickups should not disappear because Bryan is a few degrees off.
      return c.kind === 'pickup' || d <= 0.85 || Math.abs(angDiff(yawTo(p.x,p.y,...c.at),p.yaw)) <= 100;
    }).sort((a,b) => {
      const score = c => Math.hypot(c.at[0]-p.x,c.at[1]-p.y) -
        (c.kind === 'pickup' ? 2.1 : c.kind === 'examine' ? (c.ex.ask || c.ex.do || (c.ex.use && this.state.has(c.ex.use.item)) ? .8 : 0) : .4);
      return score(a)-score(b);
    });
  }
  nearest(filter) {
    const list = this.nearby(filter);
    return list.find(c => this.interactionId(c) === this.interactionKey) || list[0] || null;
  }
  cycleInteraction() {
    const list = this.nearby();
    if (list.length < 2) return;
    const key = this.interactionId(this.nearest());
    const index = list.findIndex(c => this.interactionId(c) === key);
    this.interactionKey = this.interactionId(list[(index+1)%list.length]);
    this.sfx('cursor');
  }
  interactionLabel(c) {
    if (c.kind === 'pickup') return 'Take ' + this.A.content.items[c.pk.item].name;
    if (c.kind === 'box') return 'Open ITEM BOX';
    if (c.kind === 'typewriter') return 'Save at TYPEWRITER';
    if (c.kind === 'door') return 'Open ' + (c.door.transition === 'gate' ? 'GATE' : 'DOOR');
    if (c.ex.use && this.state.has(c.ex.use.item)) return 'Use ' + this.A.content.items[c.ex.use.item].name;
    return c.ex.label || (c.ex.ask ? c.ex.ask.replace(/\?$/, '') : 'Inspect');
  }
  interact() {
    const best = this.nearest();
    if (!best) return;
    this.sfx('confirm');
    if (best.kind === 'door') return this.tryDoor(best.door, best.side);
    if (best.kind === 'examine') return this.examine(best.ex);
    if (best.kind === 'typewriter') {
      if (!this.state.has('ink_ribbon')) return this.ui.say(["It's a typewriter.", 'You need an INK RIBBON to record your progress.']);
      return this.ui.ask('Will you use an INK RIBBON to record your progress?', () => { this.mode = 'save'; this.sel = 0; });
    }
    if (best.kind === 'box') { this.sfx('box'); return this.ui.openBox(); }
    const pk = best.pk, S = this.state, def = this.A.content.items[pk.item], p = this.player;
    if (def.kind === 'file') {                                // documents go to FILES, not the item slots (RE2)
      return this.ui.ask(pk.ask || `Will you take the ${def.name}?`, () => {
        S.taken[pk.id] = true; S.files[def.file] = true; this.sfx('pickup');
        this.ui.readFile(def.file);
        if (pk.do) this.script.start(pk.do, pk.id);
        this.script.fire('pickup', { id: pk.id });
      });
    }
    const stacks = S.inventory.find(i => i.id === pk.item) && def.kind !== 'weapon';
    if (!def.held && !stacks && S.inventory.length >= this.slots) return this.ui.say(['There is no more room to carry anything.', 'Leave something in an ITEM BOX.']);
    this.ui.ask(pk.ask || `Will you take the ${def.name}?`, () => {
      p.mode = 'pickup'; p.anim.play('pickup', { restart: true });
      p.pickDone = () => {
        S.add(pk.item, pk.count ?? 1, this.A.content.items, this.slots);
        if (def.kind === 'weapon' && !(S.equipped && S.has(S.equipped))) { S.equipped = pk.item; p.updateHide(); }   // empty hands take the gun
        S.taken[pk.id] = true;
        this.sfx('pickup');
        if (pk.taken) this.ui.say(pk.taken);
        if (pk.do) this.script.start(pk.do, pk.id);
        this.script.fire('pickup', { id: pk.id });
      };
    });
  }
  // examine points can also take an item: {use: {item, ask?, keep?, do}}
  examine(ex) {
    const U = ex.use, S = this.state, items = this.A.content.items;
    if (U && S.has(U.item)) {
      const name = items[U.item].name;
      return this.ui.ask(U.ask || `Will you use the ${name}?`, () => this.useAt(ex), () => {});
    }
    if (ex.ask) return this.ui.ask(ex.ask, () => ex.do && this.script.start(ex.do, ex.id), () => {});
    if (ex.text) this.ui.say(ex.text);
    if (ex.do) this.script.start(ex.do, ex.id);
  }
  useAt(ex) {
    const U = ex.use;
    if (!U.keep) this.state.consume(U.item, 1);
    this.state.flags['used:' + ex.id] = true;
    this.script.fire('use_item', { item: U.item, id: ex.id });
    if (U.do) this.script.start(U.do, ex.id);
  }
  // USE from the inventory: the nearest door or examine point that wants this item
  useItem(id) {
    const c = this.nearest(c => (c.kind === 'door' && c.door.lock?.key === id && !this.state.flags['door:' + c.door.id]) ||
                                (c.kind === 'examine' && c.ex.use?.item === id));
    if (!c) return this.ui.say(["There's no need to use it here."]);
    this.ui.menu = null;
    if (c.kind === 'door') return this.tryDoor(c.door, c.side);
    return this.useAt(c.ex);
  }
  give(id, n) {
    if (this.state.add(id, n, this.A.content.items, this.slots)) return true;
    // Scripted rewards must never vanish when all inventory slots are occupied.
    const stack = this.state.box.find(i => i.id === id && !this.A.content.items[id].weapon);
    if (stack) stack.n += n; else this.state.box.push({ id, n });
    this.notice = { text: 'Inventory full: reward sent to ITEM BOX.', until: this.time + 8 };
    return false;
  }

  // ---------------------------------------------------------------- doors & room changes
  // door fields: lock {key?, text?, if?}, oneway 'a'|'b' (+ oneway_text), requires {if, text}, when,
  //              transition (see TRANSITIONS; 'fade' for a plain fade)
  tryDoor(door, side) {
    const S = this.state, id = door.id, items = this.A.content.items;
    const open = !!S.flags['door:' + id];
    if (door.requires && !check(door.requires.if, this)) { this.ui.say(door.requires.text); return; }
    if (door.oneway && door.oneway !== side && !open) { this.sfx('locked'); this.ui.say(door.oneway_text || ["It's locked from the other side."]); return; }
    const L = door.lock;
    if (L && !open) {
      if (L.key && S.has(L.key)) {
        S.flags['door:' + id] = true;
        this.sfx('unlock');
        const def = items[L.key];
        this.ui.say([`You used the ${def.name}.`], () => this.maybeDiscard(L.key));
        this.script.fire('unlock', { door: id });
        return;
      }
      if (L.if && check(L.if, this)) S.flags['door:' + id] = true;
      else { this.sfx('locked'); this.ui.say(L.text || ["It's locked."]); return; }
    }
    if (door.oneway && door.oneway === side) S.flags['door:' + id] = true;
    this.startDoor(door, side);
  }
  // a key is done with once every door it opens is open
  maybeDiscard(key) {
    const def = this.A.content.items[key], S = this.state;
    const doors = def.key_for || [];
    if (!doors.length || !doors.every(d => S.flags['door:' + d])) return;
    this.ui.ask(`The ${def.name} is no longer needed. Discard it?`, () => { S.consume(key, 99); this.sfx('cursor'); }, () => {});
  }
  unlockDoor(id, on = true) { if (on) this.state.flags['door:' + id] = true; else delete this.state.flags['door:' + id]; }
  startDoor(door, side) {
    const to = side === 'a' ? door.b : door.a;
    const tr = door.transition && typeof door.transition === 'object' ? door.transition[side] : door.transition;
    const kind = door.fade ? 'fade' : tr || (door.model && door.model !== 'door' ? door.model : 'door');
    const T = TRANSITIONS[kind];
    this.mode = 'door'; this.t = 0; this.sfx(T ? T.sfx : 'door');
    this.door = { door, to, kind, ready: false, finishing: false };
    const pendingDoor = this.door;
    this.A.room(to.room).then(() => { pendingDoor.ready = true; }).catch(error => this.fail(error));
  }
  gotoRoom(room, at, yaw, transition = 'fade') {
    this.mode = 'door'; this.t = 0;
    const T = TRANSITIONS[transition];
    if (T) this.sfx(T.sfx);
    this.door = { door: { id: null }, kind: transition, to: { room, spawn: at, yaw }, ready: false, finishing: false };
    const pendingDoor = this.door;
    this.A.room(room).then(() => { pendingDoor.ready = true; }).catch(error => this.fail(error));
  }
  updateCamera() {
    const p = this.player;
    if (this.forcedCamera) { const k = this.room.cameras.findIndex(c => c.id === this.forcedCamera); if (k >= 0) { this.cam = k; return; } }
    const c = this.room.camera(p.x, p.y, this.cam);
    if (c >= 0 && c !== this.cam) { this.cam = c; this.flowField = null; }
    if (this.cam < 0) this.cam = 0;
  }
  prefetchVisited() { for (const r of this.location.rooms) if (this.state.visited[r]) this.A.prefetch(r); }
  // the room's track, unless a script overrides it or something is hunting you
  updateMusic() {
    if (!this.room) return;
    const hunter = this.enemies.find(e => e.def.chase_music && e.hostile() && e.state !== 'idle');
    const want = hunter ? hunter.def.chase_music : this.musicOverride !== undefined ? this.musicOverride : this.room.music;
    this.music.play(want);
  }

  // ---------------------------------------------------------------- combat
  pickTarget() {
    const p = this.player, R = this.room;
    let best = null, bs = 1e9;
    for (const e of this.enemies) {
      if (!e.hostile()) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y), a = Math.abs(angDiff(yawTo(p.x, p.y, e.x, e.y), p.yaw));
      if (d > (p.weapon()?.range || 16) || a > 80 || !R.shotLos(p.x, p.y, p.z + 1.35, e.x, e.y, e.z + e.chest())) continue;
      if (d + a / 20 < bs) { bs = d + a / 20; best = e; }
    }
    return best;
  }
  shoot(p, w) {
    const R = this.room;
    for (const e of this.enemies) if (e.state === 'idle' && Math.hypot(e.x - p.x, e.y - p.y) < (e.def.hear || 20)) e.alert();
    const targets = this.enemies.filter(e => e.hostile())
      .map(e => ({ e, d: Math.hypot(e.x - p.x, e.y - p.y), a: Math.abs(angDiff(yawTo(p.x, p.y, e.x, e.y), p.yaw)) }))
      .filter(t => t.d < w.range && t.a < w.cone * (t.e.B === 'swarm' ? 1.6 : 1) && R.shotLos(p.x, p.y, p.z + 1.35, t.e.x, t.e.y, t.e.z + t.e.chest()))
      .sort((a, b) => a.d - b.d);
    this.onShot?.(p, targets);                                // test-harness hook
    for (const t of w.spread ? targets : targets.slice(0, 1)) {
      const dmg = (w.damage.find(([dd]) => t.d < dd) || [0, 0])[1];
      t.e.damage(dmg, w.spread && t.d < (w.heavy_within || 0), p.yaw);
    }
  }
  // spitters lob acid in an arc at where you stand
  spawnProjectile(e, target) {
    const f = fwd(e.yaw), x = e.x + f[0] * 0.4, y = e.y + f[1] * 0.4, z = e.z + (e.def.mouth || 1.5);
    const dx = target.x - x, dy = target.y - y, dz = target.z + 1.0 - z, d = Math.hypot(dx, dy);
    const T = 0.35 + d / 7;
    this.projectiles.push({ x, y, z, vx: dx / T, vy: dy / T, vz: (dz + 4.5 * T * T) / T, dmg: e.def.spit_damage || 12, t: 0 });
  }
  updateProjectiles() {
    const p = this.player, R = this.room;
    for (const q of this.projectiles) {
      q.x += q.vx * DT; q.y += q.vy * DT; q.z += q.vz * DT; q.vz -= 9 * DT; q.t += DT;
      const hitP = Math.hypot(q.x - p.x, q.y - p.y) < 0.45 && q.z > p.z && q.z < p.z + 1.8;
      const ground = q.z <= R.floor(q.x, q.y) || !R.walkable(q.x, q.y) && q.z < R.floor(q.x, q.y) + 1;
      if (hitP || ground || q.t > 4) {
        q.dead = true;
        this.sfx('splat', this.pan(q.x, q.y));
        if (hitP) p.hurt(q.dmg, { slow: 2 });
        if (R.walkable(q.x, q.y)) this.puddles.push({ x: q.x, y: q.y, z: R.floor(q.x, q.y), t: 7, r: 0.6, tick: 0 });
        this.splash(q.x, q.y, Math.max(q.z, R.floor(q.x, q.y)));
      }
    }
    this.projectiles = this.projectiles.filter(q => !q.dead);
    for (const u of this.puddles) {
      u.t -= DT; u.tick -= DT;
      if (u.tick <= 0 && Math.hypot(p.x - u.x, p.y - u.y) < u.r && p.mode !== 'dead') { u.tick = 0.9; p.hurt(3, { slow: 1 }); }
    }
    this.puddles = this.puddles.filter(u => u.t > 0);
  }
  refreshFlow() { this.flowField = this.room.flow(this.player.x, this.player.y); }
  blood(x, y, z, n) {
    if (this.headless) return;
    for (let i = 0; i < n; i++) this.particles.push({ x, y, z, vx: (Math.random() - 0.5) * 2.2, vy: (Math.random() - 0.5) * 2.2, vz: Math.random() * 2.2, t: 0.5 + Math.random() * 0.4, c: [128, 8, 8] });
  }
  splash(x, y, z) {
    if (this.headless) return;
    for (let i = 0; i < 10; i++) this.particles.push({ x, y, z, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2, vz: Math.random() * 1.8, t: 0.4 + Math.random() * 0.3, c: [150, 190, 40] });
  }
  onEnemyDead(e) {
    const S = this.state;
    S.dead[e.id] = true; S.stats.kills++; delete S.enemies[e.id];
    if (!e.def.no_corpse) (S.corpses ||= {})[e.id] = { type: e.type, room: e.room || S.room, at: [e.x, e.y], yaw: e.yaw };
    this.script.fire('enemy_dead', { id: e.id });
  }
  onPlayerDeath() { this.deathT = 0; }
  pan(x, y) {
    if (!this.room) return 0;
    const c = this.room.cameras[this.cam].cam.project(x, y, 1);
    return c ? Math.max(-0.8, Math.min(0.8, (c[0] - 160) / 200)) : 0;
  }
  sfx(name, arg) {
    if (!name) return;
    const s = Audio.sfx;
    if (name === 'moan_deep') return s.moan(arg, true);
    if (s[name]) s[name](arg);
  }
  blocksActor(actor,x,y) {
    for(const e of this.enemies){
      const box=e.def?.solidFootprint;if(e===actor||!box||!e.alive()||e.hidden)continue;
      const a=e.yaw*D2R,dx=x-e.x,dy=y-e.y,lx=dx*Math.cos(a)+dy*Math.sin(a),ly=-dx*Math.sin(a)+dy*Math.cos(a);
      if(Math.abs(lx)<box[0]+actor.r&&Math.abs(ly)<box[1]+actor.r)return true;
    }
    return false;
  }
  separate() {
    const all = [this.player, ...this.enemies.filter(e => e.alive() && !e.hidden && e.state !== 'grab' && e.B !== 'prop')];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = a.r + b.r;
      if (d > 0 && d < m) { const k = (m - d) / d * 0.5; b.move(dx * k, dy * k); a.move(-dx * k, -dy * k); }
    }
  }

  // ---------------------------------------------------------------- per-frame
  update(I) {
    this.time += DT; this.t += DT;
    const fx = this.fx;
    fx.shake = Math.max(0, fx.shake - DT); fx.whiteout = Math.max(0, fx.whiteout - DT);
    if (fx.fade !== fx.fadeTo) fx.fade = fx.fade < fx.fadeTo ? Math.min(fx.fadeTo, fx.fade + fx.fadeRate * DT) : Math.max(fx.fadeTo, fx.fade - fx.fadeRate * DT);
    if (fx.card && (fx.card.t += DT) > fx.card.dur) fx.card = null;
    switch (this.mode) {
      case 'title': return this.updateTitle(I);
      case 'intro':
        if (I.confirmPressed && this.t > 0.15) {
          if (!this.introReveal && this.t * 40 < this.ui.introLength()) this.introReveal = true;
          else if ((this.introPage || 0) < this.ui.introPages().length - 1) { this.introPage = (this.introPage || 0) + 1; this.introReveal = false; this.t = 0; }
          else { this.mode = 'loading'; this.newGame().catch(error => this.fail(error)); }
        }
        return;
      case 'loading': case 'error': return;
      case 'load': case 'save': return this.updateSlots(I);
      case 'door':
        if (this.t >= 2.6 && this.door.ready && !this.door.finishing) {
          this.door.finishing = true;
          const to = this.door.to;
          this.enterRoom(to.room, to.spawn[0], to.spawn[1], to.yaw ?? 0, { door: this.door.door.id }).then(() => { this.mode = 'play'; this.t = 0; }).catch(error => this.fail(error));
        }
        return;
      case 'dead':
        this.player.anim.update(DT);
        if (this.t > 2 && I.confirmPressed) { if (Saves.readCheckpoint()) { this.loadFrom('checkpoint').catch(error => this.fail(error)); } else if (Saves.any()) { this.mode = 'load'; this.sel = 0; this.slotBack = 'dead'; } else { this.mode = 'loading'; this.newGame().catch(error => this.fail(error)); } }
        if (this.t > 2 && I.cancelPressed) { this.mode = 'title'; this.t = 0; this.music.play(null); }
        return;
      case 'chapter':
        if (this.t > 4 && I.confirmPressed) {
          if ((this.chapter.page || 0) < this.ui.chapterPages(this.chapter).length - 1) { this.chapter.page = (this.chapter.page || 0) + 1; }
          else if (this.chapter.hasNext) this.continueToNext().catch(error => this.fail(error));
          else { this.mode = 'title'; this.t = 0; }
        }
        return;
      case 'play': return this.updatePlay(I);
    }
  }
  titleOptions() { return [...(Saves.readCheckpoint() ? ['CONTINUE'] : []), 'NEW GAME', ...(Saves.any() ? ['LOAD GAME'] : [])]; }
  updateTitle(I) {
    const has = Saves.any();
    const opts = this.titleOptions();
    this.sel = Math.min(this.sel, opts.length - 1);
    if (I.upPressed || I.downPressed) { this.sel = (this.sel + opts.length + (I.upPressed ? -1 : 1)) % opts.length; this.sfx('cursor'); }
    if (I.confirmPressed) {
      Audio.init();
      this.sfx('confirm');
      if (opts[this.sel] === 'CONTINUE') { this.loadFrom('checkpoint').catch(error => this.fail(error)); }
      else if (opts[this.sel] === 'LOAD GAME' && has) { this.mode = 'load'; this.sel = 0; this.slotBack = 'title'; }
      else { this.mode = 'intro'; this.t = 0; this.introPage = 0; this.introReveal = false; }
    }
  }
  updateSlots(I) {
    if (I.upPressed || I.downPressed) { this.sel = (this.sel + (I.upPressed ? 2 : 1)) % 3; this.sfx('cursor'); }
    if (I.cancelPressed) { this.mode = this.mode === 'save' ? 'play' : this.slotBack || 'title'; return; }
    if (!I.confirmPressed) return;
    if (this.mode === 'save') { const saved = this.saveTo(this.sel); this.sfx(saved ? 'confirm' : 'locked'); this.mode = 'play'; this.ui.say([saved ? 'Your progress has been recorded.' : 'Could not save. Storage may be full or disabled. Your ink ribbon was kept.']); }
    else if (Saves.list()[this.sel]) { this.sfx('confirm'); this.loadFrom(this.sel).catch(error => this.fail(error)); }
  }
  updatePlay(I) {
    const S = this.state, p = this.player;
    S.time += DT;
    if (this.ui.update(I)) return;                            // messages / menu / files pause the world
    if (!this.cinematic && p.mode !== 'dead' && p.mode !== 'grabbed') {
      if (I.menuPressed) return this.ui.openMenu('items');
      if (I.mapPressed) return this.ui.openMenu('map');
    }
    if (S.infect_rate && p.mode !== 'dead') S.infection = Math.min(100, (S.infection || 0) + S.infect_rate * DT);
    if (!this.cinematic && p.mode === 'move' && I.cyclePressed) this.cycleInteraction();
    p.update(I);
    if (this.mode !== 'play' || this.ui.modal()) return;
    for (const e of this.enemies) e.update();
    if (!this.cinematic) this.separate();
    this.updateCamera();
    if (!this.cinematic) this.updateProjectiles();
    this.script.tick();
    this.script.update(DT);
    if (S.pursuit && S.pursuit.room === S.room && (S.pursuit.timer -= DT) <= 0) this.pursuerArrives();
    for (const q of this.particles) { q.x += q.vx * DT; q.y += q.vy * DT; q.z += q.vz * DT; q.vz -= 9 * DT; q.t -= DT; }
    this.particles = this.particles.filter(q => q.t > 0);
    if (this.muzzle && --this.muzzle.t <= 0) this.muzzle = null;
    if (Math.floor(this.time * 2) !== Math.floor((this.time - DT) * 2)) this.updateMusic();
    if (p.mode === 'dead' && (this.deathT += DT) > 1.8 && this.mode === 'play') { this.mode = 'dead'; this.t = 0; this.music.play(null); }
    if (S.hp <= 33 && S.hp > 0 && Math.floor(this.time * 1.2) !== Math.floor((this.time - DT) * 1.2)) this.sfx('heartbeat');
  }
  pursuerArrives() {
    const P = this.state.pursuit, d = (this.location.doors || []).find(x => x.id === P.door);
    this.state.pursuit = null;
    if (!d) return;
    const side = d.a.room === this.state.room ? d.a : d.b;
    this.sfx('door');
    this.spawnEnemy({ ...P.snap, id: P.id, room: this.state.room, at: side.spawn, face: 'player', state: 'chase' });
  }

  fail(error) { console.error(error); this.mode = 'error'; this.error = error.message || String(error); this.onError?.(error); }

  // ---------------------------------------------------------------- drawing
  draw() {
    if (this.headless) return;
    const fb = this.fb, U = this.ui;
    switch (this.mode) {
      case 'title': U.drawTitle(this.sel, Saves.any()); break;
      case 'intro': U.drawIntro(this.t); break;
      case 'error': fb.fill(0, 0, 0); U.center('Unable to load this scene.', 90); U.center('Reload the page to retry.', 112); break;
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
    if (C.plate) fb.blit((fb.scale > 1 && C.plateHD ? C.plateHD : C.plate).px); else fb.fill(0, 0, 0);
    fb.sceneDepth(C.depth);
    for (const s of C.sprites) if (s.img && !S.taken[s.pickup]) PSX.blitSprite(fb, s.img, s.x, s.y);
    const boost = this.muzzle ? 0.5 : 0;
    const inst = this.player.hidden ? [] : [this.player.instance(this.cam, boost)];
    for (const e of this.enemies) if (e.state !== 'gone' && !e.hidden) inst.push(e.instance(this.cam, boost * 0.6));
    const cam = C.cam;
    PSX.render(fb, cam, inst, null);
    if (this.muzzle && inst.length) {
      const m = this.muzzle.muzzle, c = Math.cos(m.rot * D2R), s = Math.sin(m.rot * D2R), L = m.local;
      const w = PSX.partPoint(inst[0], this.muzzle.part, [L[0], L[1] * c - L[2] * s, L[1] * s + L[2] * c]);
      const pr = cam.project(w[0], w[1], w[2]);
      if (pr) star(fb, pr[0] | 0, pr[1] | 0, m.size);
    }
    const dot = (x, y, z, sz, c) => {
      const pr = cam.project(x, y, z);
      if (!pr) return;
      const px = pr[0] | 0, py = pr[1] | 0;
      if (px < 0 || py < 0 || px >= 319 || py >= 239 || pr[2] > C.depth[py * 320 + px] + 0.05) return;
      PSX.rect(fb, px, py, sz, sz, c[0], c[1], c[2]);
    };
    for (const u of this.puddles) for (let k = 0; k < 10; k++) {
      const a = k / 10 * 6.283 + u.x, rr = u.r * (0.4 + 0.5 * ((k * 7) % 3) / 2);
      dot(u.x + Math.cos(a) * rr, u.y + Math.sin(a) * rr, u.z + 0.02, 2, [70, 110, 20]);
    }
    for (const q of this.projectiles) dot(q.x, q.y, q.z, 3, [160, 210, 50]);
    for (const q of this.particles) dot(q.x, q.y, q.z, 2, q.c);
    if (this.fx.whiteout > 0 && !this.reducedMotion) PSX.tintScreen(fb, 255, 255, 255, Math.min(1, this.fx.whiteout * 1.6));
    if (this.player.flashT > 0) PSX.tintScreen(fb, 160, 0, 0, 0.18);
    if (this.cinematic) { PSX.rect(fb, 0, 0, 320, 26, 0, 0, 0); PSX.rect(fb, 0, 214, 320, 26, 0, 0, 0); }
    if (this.fx.fade > 0) PSX.darken(fb, 1 - this.fx.fade);
    if (this.fx.card) this.ui.drawCard(this.fx.card);
  }
  drawDoor() {
    const fb = this.fb, t = this.t, D = this.door;
    fb.fill(0, 0, 0); fb.depth = null;
    const T = TRANSITIONS[D.kind];
    if (T) {
      const [eye, at] = T.view(t);
      if (T.shake) { const k = T.shake(t); eye[0] += (Math.random() - 0.5) * k * 0.1; eye[2] += (Math.random() - 0.5) * k * 0.1; }
      const model = this.A.models[D.door.model || T.model];
      PSX.render(fb, PSX.Camera.lookAt(eye, at, 230), [{ model, x: 0, y: 0, z: 0, yaw: 0, pose: T.pose(t) }], new PSX.Lights(...T.light));
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
