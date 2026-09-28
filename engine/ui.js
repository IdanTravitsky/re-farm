// All screens and overlays. Drawing is skipped entirely when running headless.
import * as PSX from './psx.js';
import { Saves } from './state.js';

const D2R = Math.PI / 180;
const WHITE = [240, 240, 232], GOLD = [255, 220, 90], GREY = [150, 146, 138], RED = [200, 16, 16];

export class UI {
  constructor(g) { this.g = g; this.msg = null; this.file = null; this.menu = null; this.movie = null; this.icons = null; this.boxUI = null; }
  get F() { return this.g.A.font; }
  get fb() { return this.g.fb; }
  get items() { return this.g.A.content.items; }

  // ---------------------------------------------------------------- messages
  // a page holds 3 wrapped lines (2 when YES/NO sits under it); longer text flows onto more pages
  paginate(text, max = 3) {
    const L = this.wrap(text, 290), out = [];
    for (let i = 0; i < L.length; i += max) out.push(L.slice(i, i + max).join(' '));
    return out.length ? out : [''];
  }
  say(lines, then, who) { this.msg = { lines: [].concat(lines).flatMap(l => this.paginate(l)), shown: 0, page: 0, then, who }; }
  ask(q, yes, no) {
    const pages = this.paginate(q, 2);
    if (pages.length > 1) return this.say(pages.slice(0, -1), () => this.ask(pages[pages.length - 1], yes, no));
    this.msg = { lines: pages, shown: 0, page: 0, choice: 0, yes, no };
  }
  readFile(id, page = 0) { this.file = { id, page }; }
  modal() { return !!(this.msg || this.file || this.menu || this.movie || this.boxUI); }

  update(I) {
    const g = this.g;
    if (this.movie) { if (I.confirmPressed || I.cancelPressed || this.movie.done) { this.movie.stop?.(); this.movie = null; } return true; }
    if (this.file) return this.updateFile(I), true;
    if (this.msg) return this.updateMsg(I), true;
    if (this.menu) return this.updateMenu(I), true;
    if (this.boxUI) return this.updateBox(I), true;
    return false;
  }
  updateMsg(I) {
    const m = this.msg;
    m.shown += 90 / 30;
    const full = m.lines[m.page].length;
    if (m.choice !== undefined && m.shown >= full) {
      if (I.leftPressed || I.rightPressed) { m.choice ^= 1; this.g.sfx('cursor'); }
      if (I.confirmPressed) { this.msg = null; if (m.choice === 0) m.yes && m.yes(); else { this.g.sfx('cursor'); m.no && m.no(); } }
      else if (I.cancelPressed) { this.msg = null; m.no && m.no(); }
      return;
    }
    if (I.confirmPressed || I.cancelPressed) {
      if (m.shown < full) m.shown = full;
      else if (m.page < m.lines.length - 1) { m.page++; m.shown = 0; }
      else { this.msg = null; m.then && m.then(); }
    }
  }
  updateFile(I) {
    const f = this.file, pages = this.g.A.content.files[f.id].pages;
    if (I.rightPressed && f.page < pages.length - 1) { f.page++; this.g.sfx('cursor'); }
    if (I.leftPressed && f.page > 0) { f.page--; this.g.sfx('cursor'); }
    if (I.confirmPressed) { if (f.page < pages.length - 1) { f.page++; this.g.sfx('cursor'); } else this.file = null; }
    if (I.cancelPressed) this.file = null;
  }

