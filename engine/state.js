// Everything that survives a save: where Bryan is, what he carries, what the
// world remembers (flags, taken pickups, dead or relocated enemies, fired triggers).

export class GameState {
  constructor(start) {
    this.location = start.location;
    this.room = start.room;
    this.pos = { x: start.at[0], y: start.at[1], yaw: 0 };
    this.hp = start.hp ?? 100;
    this.inventory = [];            // [{id, n}]
    this.equipped = start.equipped || null;
    this.mag = {};                  // weapon id -> rounds loaded
    this.flags = {};
    this.taken = {};                // pickup id -> true
    this.dead = {};                 // enemy id -> true
    this.enemies = {};              // enemy id -> {type, room, x, y, yaw, hp, state} (persisted positions)
    this.fired = {};                // trigger id -> true
    this.visited = {};              // room id -> true
    this.pursuit = null;            // {id, room, door, timer} a stalker following through a door
    this.files = {};                // file id -> true (read)
    this.time = 0;                  // play time, seconds
    this.saves = 0;
    this.stats = { shots: 0, kills: 0, damage: 0 };
    this.corpses = {};              // enemy id -> {type, room, at, yaw}: bodies stay where they fell
    this.held = {};                 // story items outside the slots
    this.box = [];                  // item box contents (shared by every box, like RE2)
    this.infection = 0;             // 0..100: the bite spreading (drawn on Bryan's arm)
    this.infect_rate = 0;           // per second, set by the story
  }
  toJSON() { return { ...this }; }
  static from(obj) {
    const copy = JSON.parse(JSON.stringify(obj));
    const s = new GameState({ room: copy.room, location: copy.location, at: [copy.pos?.x || 0, copy.pos?.y || 0] });
    Object.assign(s, copy);
    return s;
  }

  has(id, n = 1) { if (this.held?.[id]) return true; const it = this.inventory.find(i => i.id === id); return !!it && (n <= 1 || it.n >= n); }   // an empty gun is still carried
  count(id) { if (this.held?.[id]) return 1; const it = this.inventory.find(i => i.id === id); return it ? it.n : 0; }
  add(id, n, items, slots) {
    const def = items[id] || {};
    if (def.held) { (this.held ||= {})[id] = true; return true; }       // story items carried outside the 8 slots (the B7 cooler)
    const it = this.inventory.find(i => i.id === id);
    if (it && def.kind !== 'weapon') { it.n += n; return true; }
    if (it) return true;
    if (this.inventory.length >= slots) return false;
    this.inventory.push({ id, n });
    if (def.kind === 'weapon') this.mag[id] = n;
    return true;
  }
  consume(id, n = 1) {
    if (this.held?.[id]) { delete this.held[id]; return true; }
    const it = this.inventory.find(i => i.id === id);
    if (!it) return false;
    it.n -= n;
    if (it.n <= 0) this.inventory = this.inventory.filter(i => i !== it);
    return true;
  }
}

// ------------------------------------------------------------------ saves (3 slots, like the originals)
const KEY = 're_farm_saves_v1';
const CHECKPOINT = 're_farm_checkpoint_v1';
function valid(entry) {
  const s = entry?.state;
  return !!s && typeof s.room === 'string' && typeof s.location === 'string' &&
    Number.isFinite(s.pos?.x) && Number.isFinite(s.pos?.y) && Number.isFinite(s.pos?.yaw) &&
    Number.isFinite(s.hp) && Array.isArray(s.inventory) && s.inventory.every(i => typeof i.id === 'string' && Number.isFinite(i.n)) &&
    ['flags','taken','dead','enemies','fired','visited','mag','files','stats'].every(k => s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]));
}
export const Saves = {
  store: null,
  _get() { try { const s = JSON.parse((this.store || globalThis.localStorage)?.getItem(KEY) || '[]'); return Array.isArray(s) ? s : []; } catch { return []; } },
  _put(v, key = KEY) {
    try {
      const storage = this.store || globalThis.localStorage;
      if (!storage) return false;
      storage.setItem(key, JSON.stringify(v)); return true;
    } catch { return false; }
  },
  list() { const s = this._get(); return [0, 1, 2].map(i => valid(s[i]) ? s[i] : null); },
  write(slot, state, roomName) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 2) return false;
    const s = this._get();
    s[slot] = { state: state.toJSON(), room: roomName, time: state.time, saves: state.saves, date: Date.now() };
    return this._put(s);
  },
  read(slot) { const e = this.list()[slot]; return e ? GameState.from(e.state) : null; },
  any() { return this.list().some(Boolean); },
  writeCheckpoint(state, room) { return this._put({ state: state.toJSON(), room, date: Date.now() }, CHECKPOINT); },
  readCheckpoint() {
    try { const e = JSON.parse((this.store || globalThis.localStorage)?.getItem(CHECKPOINT) || 'null'); return valid(e) ? GameState.from(e.state) : null; } catch { return null; }
  },
};
