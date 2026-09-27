// Level data: walk grid, floor heights, camera zones, plates, sprites, models.
import { Model, Camera, Font } from './psx.js';

const DATA = window.RE_DATA || '../out/game/data/';   // the published site sets RE_DATA = 'data/'

function b64(s, Type) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Type(u8.buffer);
}

async function loadImage(url) {
  // createImageBitmap decodes even while the tab is hidden (Image.decode() can stall there)
  const img = await createImageBitmap(await (await fetch(url)).blob());
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, px: g.getImageData(0, 0, img.width, img.height).data };
}

export async function loadAll(progress = () => {}) {
  const level = await (await fetch(DATA + 'level.json')).json();
  progress(0.15);
  const poses = await (await fetch(DATA + 'poses.json')).json();
  const fontMeta = await (await fetch(DATA + 'font.json')).json();
  const font = new Font(await loadImage(DATA + 'font.png'), fontMeta);
  const names = ['bryan', 'farmwife', 'farmer', 'amalgam', 'dog', 'herb', 'first_aid_spray', 'shotgun_shells', 'shotgun', 'pistol', 'door', 'diary'];
  const models = {};
  let k = 0;
  await Promise.all(names.map(async n => {
    models[n] = new Model(await (await fetch(DATA + 'models/' + n + '.json')).json());
    progress(0.15 + 0.45 * (++k / names.length));
  }));
  const cams = [];
  k = 0;
  await Promise.all(level.cameras.map(async (c, i) => {
    const plate = await loadImage(DATA + 'bg/' + c.name + '.png');
    const d16 = new Uint16Array(await (await fetch(DATA + 'bg/' + c.name + '_depth.u16')).arrayBuffer());
    const depth = new Float32Array(d16.length);
    for (let j = 0; j < d16.length; j++) depth[j] = d16[j] / 100;
    cams[i] = { name: c.name, cam: Camera.fromMeta(c), plate, depth, sprites: [] };
    progress(0.6 + 0.35 * (++k / level.cameras.length));
  }));
  await Promise.all(level.item_sprites.map(async s => {
    const ci = cams.findIndex(c => c.name === s.cam);
    if (ci >= 0) cams[ci].sprites.push({ item: s.item, x: s.x, y: s.y, img: await loadImage(DATA + 'bg/' + s.file) });
  }));
  progress(1);
  return { level, poses, font, models, cams, grid: new Grid(level.grid) };
}