  // ---------------------------------------------------------------- status menu (ITEMS / MAP / FILES)
  openMenu(tab = 'items') {
    const nodes = this.g.A.content.journey.nodes;
    this.menu = { tab, sel: 0, sub: null, check: null, node: Math.max(0, nodes.findIndex(n => n.location === this.g.state.location)), fsel: 0 };
    this.g.sfx('cursor');
    this.g.prefetchVisited();
  }
  updateMenu(I) {
    const M = this.menu, g = this.g, S = g.state;
    if (M.check) { M.check.t += 1 / 30; if (I.confirmPressed || I.cancelPressed) M.check = null; return; }
    const tabs = ['items', 'map', 'files'];
    if (!M.sub && (I.prevTabPressed || I.nextTabPressed)) {
      M.tab = tabs[(tabs.indexOf(M.tab) + (I.nextTabPressed ? 1 : 2)) % 3]; g.sfx('cursor'); return;
    }
    if (I.cancelPressed || (I.menuPressed && !M.sub)) { if (M.sub) M.sub = null; else this.menu = null; return; }
    if (M.tab === 'map') {
      if (I.confirmPressed) { M.journey = !M.journey; g.sfx('cursor'); }
      const nodes = g.A.content.journey.nodes;
      if (M.journey && (I.leftPressed || I.rightPressed)) { M.node = (M.node + nodes.length + (I.rightPressed ? 1 : -1)) % nodes.length; g.sfx('cursor'); }
      return;
    }
    if (M.tab === 'files') {
      const files = this.fileList();
      if (I.upPressed || I.downPressed) { M.fsel = Math.max(0, Math.min(files.length - 1, M.fsel + (I.downPressed ? 1 : -1))); g.sfx('cursor'); }
      if (I.confirmPressed && files[M.fsel]) { this.readFile(files[M.fsel]); }
      return;
    }
    const n = g.slots;
    if (M.combine !== undefined && M.combine !== null) {
      if (I.leftPressed || I.rightPressed) { M.sel ^= 1; g.sfx('cursor'); }
      if (I.upPressed) { M.sel = (M.sel + n - 2) % n; g.sfx('cursor'); }
      if (I.downPressed) { M.sel = (M.sel + 2) % n; g.sfx('cursor'); }
      if (I.confirmPressed) {                                    // a stack can be mixed with itself (two green herbs in one slot)
        const a = M.combine, it = S.inventory[M.sel]; M.combine = null;
        const self = M.sel === a && it && it.n >= 2 && this.recipes().some(r => r[0] === it.id && r[1] === it.id);
        if (it && (M.sel !== a || self)) this.combine(a, M.sel); else g.sfx('cursor');
      }
      return;
    }
    if (M.sub) {
      if (I.upPressed || I.downPressed) { M.sub.sel = (M.sub.sel + M.sub.opts.length + (I.upPressed ? -1 : 1)) % M.sub.opts.length; g.sfx('cursor'); }
      if (I.confirmPressed) {
        const it = S.inventory[M.sel], opt = M.sub.opts[M.sub.sel], def = this.items[it.id];
        M.sub = null; g.sfx('confirm');
        if (opt === 'EQUIP') { S.equipped = it.id; g.player.updateHide(); }
        if (opt === 'USE') {
          if (def.kind === 'heal') {
            if (def.heal) g.player.heal(def.heal);
            if (def.cure) { S.infection = Math.max(0, (S.infection || 0) - def.cure); g.sfx('heal'); }
            S.consume(it.id, 1);
          }
          if (def.kind === 'save') this.say(['Use it at a typewriter.']);
          if (def.kind === 'key' || def.kind === 'tool') g.useItem(it.id);
        }
        if (opt === 'COMBINE') M.combine = M.sel;
        if (opt === 'CHECK') M.check = { id: it.id, t: 0 };
        if (opt === 'READ') { this.readFile(def.file); S.files[def.file] = true; }
      }
      return;
    }
    if (I.leftPressed || I.rightPressed) { M.sel ^= 1; g.sfx('cursor'); }
    if (I.upPressed) { M.sel = (M.sel + n - 2) % n; g.sfx('cursor'); }
    if (I.downPressed) { M.sel = (M.sel + 2) % n; g.sfx('cursor'); }
    if (I.confirmPressed && S.inventory[M.sel]) {
      const def = this.items[S.inventory[M.sel].id];
      const id = S.inventory[M.sel].id;
      const opts = def.kind === 'weapon' ? ['EQUIP', 'CHECK'] : def.kind === 'file' ? ['READ', 'CHECK'] :
        ['heal', 'save', 'key', 'tool'].includes(def.kind) ? ['USE', 'CHECK'] : ['CHECK'];
      if (this.combinable(id)) opts.splice(opts.length - 1, 0, 'COMBINE');
      M.sub = { sel: 0, opts };
      g.sfx('cursor');
    }
  }
  // ---------------------------------------------------------------- combining (herbs, loading ammo)
  recipes() { return this.g.A.content.game.recipes || []; }
  combinable(id) {
    const d = this.items[id];
    if (d.weapon?.ammo || d.kind === 'ammo') return true;
    return this.recipes().some(r => r[0] === id || r[1] === id);
  }
  combine(a, b) {
    const g = this.g, S = g.state, A = S.inventory[a], B = S.inventory[b], da = this.items[A.id], db = this.items[B.id];
    // ammo + its weapon = load it
    const [w, am] = da.weapon ? [A, B] : db.weapon ? [B, A] : [null, null];
    if (w && this.items[w.id].weapon.ammo === am.id) {
      const W = this.items[w.id].weapon, k = Math.min(W.mag - (S.mag[w.id] || 0), am.n);
      if (k <= 0) return this.say(["It's already fully loaded."]);
      S.mag[w.id] = (S.mag[w.id] || 0) + k; S.consume(am.id, k); g.player.sync(); g.sfx('reload');
      return;
    }
    const r = this.recipes().find(r => (r[0] === A.id && r[1] === B.id) || (r[0] === B.id && r[1] === A.id));
    if (!r) { g.sfx('locked'); return this.say(["They can't be combined."]); }
    const ida = A.id, idb = B.id;
    S.consume(ida, 1); S.consume(idb, 1);
    const at = Math.min(a, b, S.inventory.length);
    const stack = S.inventory.find(i => i.id === r[2]);
    if (stack) stack.n += 1; else S.inventory.splice(at, 0, { id: r[2], n: 1 });
    g.sfx('combine');
    this.say([`Combined into the ${this.items[r[2]].name}.`]);
  }

