// Story scripting: triggers fire action lists that run as small coroutines
// (RE's room scripts, as data). Conditions and actions are plain JSON in
// content/locations/<id>/location.json.
//
// Trigger events: new_game, enter_room{room}, zone{room, rect}, enemies_dead{ids, mode},
//                 pickup{id}, flag{flag}, enemy_hp{id, below}, enemy_dead{id}, unlock{door},
//                 use_item{item, id}
// Conditions:     {flag} {not} {all:[]} {any:[]} {has} {taken} {dead} {room} {equipped}
//                 {visited} {unlocked: door} {infection: min} {hp_below: n}
// Actions:        say (string | [lines] | {who, text}), set, unset, give, take_item, read, spawn,
//                 transform, remove, sfx, music (null = back to the room's), shake, whiteout,
//                 wait, run, if, chapter_end, goto_room, camera (null = zones), cinematic, actor,
//                 heal, damage, movie, fade {out|in: secs}, title_card {text, sub, t},
//                 unlock / lock (door id), infect (add) / infect_rate (per sec), wake (enemy ids),
//                 enemy {id, state?, hp?}, card_wait

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
  if ('visited' in cond) ok &&= [].concat(cond.visited).every(r => !!S.visited[r]);
  if ('unlocked' in cond) ok &&= [].concat(cond.unlocked).every(d => !!S.flags['door:' + d]);
  if ('infection' in cond) ok &&= (S.infection || 0) >= cond.infection;
  if ('hp_below' in cond) ok &&= S.hp < cond.hp_below;
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
      const key = L.id + ':' + t.id;                              // trigger ids are per location
      if (t.once !== false && this.g.state.fired[key]) continue;
      if (!this.matches(t.on, info)) continue;
      if (!check(t.if, this.g)) continue;
      if (t.once !== false) this.g.state.fired[key] = true;
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
      case 'enemy_hp': return on.id === info.id && info.hp <= (on.below ?? 0);
      case 'enemy_dead': return on.id === info.id;
      case 'enemy_land': return !on.id || on.id === info.id;     // a leaper off its perch, on its feet
      case 'unlock': return !on.door || on.door === info.door;
      case 'use_item': return (!on.item || on.item === info.item) && (!on.id || on.id === info.id);
      default: return true;
    }
  }
  // polled triggers: zones and "these enemies are dead"
  tick() {
    const g = this.g, L = g.location, S = g.state, p = g.player;
    if (!L || !p) return;
    for (const t of L.triggers || []) {
      const key = L.id + ':' + t.id;
      if (t.once !== false && S.fired[key]) continue;
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
      if (t.once !== false) S.fired[key] = true;
      this.start(t.do, t.id);
    }
  }

  start(actions, label = '') { const c = new Coroutine(actions, label); this.running.push(c); this.step(c); return c; }

  update(dt) {
    const card = this.g.fx.card;                                   // a chapter's title card plays first; the scene waits for it
    if (card && !card.inline && card.t < card.dur) return;
    for (const c of this.running) {
      if (c.done) continue;
      if (c.wait > 0) { c.wait -= dt; if (c.wait > 0) continue; c.wait = 0; }
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
      case 'fade': return g.fx.fade === g.fx.fadeTo;
      case 'card': return !g.fx.card;
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
      case 'say':
        if (v && v.text) g.ui.say([].concat(v.text), null, v.who); else g.ui.say([].concat(v));
        c.block = 'msg'; break;
      case 'set': [].concat(v).forEach(f => { if (!S.flags[f]) { S.flags[f] = true; this.fire('flag', { flag: f }); } }); break;
      case 'unset': [].concat(v).forEach(f => delete S.flags[f]); break;
      case 'give': g.give(v[0], v[1] ?? 1); break;
      case 'take_item': S.consume(v, 999); break;
      case 'read': g.ui.readFile(v); S.files[v] = true; c.block = 'file'; break;
      case 'spawn': g.spawnEnemy(v); break;
      case 'remove': [].concat(v).forEach(id => g.removeEnemy(id)); break;
      case 'transform': g.transform(v); break;
      case 'sfx': g.sfx(v); break;
      case 'music': g.musicOverride = v === null ? undefined : v; g.updateMusic(); break;
      case 'shake': g.fx.shake = v; break;
      case 'whiteout': g.fx.whiteout = v; break;
      case 'wait': c.wait = v; break;
      case 'run': c.q.unshift(...(g.location.sequences?.[v] || [])); break;
      case 'if': if (!check(v, g)) return 'stop'; break;
      case 'monster_form': g.startMonster(); break;
      case 'chapter_end': g.chapterEnd(v); return 'stop';
      case 'goto_room': g.gotoRoom(v.room, v.at, v.yaw ?? 0, v.transition || 'fade'); break;
      case 'camera': g.forcedCamera = v; if (!v) g.cam = -1, g.updateCamera(); else g.updateCamera(); break;
      case 'fall_sprite': (g.fx.spriteFalls ||= {})[v]={t:0}; S.taken[v]=true; break;
      case 'take_pickup': [].concat(v).forEach(id => { S.taken[id] = true; }); break;          // e.g. a set piece that is no longer there
      case 'fall': [].concat(v).forEach(id => { const e = g.enemies.find(x => x.id === id); if (e) { e.state = 'fall'; e.vz = 0.5; e.scripted = null; } }); break;
      case 'fall_rect': {                                       // everything standing on a part that gives way (the span) goes with it
        const [x0, y0, x1, y1] = v;
        for (const e of g.enemies) {
          if (e.state === 'gone' || e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) continue;
          Object.assign(e, { state: 'fall', vz: 0.5, scripted: null });
          delete S.enemies[e.id]; if (S.corpses) delete S.corpses[e.id]; S.dead[e.id] = true;
        }
        break;
      }
      case 'frame': { const id = g.frameCamera(v); if (id) { g.forcedCamera = id; g.updateCamera(); } break; }   // the shot that shows it best
      case 'cinematic': g.cinematic = !!v; break;                // player input off, letterbox on
      case 'actor': {
        const act = v.id === 'player' ? g.player : g.enemies.find(e => e.id === v.id);
        if (act) { act.script(v); if (v.wait && (v.move_to || v.path?.length)) { c.actor = act; c.block = 'actor'; } }
        break;
      }
      case 'heal': g.player.heal(v); break;
      case 'damage': g.player.hurt(v, { scripted: true }); break;
      case 'movie': g.ui.playMovie(v); c.block = 'movie'; break;
      case 'fade': {
        const out = 'out' in v, secs = (out ? v.out : v.in) || 0.001;
        g.fx.fadeTo = out ? 1 : 0; g.fx.fadeRate = 1 / secs;
        if (!v.nowait) c.block = 'fade';
        break;
      }
      case 'title_card': g.titleCard(v); if (v.wait !== false) c.block = 'card'; break;
      case 'unlock': [].concat(v).forEach(d => g.unlockDoor(d, true)); break;
      case 'lock': [].concat(v).forEach(d => g.unlockDoor(d, false)); break;
      case 'infect': S.infection = Math.max(0, Math.min(100, (S.infection || 0) + v)); break;
      case 'infect_rate': S.infect_rate = v; break;
      case 'wake': [].concat(v).forEach(id => {
        const e = g.enemies.find(x => x.id === id);
        if (e && e.state === 'perched') e.update();
        if (e) { e.hidden = false; e.staticPose = null; e.poseName = undefined; e.cool = Math.max(e.cool || 0, 1.0); if (['idle', 'perched'].includes(e.state)) e.state = 'chase'; }   // up off the body, a beat before it lunges
      }); break;
      case 'enemy': {
        const e = g.enemies.find(x => x.id === v.id);
        if (e && v.pose !== undefined) e.poseName = v.pose || undefined;
        if (e && v.hide) e.hide = new Set(v.hide);
        if (e && v.lamps !== undefined) e.lampsOff = !v.lamps;
        if (e && v.pose !== undefined) e.staticPose = v.pose ? this.g.A.poses[e.def.model]?.[v.pose] || null : null;
        if (e) { if (v.hp !== undefined) e.hp = v.hp; if (v.state) { e.state = v.state; e.t = 0; if (v.anim) e.anim.play(v.anim, { restart: true }); } if (v.hidden !== undefined) e.hidden = v.hidden; }
        break;
      }
      default: console.warn('unknown action', k, v);
    }
  }
}