export class Grid {
  constructor(g) {
    this.x0 = g.x0; this.y0 = g.y0; this.res = g.res; this.nx = g.nx; this.ny = g.ny;
    this.area = b64(g.area, Uint8Array);
    this.h = b64(g.height_cm, Int16Array);
    this.surf = b64(g.surf, Uint8Array);
    this.best = b64(g.cam_best, Uint8Array);
    this.mask = b64(g.cam_mask, Uint16Array);
    this.top = b64(g.top_cm, Int16Array);
    // coarse nav grid (2x2 cells) for flow fields
    this.cn = Math.floor(this.nx / 2); this.cm = Math.floor(this.ny / 2);
    this.coarse = new Uint8Array(this.cn * this.cm);
    for (let j = 0; j < this.cm; j++) for (let i = 0; i < this.cn; i++) {
      // open if most of its 4 fine cells are walkable (keeps narrow passages connected)
      const c = [0, 0, 0];
      for (const [dj, di] of [[0, 0], [0, 1], [1, 0], [1, 1]]) c[this.area[(2 * j + dj) * this.nx + 2 * i + di]]++;
      this.coarse[j * this.cn + i] = c[1] >= 3 ? 1 : c[2] >= 3 ? 2 : 0;
    }
  }
  idx(x, y) {
    const i = Math.floor((x - this.x0) / this.res), j = Math.floor((y - this.y0) / this.res);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return -1;
    return j * this.nx + i;
  }
  areaAt(x, y) { const k = this.idx(x, y); return k < 0 ? 0 : this.area[k]; }
  walkable(x, y, area) { const a = this.areaAt(x, y); return a !== 0 && (area === undefined || a === area); }
  floor(x, y) { const k = this.idx(x, y); return k < 0 ? 0 : Math.max(0, this.h[k] / 100); }
  surface(x, y) { const k = this.idx(x, y); return k < 0 ? 0 : this.surf[k]; }
  // line of sight across walkable ground (walls, furniture and railings block)
  los(ax, ay, bx, by, area, skipEnds = 0) {
    const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 0.15);
    for (let s = 1; s < n; s++) {
      const t = s / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      if (skipEnds && (t * d < skipEnds || (1 - t) * d < skipEnds)) continue;   // for sight: bodies may overlap obstacles
      if (!this.walkable(x, y, area)) return false;
    }
    return true;
  }
  // bullet line of sight: blocked only where an obstacle rises above the shot's height
  shotLos(ax, ay, az, bx, by, bz) {
    const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 0.1);
    for (let s = 1; s < n; s++) {
      const t = s / n;
      if (t * d < 0.4 || (1 - t) * d < 0.4) continue;
      const k = this.idx(ax + (bx - ax) * t, ay + (by - ay) * t);
      if (k < 0) return false;
      if (this.top[k] / 100 > az + (bz - az) * t) return false;
    }
    return true;
  }
  nearestWalkable(x, y, area, maxR = 3) {
    if (this.walkable(x, y, area)) return [x, y];
    for (let r = this.res; r < maxR; r += this.res) {
      for (let a = 0; a < 24; a++) {
        const px = x + Math.cos(a / 24 * 6.283) * r, py = y + Math.sin(a / 24 * 6.283) * r;
        if (this.walkable(px, py, area)) return [px, py];
      }
    }
    return [x, y];
  }
  // BFS distance field on the coarse grid from (x,y)
  flow(x, y, area) {
    const n = this.cn, m = this.cm, dist = this._dist || (this._dist = new Int32Array(n * m));
    dist.fill(-1);
    const q = this._q || (this._q = new Int32Array(n * m));
    let ci = Math.floor((x - this.x0) / (this.res * 2)), cj = Math.floor((y - this.y0) / (this.res * 2));
    if (ci < 0 || cj < 0 || ci >= n || cj >= m) return null;
    if (this.coarse[cj * n + ci] !== area) {                // seed from the nearest walkable coarse cell
      let best = null, bd = 1e9;
      for (let dj = -6; dj <= 6; dj++) for (let di = -6; di <= 6; di++) {
        const ii = ci + di, jj = cj + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= m || this.coarse[jj * n + ii] !== area) continue;
        if (di * di + dj * dj < bd) { bd = di * di + dj * dj; best = [ii, jj]; }
      }
      if (!best) return null;
      [ci, cj] = best;
    }
    let h = 0, t = 0;
    q[t++] = cj * n + ci; dist[cj * n + ci] = 0;
    while (h < t) {
      const c = q[h++], i = c % n, j = (c / n) | 0, d = dist[c] + 1;
      if (d > 400) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= m) continue;
        const k = jj * n + ii;
        if (dist[k] >= 0 || this.coarse[k] !== area) continue;
        if (di && dj && (this.coarse[j * n + ii] !== area || this.coarse[jj * n + i] !== area)) continue;
        dist[k] = d; q[t++] = k;
      }
    }
    return dist;
  }
  // direction (unit) down the flow field from (x,y), or null
  flowDir(dist, x, y, area) {
    // steer toward the CENTRE of the lowest-cost neighbouring cell (not a raw grid direction),
    // and only if that step is open at full resolution
    const n = this.cn, m = this.cm, r2 = this.res * 2;
    const i = Math.floor((x - this.x0) / r2), j = Math.floor((y - this.y0) / r2);
    if (i < 0 || j < 0 || i >= n || j >= m) return null;
    const here = dist[j * n + i];
    const cand = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= n || jj >= m) continue;
      const d = dist[jj * n + ii];
      if (d >= 0 && (here < 0 || d < here)) cand.push([d, ii, jj]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (const [, ii, jj] of cand) {
      const cx = this.x0 + (ii + 0.5) * r2, cy = this.y0 + (jj + 0.5) * r2;
      const dx = cx - x, dy = cy - y, l = Math.hypot(dx, dy) || 1;
      if (area === undefined || this.walkable(x + dx / l * 0.15, y + dy / l * 0.15, area)) return [dx / l, dy / l];
    }
    return null;
  }
  // camera for a position: keep the current one while it still sees us (hysteresis)
  // camera for a position: RE-style zones, with a small dead-band at zone edges so
  // standing on a boundary doesn't flicker between two shots
  camera(x, y, current) {
    const k = this.idx(x, y);
    if (k < 0) return current;
    const b = this.best[k];
    if (b === 255 || b === current) return current;
    const valid = current >= 0 && (this.mask[k] >> current) & 1;
    if (!valid) return b;
    const d = 0.3;
    for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
      const kk = this.idx(x + dx, y + dy);
      if (kk >= 0 && this.best[kk] !== b && this.best[kk] !== 255) return current;
    }
    return b;
  }
}