  // ---------------------------------------------------------------- item box (shared across the game, like RE2's)
  openBox() { this.g.state.box ||= []; this.boxUI = { side: 0, isel: 0, bsel: 0 }; }
  updateBox(I) {
    const B = this.boxUI, g = this.g, S = g.state, box = S.box, n = g.slots;
    if (I.cancelPressed || I.menuPressed) { this.boxUI = null; g.sfx('box'); return; }
    if (I.leftPressed || I.rightPressed) { B.side ^= 1; g.sfx('cursor'); }
    if (I.upPressed || I.downPressed) {
      const d = I.downPressed ? 1 : -1;
      if (B.side === 0) B.isel = (B.isel + n + d) % n; else B.bsel = Math.max(0, Math.min(box.length - 1, B.bsel + d));
      g.sfx('cursor');
    }
    if (!I.confirmPressed) return;
    if (B.side === 0) {
      const it = S.inventory[B.isel];
      if (!it) return;
      const def = this.items[it.id];
      if (def.no_box) return this.say(["You'd better keep it on you."]);
      const stack = def.kind !== 'weapon' && box.find(b => b.id === it.id);
      if (stack) stack.n += it.n; else box.push({ id: it.id, n: def.weapon ? S.mag[it.id] ?? it.n : it.n });
      S.inventory.splice(B.isel, 1);
      if (S.equipped === it.id) { S.equipped = null; g.player.updateHide(); }
      g.sfx('confirm');
    } else {
      const b = box[B.bsel];
      if (!b) return;
      const def = this.items[b.id];
      if (!S.add(b.id, b.n, this.items, n)) return this.say(['There is no more room to carry anything.']);
      if (def.weapon) { S.mag[b.id] = b.n; if (!S.equipped) { S.equipped = b.id; g.player.updateHide(); } }
      box.splice(B.bsel, 1);
      B.bsel = Math.max(0, Math.min(B.bsel, box.length - 1));
      g.sfx('confirm');
    }
  }
  drawBox() {
    const fb = this.fb, F = this.F, g = this.g, S = g.state, B = this.boxUI, box = S.box;
    PSX.darken(fb, 0.2); PSX.tintScreen(fb, 0, 10, 40, 0.5);
    F.draw(fb, 'ITEMS', 16, 6, B.side === 0 ? GOLD : GREY);
    F.draw(fb, 'ITEM BOX', 168, 6, B.side === 1 ? GOLD : GREY);
    for (let k = 0; k < g.slots; k++) {
      const x = 8 + (k % 2) * 72, y = 20 + Math.floor(k / 2) * 44;
      this.box(x, y, 68, 42, [0, 0, 0], 0.9, B.side === 0 && k === B.isel ? GOLD : [110, 110, 104]);
      const it = S.inventory[k];
      if (!it) continue;
      PSX.blitSprite(fb, this.icon(it.id), x + 2, y - 1);
      const def = this.items[it.id];
      if (!['file', 'key', 'tool'].includes(def.kind)) F.draw(fb, String(def.weapon ? S.mag[it.id] ?? 0 : it.n), x + 52, y + 28, [230, 230, 120]);
    }
    this.box(160, 20, 152, 176, [0, 0, 0], 0.9, B.side === 1 ? GOLD : [110, 110, 104]);
    const top = Math.max(0, Math.min(B.bsel - 5, box.length - 12));
    box.slice(top, top + 12).forEach((b, i) => {
      const k = top + i, def = this.items[b.id], sel = B.side === 1 && k === B.bsel;
      F.draw(fb, (sel ? '> ' : '  ') + def.name, 166, 26 + i * 14, sel ? GOLD : [210, 206, 190]);
      if (!['file', 'key', 'tool'].includes(def.kind)) F.draw(fb, String(b.n), 292, 26 + i * 14, [230, 230, 120]);
    });
    if (!box.length) F.draw(fb, '  (empty)', 166, 26, GREY);
    const cur = B.side === 0 ? S.inventory[B.isel] : box[B.bsel];
    this.box(8, 200, 304, 34, [0, 0, 0], 0.9);
    if (cur) { const def = this.items[cur.id]; F.draw(fb, def.name, 16, 203, GOLD); F.draw(fb, this.wrap(def.desc, 290)[0] || '', 16, 217, [200, 200, 190]); }
  }

  // location / chapter title card, fading in and out over the scene
  drawCard(c) {
    const k = Math.max(0, Math.min(1, c.t / 0.8, (c.dur - c.t) / 0.8));
    if (k <= 0) return;
    const col = (v) => [v[0] * k, v[1] * k, v[2] * k];
    PSX.darken(this.fb, 1 - 0.45 * k);
    const big = this.F.width(c.text) * 2 <= 304;                   // long names drop to 1x rather than run off
    this.center(c.text, big ? 104 : 110, col([235, 230, 220]), big ? 2 : 1);
    if (c.sub) this.wrap(c.sub, 300).forEach((l, i) => this.center(l, 132 + i * 13, col([190, 40, 30])));
  }

