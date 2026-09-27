// Story scripting: triggers fire action lists that run as small coroutines
// (RE's room scripts, as data). Conditions and actions are plain JSON in
// content/locations/<id>/location.json.
//
// Trigger events: new_game, enter_room{room}, zone{room, rect}, enemies_dead{ids, mode},
//                 pickup{id}, flag{flag}
// Conditions:     {flag} {not} {all:[]} {any:[]} {has} {taken} {dead} {room} {equipped}
// Actions:        say, set, unset, give, take_item, read, spawn, transform, remove, sfx, music,
//                 shake, whiteout, wait, run, if, chapter_end, goto_room, camera, cinematic,
//                 actor, heal, damage, movie

export function check(cond, g) {
  if (!cond) return true;
  const S = g.state;
  if (Array.isArray(cond)) return cond.every(c => check(c, g));
  if ('all' in cond) return cond.all.every(c => check(c, g));
  if ('any' in cond) return cond.any.some(c => check(c, g));
  if ('not' in cond) return !check(cond.not, g);
  let ok = true;
  if ('flag' in cond) ok &&= [].concat(cond.flag).every(f => !!S.flags[f]);
  if ('has' in cond) ok &&= [].concat(cond.has).every(i => S.has(i));
  if ('taken' in cond) ok &&= [].concat(cond.taken).every(p => !!S.taken[p]);
  if ('dead' in cond) ok &&= [].concat(cond.dead).every(e => !!S.dead[e]);
  if ('room' in cond) ok &&= S.room === cond.room;
  if ('equipped' in cond) ok &&= S.equipped === cond.equipped;
  return ok;
}

class Coroutine {
  constructor(actions, label) { this.q = [...actions]; this.wait = 0; this.block = null; this.label = label; this.done = false; }
}

export class Script {
  constructor(game) { this.g = game; this.running = []; }

  // ---------------------------------------------------------------- triggers
  fire(event, info = {}) {
    const L = this.g.location;
    if (!L) return;
    for (const t of L.triggers || []) {
      if (t.on.event !== event) continue;
      if (t.once !== false && this.g.state.fired[t.id]) continue;
      if (!this.matches(t.on, info)) continue;
      if (!check(t.if, this.g)) continue;
      if (t.once !== false) this.g.state.fired[t.id] = true;
      this.start(t.do, t.id);
    }
  }
  matches(on, info) {
    switch (on.event) {
      case 'enter_room': return !on.room || on.room === info.room;
      case 'zone': return false;                                  // polled in tick()
      case 'enemies_dead': return false;                          // polled in tick()
      case 'pickup': return on.id === info.id;
      case 'flag': return on.flag === info.flag;
      default: return true;
    }
  }
  // polled triggers: zones and "these enemies are dead"
  tick() {
    const g = this.g, L = g.location, S = g.state, p = g.player;
    if (!L || !p) return;
    for (const t of L.triggers || []) {
      if (t.once !== false && S.fired[t.id]) continue;
      const on = t.on;
      let hit = false;
      if (on.event === 'zone') {
        const [x0, y0, x1, y1] = on.rect;
        hit = S.room === on.room && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      } else if (on.event === 'enemies_dead') {
        const dead = on.ids.filter(id => S.dead[id]).length;
        hit = on.mode === 'any' ? dead > 0 : dead === on.ids.length;
      }
      if (!hit || !check(t.if, g)) continue;
      if (t.once !== false) S.fired[t.id] = true;
      this.start(t.do, t.id);
    }
  }

  start(actions, label = '') { const c = new Coroutine(actions, label); this.running.push(c); this.step(c); return c; }

  update(dt) {
    for (const c of this.running) {
      if (c.done) continue;
      if (c.wait > 0) { c.wait -= dt; if (c.wait > 0) continue; }
      if (c.block && !this.unblocked(c)) continue;
      c.block = null;
      this.step(c);
    }
    this.running = this.running.filter(c => !c.done);
  }
  unblocked(c) {
    const g = this.g;
    switch (c.block) {
      case 'msg': return !g.ui.msg;
      case 'file': return !g.ui.file;
      case 'actor': return !c.actor || c.actor.arrived;
      case 'movie': return !g.ui.movie;
      default: return true;
    }
  }

  // run actions until one blocks or waits
  step(c) {
    while (c.q.length) {
      const a = c.q.shift();
      const r = this.exec(a, c);
      if (r === 'stop') { c.q.length = 0; break; }
      if (c.wait > 0 || c.block) return;
    }
    if (!c.q.length && !c.wait && !c.block) c.done = true;
  }

  exec(a, c) {
    const g = this.g, S = g.state;
    const k = Object.keys(a)[0], v = a[k];
    switch (k) {
      case 'say': g.ui.say([].concat(v)); c.block = 'msg'; break;
      case 'set': [].concat(v).forEach(f => { if (!S.flags[f]) { S.flags[f] = true; this.fire('flag', { flag: f }); } }); break;
      case 'unset': [].concat(v).forEach(f => delete S.flags[f]); break;
      case 'give': g.give(v[0], v[1] ?? 1); break;
      case 'take_item': S.consume(v, 999); break;
      case 'read': g.ui.readFile(v); S.files[v] = true; c.block = 'file'; break;
      case 'spawn': g.spawnEnemy(v); break;
      case 'remove': [].concat(v).forEach(id => g.removeEnemy(id)); break;
      case 'transform': g.transform(v); break;
      case 'sfx': g.sfx(v); break;
      case 'music': g.music.play(v); break;
      case 'shake': g.fx.shake = v; break;
      case 'whiteout': g.fx.whiteout = v; break;
      case 'wait': c.wait = v; break;
      case 'run': c.q.unshift(...(g.location.sequences?.[v] || [])); break;
      case 'if': if (!check(v, g)) return 'stop'; break;
      case 'chapter_end': g.chapterEnd(v); return 'stop';
      case 'goto_room': g.gotoRoom(v.room, v.at, v.yaw ?? 0, v.transition || 'fade'); break;
      case 'camera': g.forcedCamera = v; break;
      case 'cinematic': g.cinematic = !!v; break;                // player input off, letterbox on
      case 'actor': {
        const act = v.id === 'player' ? g.player : g.enemies.find(e => e.id === v.id);
        if (act) { act.script(v); if (v.wait && v.move_to) { c.actor = act; c.block = 'actor'; } }
        break;
      }
      case 'heal': g.player.heal(v); break;
      case 'damage': g.player.hurt(v); break;
      case 'movie': g.ui.playMovie(v); c.block = 'movie'; break;
      default: console.warn('unknown action', k, v);
    }
  }
}
