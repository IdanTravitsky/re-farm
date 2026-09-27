// Authoring aids (?debug): F1 overlay (walk grid coloured by camera zone,
// interactables, trigger zones, enemy states), F2 next room, F3 god mode + all items.
import * as PSX from './psx.js';

const ZONE = [[230, 80, 80], [80, 200, 80], [80, 120, 240], [230, 200, 60], [200, 80, 220], [60, 210, 210],
  [240, 140, 40], [150, 150, 150], [120, 60, 20], [20, 90, 60], [250, 250, 120], [120, 120, 250]];

export class Debug {
  constructor(g) { this.g = g; this.overlay = true; this.fps = 30; this.last = performance.now(); g.debug = this; }
  keys(list) {
    const g = this.g;
    for (const k of list) {
      if (k === 'F1') this.overlay = !this.overlay;
      if (k === 'F2' && g.mode === 'play') {
        const rooms = g.location.rooms, i = (rooms.indexOf(g.state.room) + 1) % rooms.length;
        g.A.room(rooms[i]).then(r => { const [x, y] = [r.x0 + r.nx * r.res / 2, r.y0 + r.ny * r.res / 2]; g.enterRoom(rooms[i], ...r.nearestWalkable(x, y, 30), 0); });
      }
      if (k === 'F3' && g.state) {
        g.god = !g.god;
        for (const [id, def] of Object.entries(g.A.content.items)) if (def.kind === 'weapon' || def.kind === 'ammo' || def.kind === 'save') g.give(id, def.kind === 'weapon' ? def.weapon.mag : 20);
        g.ui.say([g.god ? 'DEBUG: god mode on, items given.' : 'DEBUG: god mode off.']);
      }
    }
  }
  draw() {
    const g = this.g, fb = g.fb, now = performance.now();
    this.fps = this.fps * 0.9 + 0.1 * (1000 / Math.max(1, now - this.last)); this.last = now;
    if (!this.overlay || g.mode !== 'play' || !g.room) return;
    const R = g.room, C = R.cameras[g.cam], cam = C.cam, p = g.player;
    // walk grid, sampled every 0.3 m around the player, coloured by camera zone
    for (let y = p.y - 9; y < p.y + 9; y += 0.3) for (let x = p.x - 9; x < p.x + 9; x += 0.3) {
      const k = R.idx(x, y);
      if (k < 0 || !R.walkA[k]) continue;
      const pr = cam.project(x, y, R.floor(x, y) + 0.02);
      if (!pr || pr[0] < 0 || pr[1] < 0 || pr[0] > 319 || pr[1] > 239) continue;
      if (pr[2] > C.depth[(pr[1] | 0) * 320 + (pr[0] | 0)] + 0.1) continue;
      const z = ZONE[R.best[k] % ZONE.length];
      PSX.rect(fb, pr[0] | 0, pr[1] | 0, 1, 1, ...z);
    }
    const ring = (at, r, col) => {
      for (let a = 0; a < 24; a++) {
        const x = at[0] + Math.cos(a / 24 * 6.283) * r, y = at[1] + Math.sin(a / 24 * 6.283) * r;
        const pr = cam.project(x, y, R.floor(x, y) + 0.05);
        if (pr) PSX.rect(fb, pr[0] | 0, pr[1] | 0, 2, 2, ...col);
      }
    };
    for (const c of g.candidates()) ring(c.at, c.r, c.kind === 'door' ? [255, 255, 255] : c.kind === 'pickup' ? [255, 220, 60] : c.kind === 'typewriter' ? [80, 200, 255] : [160, 160, 160]);
    for (const t of g.location.triggers || []) {
      if (t.on.event !== 'zone' || t.on.room !== g.state.room) continue;
      const [x0, y0, x1, y1] = t.on.rect, col = g.state.fired[t.id] ? [90, 90, 90] : [255, 60, 200];
      for (const [ax, ay, bx, by] of [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]) {
        for (let s = 0; s <= 20; s++) { const pr = cam.project(ax + (bx - ax) * s / 20, ay + (by - ay) * s / 20, 0.05); if (pr) PSX.rect(fb, pr[0] | 0, pr[1] | 0, 1, 1, ...col); }
      }
    }
    const F = g.A.font;
    for (const e of g.enemies) {
      const pr = cam.project(e.x, e.y, e.z + 2.0);
      if (pr) F.draw(fb, `${e.id}:${e.state}:${Math.round(e.hp)}`, (pr[0] | 0) - 20, pr[1] | 0, [255, 120, 120]);
    }
    F.draw(fb, `${C.id}  ${g.state.room}  ${p.x.toFixed(2)},${p.y.toFixed(2)}  yaw ${Math.round(p.yaw)}  ${Math.round(this.fps)}fps${g.god ? '  GOD' : ''}`, 4, 2, [255, 255, 160]);
  }
}