  fileList() {
    const S = this.g.state, files = this.g.A.content.files;
    const ids = new Set(Object.keys(S.files));
    for (const it of S.inventory) { const d = this.items[it.id]; if (d.kind === 'file') ids.add(d.file); }
    return [...ids].filter(id => files[id]);
  }

  // ---------------------------------------------------------------- drawing
  box(x, y, w, h, fill = [0, 0, 0], a = 0.85, border = [150, 150, 140]) {
    const fb = this.fb;
    PSX.rect(fb, x, y, w, h, fill[0], fill[1], fill[2], a);
    PSX.rect(fb, x, y, w, 1, ...border); PSX.rect(fb, x, y + h - 1, w, 1, ...border);
    PSX.rect(fb, x, y, 1, h, ...border); PSX.rect(fb, x + w - 1, y, 1, h, ...border);
  }
  wrap(text, width) {
    const words = text.split(' '), lines = [];
    let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (this.F.width(t) > width) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    return lines;
  }
  // wrap to the narrowest width that still needs no extra lines: even lines, no one-word orphans
  balanced(text, max) {
    const n = this.wrap(text, max).length;
    let w = Math.ceil(this.F.width(text) / n);
    while (w < max && this.wrap(text, w).length > n) w += 4;
    return this.wrap(text, Math.min(w, max));
  }
  center(s, y, col = WHITE, scale = 1) { this.F.draw(this.fb, s, 160 - (this.F.width(s) * scale >> 1), y, col, scale); }

