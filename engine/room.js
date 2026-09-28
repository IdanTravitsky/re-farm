// A room: its walk grid (collision, floor heights, surfaces, obstacle tops),
// its fixed cameras and camera zones, and pathfinding (BFS flow fields).
import { Camera, Lights } from './psx.js';

function b64(s, Type) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Type(u8.buffer);
}

// world position of a camera from its world-to-camera matrix (eye = -R^T t)
const camEye = (m) => [-(m[0] * m[3] + m[4] * m[7] + m[8] * m[11]), -(m[1] * m[3] + m[5] * m[7] + m[9] * m[11]), -(m[2] * m[3] + m[6] * m[7] + m[10] * m[11])];

const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class Room {
  // json: rooms/<id>.json; gridImg: its decoded packed-grid PNG ({w, h, ch: 3, data})
  constructor(json, gridImg, bodyImg = null) {
    Object.assign(this, { id: json.id, location: json.location, name: json.name, music: json.music, wind: json.wind || 0, musicZones: json.music_zones || [] });
    const g = json.grid;
    Object.assign(this, { x0: g.x0, y0: g.y0, res: g.res, nx: g.nx, ny: g.ny });
    const n = g.nx * g.ny, D = gridImg.data, b1 = n * 3, b2 = n * 6;
    this.walkA = new Uint8Array(n); this.surf = new Uint8Array(n); this.best = new Uint8Array(n);
    this.mask = new Uint16Array(n); this.h = new Int16Array(n); this.top = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const a = i * 3;
      this.walkA[i] = D[a] & 1; this.surf[i] = D[a] >> 1; this.best[i] = D[a + 1];
      this.mask[i] = D[a + 2] | (D[b1 + a] << 8);
      this.h[i] = ((D[b1 + a + 1] << 8) | D[b1 + a + 2]) - 32768;
      this.top[i] = ((D[b2 + a] << 8) | D[b2 + a + 1]) - 32768;
    }
    if (json.walk_floor_limit) {
      const [lo, hi] = json.walk_floor_limit;
      for (let k=0;k<n;k++) if (this.h[k]/100 < lo || this.h[k]/100 > hi) this.walkA[k]=0;
    }
    this.bodyA = bodyImg ? Uint8Array.from({length:n},(_,k)=>bodyImg.data[k * bodyImg.ch] ? 1 : 0) : null;
    this.map = json.map;
    this.mapCells = json.map ? b64(json.map.cells, Uint8Array) : null;
    this.cameras = json.cameras.map(c => ({
      id: c.id, cam: Camera.fromMeta({ world_to_camera: c.world_to_camera, focal_px: c.focal_px, width: 320, height: 240 }),
      lights: c.lights || { pts: [], amb: [0.4, 0.4, 0.4] }, sprites: c.sprites || [],
      plate: null, depth: null, plateHDFile: c.plate_hd, plateHD: null,                          // filled in by Assets.loadPlates
    }));
    // coarse nav grid (2x2 cells, open when 3 of 4 are walkable) for flow fields
    this.cn = this.nx >> 1; this.cm = this.ny >> 1;
    this.coarse = new Uint8Array(this.cn * this.cm);
    for (let j = 0; j < this.cm; j++) for (let i = 0; i < this.cn; i++) {
      let c = 0;
      for (const [dj, di] of [[0, 0], [0, 1], [1, 0], [1, 1]]) c += this.walkA[(2 * j + dj) * this.nx + 2 * i + di];
      this.coarse[j * this.cn + i] = c >= 3 ? 1 : 0;
    }
  }
  idx(x, y) {
    const i = Math.floor((x - this.x0) / this.res), j = Math.floor((y - this.y0) / this.res);
    return i < 0 || j < 0 || i >= this.nx || j >= this.ny ? -1 : j * this.nx + i;
  }
  walkable(x, y) {
    const k = this.idx(x, y);
    if (k < 0 || this.walkA[k] !== 1) return false;
    for (const [x0, y0, x1, y1] of this.blocks || []) if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return false;   // gone (a fallen span)
    return true;
  }
  canStand(x, y, radius = 0.23) {
    if (!this.walkable(x,y)) return false;
    for(const [x0,y0,x1,y1] of this.blocks || []) {
      const dx=x-Math.max(x0,Math.min(x,x1)),dy=y-Math.max(y0,Math.min(y,y1));
      if(dx*dx+dy*dy < radius*radius) return false;
    }
    // A human's legs can pass beside a low chair/table while the wider upper
    // body must clear walls and tall furniture. Large creatures retain full size.
    const footRadius=this.bodyA && radius<=.3 ? Math.min(radius,.14) : radius;
    return this.clearDisk(x,y,footRadius,this.walkA,false) &&
      (!this.bodyA || this.clearDisk(x,y,radius,this.bodyA,true));
  }
  clearDisk(x,y,radius,grid,solidValue) {
    const a=Math.floor((x-radius-this.x0)/this.res), b=Math.floor((x+radius-this.x0)/this.res);
    const c=Math.floor((y-radius-this.y0)/this.res), d=Math.floor((y+radius-this.y0)/this.res);
    for(let j=c;j<=d;j++) for(let i=a;i<=b;i++) {
      if(i>=0&&j>=0&&i<this.nx&&j<this.ny&&Boolean(grid[j*this.nx+i])!==solidValue)continue;
      const left=this.x0+i*this.res, bottom=this.y0+j*this.res;
      const dx=x-Math.max(left,Math.min(x,left+this.res)),dy=y-Math.max(bottom,Math.min(y,bottom+this.res));
      if(dx*dx+dy*dy < radius*radius-1e-8)return false;
    }
    return true;
  }
  floor(x, y) { const k = this.idx(x, y); return k < 0 ? 0 : this.h[k] / 100; }          // sets may sit below ground (interiors)
  surface(x, y) { const k = this.idx(x, y); return k < 0 ? 0 : this.surf[k]; }

  // movement line of sight (strict); skipEnds>0 for "can I see it" where bodies overlap obstacles
  los(ax, ay, bx, by, skipEnds = 0) {
    const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / (this.res * 0.5));
    for (let s = 1; s < n; s++) {
      const t = s / n;
      if (skipEnds && (t * d < skipEnds || (1 - t) * d < skipEnds)) continue;
      if (!this.walkable(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
    }
    return true;
  }
  // bullets: blocked only where an obstacle rises above the shot's line
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
  nearestWalkable(x, y, maxR = 4, radius = 0) {
    if (this.canStand(x, y, radius)) return [x, y];
    for (let r = this.res; r < maxR; r += this.res) {
      for (let a = 0; a < 32; a++) {
        const px = x + Math.cos(a / 32 * 6.2832) * r, py = y + Math.sin(a / 32 * 6.2832) * r;
        if (this.canStand(px, py, radius)) return [px, py];
      }
    }
    return [x, y];
  }
  path(ax,ay,bx,by,radius=0.23,blocked=()=>false) {
    [bx,by]=this.nearestWalkable(bx,by,4,radius);
    const start=this.idx(ax,ay);let goal=this.idx(bx,by);
    if(start<0||goal<0)return null;
    const n=this.walkA.length,cost=new Float64Array(n).fill(Infinity),prev=new Int32Array(n).fill(-1),heap=[];
    const point=k=>[this.x0+(k%this.nx+.5)*this.res,this.y0+(Math.floor(k/this.nx)+.5)*this.res];
    const push=(k,f)=>{heap.push([k,f]);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p][1]<=f)break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p;}};
    const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let i=0;while(true){let c=i*2+1;if(c>=heap.length)break;if(c+1<heap.length&&heap[c+1][1]<heap[c][1])c++;if(heap[i][1]<=heap[c][1])break;[heap[i],heap[c]]=[heap[c],heap[i]];i=c;}}return top[0];};
    const valid=new Int8Array(n).fill(-1),closed=new Uint8Array(n);
    const open=k=>{if(k<0||k>=n)return false;if(valid[k]<0){const[x,y]=point(k);valid[k]=this.canStand(x,y,radius)&&!blocked(x,y)?1:0;}return valid[k]===1;};
    // The closest valid point need not share a cell with a valid cell centre.
    // Pick a body-safe nav node, including live vehicle footprints.
    if(!open(goal)) {
      let best=Infinity,found=-1;
      for(let k=0;k<n;k++){const[x,y]=point(k),d=Math.hypot(x-bx,y-by);if(d<4&&d<best&&open(k)){best=d;found=k;}}
      if(found<0)return null;goal=found;
    }
    cost[start]=0;push(start,0);let count=0;
    while(heap.length&&count++<100000){const k=pop();if(closed[k])continue;closed[k]=1;if(k===goal){const path=[];for(let at=goal;at!==start;at=prev[at]){if(at<0)return null;path.push(point(at));}return path.reverse();}
      const x=k%this.nx,y=Math.floor(k/this.nx);
      for(const[dx,dy]of N8){const xx=x+dx,yy=y+dy;if(xx<0||xx>=this.nx||yy<0||yy>=this.ny)continue;const kk=yy*this.nx+xx;if(this.h[kk]-this.h[k]>22||this.h[k]-this.h[kk]>65||!open(kk)||(dx&&dy&&(!open(y*this.nx+xx)||!open(yy*this.nx+x))))continue;
        const next=cost[k]+(dx&&dy?1.4142:1);if(next>=cost[kk])continue;cost[kk]=next;prev[kk]=k;push(kk,next+Math.hypot(xx-goal%this.nx,yy-Math.floor(goal/this.nx)));
      }
    }
    return null;
  }
  // BFS distance field on the coarse grid, seeded at (x, y)
  flow(x, y) {
    const n = this.cn, m = this.cm;
    const dist = this._dist || (this._dist = new Int32Array(n * m));
    const q = this._q || (this._q = new Int32Array(n * m));
    dist.fill(-1);
    let ci = Math.floor((x - this.x0) / (this.res * 2)), cj = Math.floor((y - this.y0) / (this.res * 2));
    if (ci < 0 || cj < 0 || ci >= n || cj >= m) return null;
    if (!this.coarse[cj * n + ci]) {
      let best = null, bd = 1e9;
      for (let dj = -6; dj <= 6; dj++) for (let di = -6; di <= 6; di++) {
        const ii = ci + di, jj = cj + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= m || !this.coarse[jj * n + ii]) continue;
        if (di * di + dj * dj < bd) { bd = di * di + dj * dj; best = [ii, jj]; }
      }
      if (!best) return null;
      [ci, cj] = best;
    }
    let h = 0, t = 0;
    q[t++] = cj * n + ci; dist[cj * n + ci] = 0;
    while (h < t) {
      const c = q[h++], i = c % n, j = (c / n) | 0, d = dist[c] + 1;
      for (const [di, dj] of N8) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= m) continue;
        const kk = jj * n + ii;
        if (dist[kk] >= 0 || !this.coarse[kk]) continue;
        if (di && dj && (!this.coarse[j * n + ii] || !this.coarse[jj * n + i])) continue;
        dist[kk] = d; q[t++] = kk;
      }
    }
    return dist.slice();
  }
  // step toward the centre of the cheapest neighbouring cell that is open at full resolution
  flowDir(dist, x, y) {
    const n = this.cn, m = this.cm, r2 = this.res * 2;
    const i = Math.floor((x - this.x0) / r2), j = Math.floor((y - this.y0) / r2);
    if (!dist || i < 0 || j < 0 || i >= n || j >= m) return null;
    const here = dist[j * n + i];
    const cand = [];
    for (const [di, dj] of N8) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= n || jj >= m) continue;
      const d = dist[jj * n + ii];
      if (di && dj && (!this.coarse[j * n + ii] || !this.coarse[jj * n + i])) continue;
      if (d >= 0 && (here < 0 || d < here)) cand.push([d, ii, jj]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (const [, ii, jj] of cand) {
      const dx = this.x0 + (ii + 0.5) * r2 - x, dy = this.y0 + (jj + 0.5) * r2 - y, l = Math.hypot(dx, dy) || 1;
      if (this.walkable(x + dx / l * 0.15, y + dy / l * 0.15) && this.los(x, y, x + dx / l * 0.15, y + dy / l * 0.15)) return [dx / l, dy / l];
    }
    return null;
  }
  // RE-style camera zones with a small dead-band at the edges (no flicker on boundaries)
  camera(x, y, current) {
    const k = this.idx(x, y);
    if (k < 0) return current;
    const b = this.best[k];
    if (b === 255 || b === current) return current;
    if (current < 0 || !((this.mask[k] >> current) & 1)) return b;
    for (const [dx, dy] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
      const kk = this.idx(x + dx, y + dy);
      if (kk >= 0 && this.best[kk] !== b && this.best[kk] !== 255) return current;
    }
    return b;
  }
  // per-character lights for a camera: point-ish lights evaluated at the character
  lightsFor(ci, x, y, z, boost = 0, lamps = null) {
    const L = this.cameras[ci].lights;
    const dirs = [], cols = [];
    for (const [p, c, range] of L.pts) {
      const d = [x - p[0], y - p[1], (z + 1.0) - p[2]];
      const k = range ? Math.max(0.25, Math.min(1.25, range / (Math.hypot(...d) + 0.5))) : 1;
      const lum = c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15;           // a set's coloured light tints a face, it doesn't dye it (the green EXIT sign)
      dirs.push(d); cols.push(c.map(v => (lum + (v - lum) * 0.6) * k));
    }
    const eye = this.cameras[ci].eye || (this.cameras[ci].eye = camEye(this.cameras[ci].cam.m));
    dirs.push([x - eye[0], y - eye[1], (z + 1.2) - eye[2]]);       // a soft fill from the lens: never a black silhouette
    cols.push(L.fill || [0.2, 0.2, 0.23]);
    for (const l of lamps || []) {                               // moving lamps: only inside their beam
      const d = [x - l.x, y - l.y, (z + 1.0) - l.z], dist = Math.hypot(...d);
      if (dist > l.range || dist < 0.3) continue;
      let k = (1 - dist / l.range) * 1.6 * (l.power ?? 1);
      if (l.dir) { const c = (d[0] * l.dir[0] + d[1] * l.dir[1] + d[2] * l.dir[2]) / dist, co = Math.cos(l.cone * Math.PI / 180); if (c < co) continue; k *= Math.min(1, (c - co) / (1 - co) * 2); }
      dirs.push(d); cols.push(l.col.map(v => v * k));
    }
    return new Lights(dirs, cols, L.amb.map(v => v + boost));
  }
}