  drawOverlays() {
    if (this.boxUI) { this.drawBox(); if (this.msg) this.drawMsg(); return; }
    if (this.menu) { this.drawMenu(); if (this.msg) this.drawMsg(); return; }
    else if (this.file) this.drawFile();
    else if (this.msg) this.drawMsg();
  }
  drawMsg() {
    const m = this.msg, F = this.F, over = this.menu || this.boxUI, dy = over ? -8 : 0;     // over a menu: in its description strip, above the tabs
    this.box(8, 186 + dy, 304, over ? 40 : 48, [0, 0, 0], over ? 0.97 : 0.85);
    if (m.who) { const w = F.width(m.who) + 12; this.box(8, 172 + dy, w, 15, [0, 0, 0], 0.9); F.draw(this.fb, m.who, 14, 175 + dy, GOLD); }
    const lines = this.wrap(m.lines[m.page].slice(0, Math.floor(m.shown)), 290);
    lines.slice(0, 3).forEach((l, i) => F.draw(this.fb, l, 16, 191 + dy + i * 13));
    if (m.choice !== undefined && m.shown >= m.lines[m.page].length) {
      F.draw(this.fb, 'YES', 110, 218 + dy, m.choice === 0 ? [255, 230, 120] : [140, 140, 140]);
      F.draw(this.fb, 'NO', 190, 218 + dy, m.choice === 1 ? [255, 230, 120] : [140, 140, 140]);
      F.draw(this.fb, '>', m.choice === 0 ? 100 : 180, 218 + dy, [255, 230, 120]);
    }
  }
  drawFile() {
    const fb = this.fb, F = this.F, f = this.file, doc = this.g.A.content.files[f.id], pg = doc.pages[f.page];
    PSX.darken(fb, 0.3);
    this.box(30, 24, 260, 180, [58, 52, 40], 0.95, [120, 104, 80]);
    F.draw(fb, doc.title, 44, 32, [230, 200, 140]);
    F.draw(fb, pg[0], 44, 54, [220, 200, 160]);
    const paras = pg.slice(1).join('\n').split(/\n\s*\n/).map(t => t.replace(/\s+/g, ' ').trim());   // hand-broken lines reflow; a blank line is a break
    const body = paras.flatMap((t, i) => [...(i ? [''] : []), ...(t ? this.wrap(t, 240) : [])]), step = body.length > 7 ? 13 : 16;
    body.forEach((l, i) => F.draw(fb, l, 44, 76 + i * step, [220, 214, 196]));
    F.draw(fb, `${f.page + 1}/${doc.pages.length}`, 250, 186, [160, 150, 130]);
  }
  drawMenu() {
    const fb = this.fb, M = this.menu;
    PSX.darken(fb, 0.18);
    PSX.tintScreen(fb, 0, 10, 40, 0.5);
    if (M.check) return this.drawCheck();
    const tabs = [['items', 'ITEMS'], ['map', 'MAP'], ['files', 'FILES']];
    let x = 10;
    for (const [id, label] of tabs) {
      this.F.draw(fb, label, x, 226, id === M.tab ? GOLD : GREY);
      x += this.F.width(label) + 14;
    }
    this.F.draw(fb, '[ / ]', 280, 226, [110, 110, 104]);
    if (M.tab === 'items') this.drawItems();
    else if (M.tab === 'map') M.journey ? this.drawJourney() : this.drawMap();
    else this.drawFiles();
  }
  drawItems() {
    const fb = this.fb, F = this.F, g = this.g, S = g.state, M = this.menu, p = g.player;
    // condition ECG
    this.box(8, 8, 150, 80, [0, 0, 0], 0.9);
    F.draw(fb, 'CONDITION', 16, 12, [200, 200, 190]);
    const st = p.status(), col = st === 'FINE' ? [40, 220, 60] : st === 'CAUTION' ? [230, 190, 30] : [230, 40, 30];
    for (let gx = 16; gx < 150; gx += 10) PSX.rect(fb, gx, 28, 1, 40, 0, 40, 0);
    for (let gy = 28; gy < 68; gy += 10) PSX.rect(fb, 16, gy, 134, 1, 0, 40, 0);
    const speed = st === 'FINE' ? 1 : st === 'CAUTION' ? 1.4 : 2, head = (g.time * 60 * speed) % 134;
    const ecg = (i) => {
      const ph = (i % 45) / 45;
      if (ph > 0.12 && ph < 0.2) return 48 - 3 * Math.sin((ph - 0.12) / 0.08 * Math.PI);
      if (ph >= 0.34 && ph < 0.37) return 48 + (ph - 0.34) / 0.03 * 5;
      if (ph >= 0.37 && ph < 0.41) return 53 - (ph - 0.37) / 0.04 * 24;
      if (ph >= 0.41 && ph < 0.45) return 29 + (ph - 0.41) / 0.04 * 25;
      if (ph >= 0.45 && ph < 0.47) return 54 - (ph - 0.45) / 0.02 * 6;
      if (ph > 0.58 && ph < 0.72) return 48 - 5 * Math.sin((ph - 0.58) / 0.14 * Math.PI);
      return 48;
    };
    for (let i = 1; i < 134; i++) {
      const age = (head - i + 134) % 134;
      if (age > 100) continue;
      const k = 1 - age / 100, y0 = Math.round(ecg(i - 1)), y1 = Math.round(ecg(i));
      PSX.rect(fb, 16 + i, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 2, col[0] * k, col[1] * k, col[2] * k);
    }
    F.draw(fb, st, 16, 72, col);
    const inf = S.infection || 0;
    if (inf > 0) {                                                      // the bite, spreading
      F.draw(fb, 'INFECTION', 76, 72, [190, 90, 200]);
      PSX.rect(fb, 16, 84, 134, 2, 40, 0, 40);
      PSX.rect(fb, 16, 84, Math.round(134 * inf / 100), 2, 190, 60, 210);
    }
    // equipped
    this.box(8, 94, 150, 56, [0, 0, 0], 0.9);
    F.draw(fb, 'EQUIPPED', 16, 98, [200, 200, 190]);
    const w = p.weapon();
    if (w) {
      PSX.blitSprite(fb, this.icon(S.equipped), 16, 108);
      F.draw(fb, w.ammo ? `${S.mag[S.equipped] ?? 0} / ${S.count(w.ammo)}` : `${S.mag[S.equipped] ?? 0}`, 90, 126, [230, 230, 120]);
    }
    F.draw(fb, g.room.name, 10, 154, [170, 170, 160]);
    const held = Object.keys(S.held || {}).map(id => this.items[id]?.name).filter(Boolean);
    if (held.length) F.draw(fb, 'CARRYING: ' + held.join(', '), 10, 166, [120, 200, 170]);
    // item grid (2 x rows)
    for (let k = 0; k < g.slots; k++) {
      const x = 170 + (k % 2) * 72, y = 8 + Math.floor(k / 2) * 42;      // four rows end above the description strip
      this.box(x, y, 68, 40, [0, 0, 0], 0.9, k === M.sel ? [255, 220, 90] : [110, 110, 104]);
      const it = S.inventory[k];
      if (!it) continue;
      PSX.blitSprite(fb, this.icon(it.id), x + 2, y - 1);
      const def = this.items[it.id];
      if (def.kind !== 'file' && def.kind !== 'key' && def.kind !== 'tool') F.draw(fb, String(def.weapon ? S.mag[it.id] ?? 0 : it.n), x + 52, y + 28, [230, 230, 120]);
      if (M.combine === k) this.box(x + 1, y + 1, 66, 38, [0, 0, 0], 0, [120, 220, 255]);
      if (S.equipped === it.id) F.draw(fb, 'E', x + 4, y + 28, [120, 220, 255]);
    }
    this.box(8, 180, 304, 42, [0, 0, 0], 0.9);
    const it = S.inventory[M.sel];
    if (it && !this.msg) {                                           // a message box takes this strip over
      const def = this.items[it.id];
      F.draw(fb, def.name, 16, 183, GOLD);
      this.wrap(def.desc, 290).slice(0, 2).forEach((l, i) => F.draw(fb, l, 16, 196 + i * 12));
    }
    if (M.combine !== undefined && M.combine !== null) F.draw(fb, 'COMBINE WITH?', 170, 170, GOLD);
    if (M.sub) {
      const bw = 12 + Math.max(...M.sub.opts.map(o => F.width(o)));
      const x = Math.min(170 + (M.sel % 2) * 72 + 30, 316 - bw), y = 8 + Math.floor(M.sel / 2) * 42 + 8;   // stays on screen
      this.box(x, y, bw, 8 + M.sub.opts.length * 13, [20, 20, 30], 0.97, [255, 220, 90]);
      M.sub.opts.forEach((o, i) => F.draw(fb, o, x + 8, y + 4 + i * 13, i === M.sub.sel ? [255, 230, 120] : [180, 180, 170]));
    }
  }
  drawCheck() {
    const fb = this.fb, id = this.menu.check.id, def = this.items[id];
    fb.fill(0, 0, 8); fb.depth = null;
    const m = this.g.A.models[def.model];
    PSX.render(fb, framed(m, 320, 240, -90, 0.8, 0.3), [{ model: m, x: 0, y: 0, z: 0, yaw: this.menu.check.t * 50, pose: {} }],
      new PSX.Lights([[0.4, 0.8, -0.5], [-0.6, -0.2, -0.3]], [[0.95, 0.9, 0.82], [0.3, 0.34, 0.44]], [0.4, 0.4, 0.44]));
    this.center(def.name, 12, GOLD);
    this.wrap(def.desc, 290).forEach((l, i) => this.center(l, 200 + i * 13));
  }
  // RE-style floor plan of the rooms you've been to in this location
  drawMap() {
    const fb = this.fb, F = this.F, g = this.g, S = g.state;
    this.box(8, 8, 304, 212, [2, 8, 20], 0.95, [90, 120, 170]);
    const locRooms = g.location.rooms.filter(r => S.visited[r] && g.A.rooms[r]).map(r => g.A.rooms[r]);
    F.draw(fb, g.location.title.toUpperCase(), 16, 12, GOLD);
    F.draw(fb, 'ENTER: COUNTY', 232, 12, [120, 140, 170]);
    if (!locRooms.length) return;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const r of locRooms) { const m = r.map; x0 = Math.min(x0, m.x0); y0 = Math.min(y0, m.y0); x1 = Math.max(x1, m.x0 + m.w * m.res); y1 = Math.max(y1, m.y0 + m.h * m.res); }
    const sc = Math.min(284 / (x1 - x0), 176 / (y1 - y0));
    const ox = 18 + (284 - (x1 - x0) * sc) / 2, oy = 30 + (176 - (y1 - y0) * sc) / 2;
    const toS = (x, y) => [ox + (x - x0) * sc, oy + (y1 - y) * sc];
    for (const r of locRooms) {
      const m = r.map, cur = r.id === S.room;
      const col = cur ? [200, 120, 40] : [40, 80, 160];
      for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
        const b = j * m.w + i;
        if (!((r.mapCells[b >> 3] >> (7 - (b & 7))) & 1)) continue;
        const [sx, sy] = toS(m.x0 + i * m.res, m.y0 + (j + 1) * m.res);
        PSX.rect(fb, Math.floor(sx), Math.floor(sy), Math.max(1, Math.ceil(m.res * sc)), Math.max(1, Math.ceil(m.res * sc)), ...col);
      }
      const [cx, cy] = toS(m.x0 + m.w * m.res / 2, m.y0 + m.h * m.res / 2);
      F.draw(fb, r.name, Math.round(cx - F.width(r.name) / 2), Math.round(cy - 5), cur ? [255, 230, 190] : [170, 190, 230]);
    }
    for (const d of g.location.doors) for (const s of [d.a, d.b]) {
      if (!S.visited[s.room]) continue;
      const [sx, sy] = toS(...s.at);
      PSX.rect(fb, Math.round(sx) - 1, Math.round(sy) - 1, 3, 3, 240, 240, 240);
    }
    // player arrow (blinks)
    if (Math.floor(g.time * 3) % 2 === 0) {
      const [px, py] = toS(g.player.x, g.player.y), a = g.player.yaw * D2R;
      for (let t = 0; t < 6; t++) PSX.rect(fb, Math.round(px + Math.sin(a) * t) , Math.round(py + Math.cos(a) * t), 2, 2, 255, 60, 40);
    }
  }
  // Bryan's route across Raccoon County
  drawJourney() {
    const fb = this.fb, F = this.F, g = this.g, M = this.menu, J = g.A.content.journey;
    this.box(8, 8, 304, 212, [18, 22, 14], 0.97, [120, 130, 90]);
    F.draw(fb, J.title, 16, 12, [220, 210, 160]);
    for (let y = 26; y < 216; y += 12) PSX.rect(fb, 10, y, 300, 1, 30, 36, 24);
    for (let x = 16; x < 310; x += 12) PSX.rect(fb, x, 24, 1, 194, 30, 36, 24);
    const nodes = J.nodes, here = nodes.findIndex(n => n.location === g.state.location);
    for (let i = 1; i < nodes.length; i++) {
      const [ax, ay] = nodes[i - 1].at, [bx, by] = nodes[i].at, done = i <= here;
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 2);
      for (let k = 0; k <= n; k++) if (done || k % 3 !== 0) PSX.rect(fb, Math.round(ax + (bx - ax) * k / n), Math.round(ay + (by - ay) * k / n), 2, 2, ...(done ? [200, 40, 30] : [90, 90, 70]));
    }
    nodes.forEach((nd, i) => {
      const [x, y] = nd.at, sel = i === M.node, cur = i === here;
      const known = i <= here;                                   // the road ahead stays unknown
      const col = cur ? (Math.floor(g.time * 3) % 2 ? [255, 80, 60] : [255, 200, 120]) : known ? [220, 200, 140] : [120, 120, 100];
      PSX.rect(fb, x - 3, y - 3, 7, 7, ...col);
      if (!known) PSX.rect(fb, x - 2, y - 2, 5, 5, 18, 22, 14);
      if (sel) { PSX.rect(fb, x - 5, y - 5, 11, 1, ...GOLD); PSX.rect(fb, x - 5, y + 5, 11, 1, ...GOLD); }
    });
    const nd = nodes[M.node];
    this.box(14, 180, 292, 36, [0, 0, 0], 0.85, [120, 130, 90]);
    const known = M.node <= here;
    F.draw(fb, known ? nd.label : '???', 20, 184, GOLD);
    if (known && nd.note) F.draw(fb, nd.note, 20, 199, [200, 196, 180]);
  }
  drawFiles() {
    const fb = this.fb, F = this.F, M = this.menu, files = this.fileList(), docs = this.g.A.content.files;
    this.box(8, 8, 304, 212, [16, 12, 8], 0.95, [120, 104, 80]);
    F.draw(fb, 'FILES', 16, 12, [230, 200, 140]);
    if (!files.length) { F.draw(fb, 'No files.', 20, 36, GREY); return; }
    files.forEach((id, i) => F.draw(fb, (i === M.fsel ? '> ' : '  ') + docs[id].title, 20, 34 + i * 14, i === M.fsel ? GOLD : [210, 200, 180]));
  }

  // pre-rendered item icons (like the originals), built once
  icon(id) {
    if (!this.icons) this.icons = {};
    if (!this.icons[id]) {
      const def = this.items[id], m = this.g.A.models[def.model];
      const fb = new PSX.Frame(64, 44);
      for (let y = 0; y < 44; y++) PSX.rect(fb, 0, y, 64, 1, 10 + y / 3, 12 + y / 3, 24 + y / 2);   // dim backdrop, like the originals
      const gun = !!def.weapon;
      PSX.render(fb, framed(m, 64, 44, gun ? -90 : -30, gun ? 1.05 : 1.0, gun ? 0.15 : 0.45), [{ model: m, x: 0, y: 0, z: 0, yaw: 0, pose: {} }],
        gun ? new PSX.Lights([[0.3, 0.5, -0.8], [-0.6, -0.2, -0.4]], [[1.3, 1.25, 1.15], [0.55, 0.58, 0.7]], [0.9, 0.9, 0.95])   // dark gunmetal needs more light
          : new PSX.Lights([[0.5, 0.7, -0.6], [-0.6, -0.2, -0.2]], [[0.9, 0.88, 0.8], [0.3, 0.32, 0.4]], [0.45, 0.45, 0.48]));
      for (let i = 3; i < fb.px.length; i += 4) fb.px[i] = 255;       // opaque: the rasteriser never writes alpha, and blitSprite alpha-tests
      this.icons[id] = fb;
    }
    return this.icons[id];
  }

  // ---------------------------------------------------------------- full screens
  drawTitle(sel, hasSaves) {
    const g = this.g, fb = this.fb, C = g.titleCam;
    if (C && C.plate) fb.blit(C.plate.px); else fb.fill(0, 0, 0);
    PSX.darken(fb, 0.35);
    const T = g.A.content.game, flick = 0.85 + 0.15 * Math.sin(g.time * 7) * Math.sin(g.time * 2.3);
    this.center(T.title, 50, [Math.floor(200 * flick), 10, 10], 2);
    this.center(T.subtitle, 84, [210, 200, 180]);
    this.center(T.tagline, 100, [130, 124, 116]);
    const opts = ['NEW GAME', 'LOAD GAME'];
    opts.forEach((o, i) => {
      const dis = i === 1 && !hasSaves;
      this.center((i === sel ? '> ' : '  ') + o + (i === sel ? ' <' : '  '), 136 + i * 16, dis ? [90, 90, 90] : i === sel ? GOLD : WHITE);
    });
    ['ARROWS: move    SHIFT: run    DOWN+SHIFT: 180', 'Z: aim    X: fire    ENTER: action', 'TAB: status    M: map    ESC: back']
      .forEach((l, i) => this.center(l, 188 + i * 13, GREY));
  }
  drawIntro(t) {
    const fb = this.fb, lines = (this._intro ||= this.g.A.content.game.intro.flatMap(l => l ? this.wrap(l, 300) : ['']));
    fb.fill(0, 0, 0);
    const shown = Math.floor(t * 40);
    let n = 0;
    lines.forEach((l, i) => {
      const s = l.slice(0, Math.max(0, shown - n)); n += l.length + 8;
      this.F.draw(fb, s, 160 - (this.F.width(l) >> 1), 36 + i * 15, [200, 196, 186]);
    });
    if (t > 3 && Math.floor(this.g.time * 2) % 2 === 0) this.center('PRESS ENTER', 214, [120, 120, 120]);
  }
  drawSlots(title, sel) {
    const fb = this.fb, F = this.F;
    PSX.darken(fb, 0.25);
    this.box(30, 30, 260, 170, [8, 8, 12], 0.96, [150, 140, 110]);
    this.center(title, 38, GOLD);
    Saves.list().forEach((s, i) => {
      const y = 62 + i * 42;
      this.box(44, y, 232, 36, [0, 0, 0], 0.9, i === sel ? GOLD : [100, 100, 96]);
      if (!s) { F.draw(fb, `${i + 1}.  NO DATA`, 54, y + 12, GREY); return; }
      const t = Math.floor(s.time), hh = Math.floor(t / 3600), mm = Math.floor(t / 60) % 60, ss = t % 60;
      F.draw(fb, `${i + 1}.  ${s.room}`, 54, y + 5, WHITE);
      F.draw(fb, `TIME ${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}    SAVES ${s.saves}`, 72, y + 19, [190, 186, 170]);
    });
  }
  drawDead(t) {
    const fb = this.fb;
    PSX.darken(fb, Math.max(0.25, 1 - t * 0.4));
    PSX.tintScreen(fb, 90, 0, 0, Math.min(0.5, t * 0.25));
    this.center('YOU DIED', 100, RED, 2);
    if (t > 2) this.center(Saves.any() ? 'ENTER: load a save    ESC: title' : 'Press ENTER to try again', 150, [200, 200, 200]);
  }
  drawChapter(ch, t) {
    const fb = this.fb, S = this.g.state;
    PSX.darken(fb, Math.max(0, 1 - t / 2));
    if (t < 2) return;
    const lines = (ch._lines ||= ch.text.join('\n').split(/\n\s*\n/).flatMap((t, i) =>   // paragraphs ('' in the text), each balanced
      [...(i ? [''] : []), ...this.balanced(t.replace(/\s+/g, ' ').trim(), 300)]));
    const top = Math.max(14, 30 - Math.max(0, lines.length - 6) * 7), step = lines.length > 8 ? 13 : 15;
    lines.forEach((l, i) => this.center(l, top + i * step, [200, 196, 186]));
    const y = top + 10 + lines.length * step;
    const t2 = Math.floor(S.time), tm = `${Math.floor(t2 / 3600)}:${String(Math.floor(t2 / 60) % 60).padStart(2, '0')}:${String(t2 % 60).padStart(2, '0')}`;
    if (ch.final) {                                                   // RE-style results and rank
      this.center('THE END', y, [200, 20, 20], 2);
      const acc = S.stats.shots ? Math.round(100 * S.stats.kills / S.stats.shots) : 0;
      const pts = (t2 < 5400 ? 2 : t2 < 7200 ? 1 : 0) + (S.saves <= 3 ? 2 : S.saves <= 8 ? 1 : 0) + (S.stats.shots && S.stats.kills / S.stats.shots > 0.25 ? 1 : 0);
      const rank = pts >= 5 ? 'A' : pts >= 3 ? 'B' : 'C';
      this.center(`CLEAR TIME ${tm}    SAVES ${S.saves}    KILLS ${S.stats.kills}`, y + 30, [190, 186, 170]);
      this.center(`RANK  ${rank}`, y + 50, [255, 220, 90], 2);
      if (t > 5) this.center('PRESS ENTER', y + 80, [120, 120, 120]);
      return;
    }
    this.center(ch.hasNext ? 'THE JOURNEY CONTINUES' : 'TO BE CONTINUED', y, [200, 20, 20]);
    this.center(`TIME ${tm}   SHOTS ${S.stats.shots}   KILLS ${S.stats.kills}   SAVES ${S.saves}`, y + 22, [170, 166, 150]);
    if (t > 4) this.center('PRESS ENTER', y + 46, [120, 120, 120]);
  }
}

// frame a model by its bounding sphere (icons, item examine)
export function framed(m, w, h, yaw, fill = 0.9, elev = 0.45) {
  const mats = PSX.partMatrices(m, {});
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  m.parts.forEach((p, pi) => {
    for (let i = 0; i < p.nv; i++) {
      const w3 = PSX.xform(mats[pi], p.verts[i * 3], p.verts[i * 3 + 1], p.verts[i * 3 + 2]);
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w3[k] / 1000); mx[k] = Math.max(mx[k], w3[k] / 1000); }
    }
  });
  const c = [0, 1, 2].map(k => (mn[k] + mx[k]) / 2), r = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2;
  const dist = r * 3.2, a = (yaw + 90) * D2R;
  const eye = [c[0] + Math.cos(a) * dist * Math.cos(elev), c[1] + Math.sin(a) * dist * Math.cos(elev), c[2] + dist * Math.sin(elev)];
  return PSX.Camera.lookAt(eye, c, (Math.min(w, h) * 0.5 * fill) * dist / r, w, h);
}
