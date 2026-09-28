// PS1-style renderer: a JavaScript port of scripts/psx/gpu.py.
// Fixed-point GTE transforms with integer perspective divide (vertex snapping),
// ordering-table painter's sort, NCLIP culling, affine texture mapping,
// 4-bit CLUT textures, texel*colour/128 modulation, 4x4 ordered dither,
// 15-bit output, and scenery masking against the pre-rendered plate's depth.

export const DITHER = [-4, 0, -3, 1, 2, -2, 3, -1, -3, 1, -4, 0, 3, -1, 2, -2];
const D2R = Math.PI / 180;

// ---------------------------------------------------------------- math
export function rotXYZ(rx, ry, rz) {           // degrees -> 3x3 (row-major), R = Rz*Ry*Rx
  rx *= D2R; ry *= D2R; rz *= D2R;
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

export function mat4(R, t) {                 // 3x3 + translation -> 4x4 row-major
  return [R[0], R[1], R[2], t[0], R[3], R[4], R[5], t[1], R[6], R[7], R[8], t[2], 0, 0, 0, 1];
}

export function mul4(a, b) {
  const o = new Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    o[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j] + a[i * 4 + 3] * b[12 + j];
  }
  return o;
}

export function xform(m, x, y, z) {
  return [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
}

// ---------------------------------------------------------------- models
function b64bytes(s) {
  const bin = atob(s);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

export class Model {
  constructor(json) {
    this.name = json.name;
    this.texW = json.tex_w; this.texH = json.tex_h;
    this.tex = b64bytes(json.tex_b64);
    this.cluts = json.cluts.map(c => Int32Array.from(c.flat()));
    this.parts = json.parts.map(p => ({
      name: p.name, parent: p.parent, offset: p.offset,
      verts: Int32Array.from(p.verts.flat()),
      normals: Float32Array.from(p.normals.flat().map(v => v / 4096)),
      nv: p.verts.length,
      faces: p.faces.map(f => ({ v: f.v, uv: f.uv.flat(), clut: f.clut, dbl: f.double })),
    }));
    this.index = Object.fromEntries(this.parts.map((p, i) => [p.name, i]));
  }
}

// world-from-part matrices (mm) for a pose {part: [rx,ry,rz(,tx,ty,tz)], _root: [dx,dy,dz]}
export function partMatrices(model, pose) {
  const mats = [];
  const root = pose._root || [0, 0, 0];
  for (const p of model.parts) {
    const r = pose[p.name] || [0, 0, 0];
    let off = p.offset;
    if (p.parent < 0) off = [off[0] + root[0], off[1] + root[1], off[2] + root[2]];
    if (r.length > 3) off = [off[0] + r[3], off[1] + r[4], off[2] + r[5]];     // sliding parts (elevator leaves)
    const local = mat4(rotXYZ(r[0], r[1], r[2]), off);
    mats.push(p.parent >= 0 ? mul4(mats[p.parent], local) : local);
  }
  return mats;
}

// ---------------------------------------------------------------- frame & camera
export class Frame {
  constructor(w = 320, h = 240, scale = 1) {
    this.scale = scale; this.w = w * scale; this.h = h * scale;
    w = this.w; h = this.h;
    this._scaled = new WeakMap(); this._depths = new WeakMap();
    this.px = new Uint8ClampedArray(w * h * 4);
    for (let i = 3; i < this.px.length; i += 4) this.px[i] = 255;
    this.depth = null;                          // Float32Array (m) or null
  }
  fill(r, g, b) {
    const p = this.px;
    for (let i = 0; i < p.length; i += 4) { p[i] = r & 0xF8; p[i + 1] = g & 0xF8; p[i + 2] = b & 0xF8; p[i + 3] = 255; }
  }
  blit(src) {
    if (src.length === this.px.length) { this.px.set(src); return; }
    let out = this._scaled.get(src);
    if (!out) {
      out = new Uint8ClampedArray(this.px.length);
      const sw = this.w / this.scale, sh = this.h / this.scale;
      // Bilinear colour sampling; depth is scaled separately with nearest sampling.
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        const sx = Math.max(0, Math.min(sw - 1, (x + .5) / this.scale - .5));
        const sy = Math.max(0, Math.min(sh - 1, (y + .5) / this.scale - .5));
        const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
        for (let c = 0; c < 4; c++) {
          const a = src[(iy * sw + ix) * 4 + c], b = src[(iy * sw + Math.min(sw-1,ix+1)) * 4 + c];
          const d = src[(Math.min(sh-1,iy+1) * sw + ix) * 4 + c], e = src[(Math.min(sh-1,iy+1) * sw + Math.min(sw-1,ix+1)) * 4 + c];
          out[(y*this.w+x)*4+c] = (a*(1-fx)+b*fx)*(1-fy)+(d*(1-fx)+e*fx)*fy;
        }
      }
      this._scaled.set(src, out);
    }
    this.px.set(out);
  }
  sceneDepth(src) {
    if (!src || this.scale === 1) { this.depth = src; return; }
    let out = this._depths.get(src);
    if (!out) {
      out = new Float32Array(this.w*this.h);
      const sw = this.w / this.scale;
      for (let y=0;y<this.h;y++) for(let x=0;x<this.w;x++) out[y*this.w+x]=src[Math.floor(y/this.scale)*sw+Math.floor(x/this.scale)];
      this._depths.set(src,out);
    }
    this.depth = out;
  }
}

export class Camera {
  constructor(w2c, focal, w = 320, h = 240) { this.m = w2c; this.f = focal; this.w = w; this.h = h; }
  static fromMeta(meta) { return new Camera(meta.world_to_camera.flat(), meta.focal_px); }
  static lookAt(eye, target, focal, w = 320, h = 240) {
    let f = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
    let l = Math.hypot(...f); f = f.map(v => v / l);
    let r = [f[1], -f[0], 0]; l = Math.hypot(...r) || 1; r = r.map(v => v / l);
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const R = [r, u, [-f[0], -f[1], -f[2]]];
    const m = [];
    for (let i = 0; i < 3; i++) m.push(R[i][0], R[i][1], R[i][2], -(R[i][0] * eye[0] + R[i][1] * eye[1] + R[i][2] * eye[2]));
    m.push(0, 0, 0, 1);
    return new Camera(m, focal, w, h);
  }
  // project a world point (m) -> [sx, sy, depth] or null
  project(x, y, z) {
    const m = this.m;
    const cx = m[0] * x + m[1] * y + m[2] * z + m[3];
    const cy = m[4] * x + m[5] * y + m[6] * z + m[7];
    const cz = -(m[8] * x + m[9] * y + m[10] * z + m[11]);
    if (cz < 0.05) return null;
    return [this.w / 2 + this.f * cx / cz, this.h / 2 - this.f * cy / cz, cz];
  }
}

// ---------------------------------------------------------------- lighting
export class Lights {
  // dirs: world vectors FROM light TOWARD the scene; colours 0..~1.3; ambient 0..1
  constructor(dirs, colors, ambient) {
    this.dirs = dirs.map(d => { const l = Math.hypot(...d) || 1; return d.map(v => v / l); });
    this.colors = colors; this.ambient = ambient;
  }
  static toward(pairs, ambient) {
    return new Lights(pairs.map(p => [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]]), pairs.map(p => p[2]), ambient);
  }
}

// ---------------------------------------------------------------- drawing
function drawTri(fb, x0, y0, x1, y1, x2, y2, u0, v0, u1, v1, u2, v2, c0, c1, c2, z0, z1, z2, tex, texW, texH, clut, tint) {
  let area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  if (area === 0) return;
  const W = fb.w, H = fb.h;
  let minx = Math.max(Math.min(x0, x1, x2), 0), maxx = Math.min(Math.max(x0, x1, x2), W - 1);
  let miny = Math.max(Math.min(y0, y1, y2), 0), maxy = Math.min(Math.max(y0, y1, y2), H - 1);
  if (minx > maxx || miny > maxy) return;
  const sgn = area < 0 ? -1 : 1;
  area *= sgn;
  const inv = 1 / area;
  // edge function increments
  const A0 = (y1 - y2) * sgn, B0 = (x2 - x1) * sgn;
  const A1 = (y2 - y0) * sgn, B1 = (x0 - x2) * sgn;
  const A2 = (y0 - y1) * sgn, B2 = (x1 - x0) * sgn;
  const e0 = ((x2 - x1) * (miny - y1) - (y2 - y1) * (minx - x1)) * sgn;
  const e1 = ((x0 - x2) * (miny - y2) - (y0 - y2) * (minx - x2)) * sgn;
  const e2 = ((x1 - x0) * (miny - y0) - (y1 - y0) * (minx - x0)) * sgn;
  const px = fb.px, dep = fb.depth, zbuf = fb.zbuf;
  const tr = tint[0], tg = tint[1], tb = tint[2];
  let r0 = e0, r1 = e1, r2 = e2;
  for (let y = miny; y <= maxy; y++) {
    let w0 = r0, w1 = r1, w2 = r2;
    const drow = (y & 3) * 4;
    for (let x = minx; x <= maxx; x++) {
      if ((w0 | w1 | w2) >= 0) {
        const b0 = w0 * inv, b1 = w1 * inv, b2 = w2 * inv;
        const idx = y * W + x;
        const iz = b0 / z0 + b1 / z1 + b2 / z2, z = 1 / iz;
        if ((!dep || z < dep[idx] + 0.02) && (!zbuf || z <= zbuf[idx] + 0.0001)) {
          // Enhanced mode fixes affine texture warping; classic retains its PS1 look.
          const perspective = fb.scale > 1;
          let u = (perspective ? (b0*u0/z0+b1*u1/z1+b2*u2/z2)/iz : b0*u0+b1*u1+b2*u2) | 0;
          let v = (perspective ? (b0*v0/z0+b1*v1/z1+b2*v2/z2)/iz : b0*v0+b1*v1+b2*v2) | 0;
          if (u < 0) u = 0; else if (u >= texW) u = texW - 1;
          if (v < 0) v = 0; else if (v >= texH) v = texH - 1;
          const ci = tex[v * texW + u] * 3;
          const tr8 = clut[ci], tg8 = clut[ci + 1], tb8 = clut[ci + 2];
          if (tr8 + tg8 + tb8 > 0) {                          // 0x0000 = transparent
            if (zbuf) zbuf[idx] = z;
            const d = fb.scale > 1 ? 0 : DITHER[drow + (x & 3)];
            let r = (tr8 * (b0 * c0[0] + b1 * c1[0] + b2 * c2[0]) * tr) / 128 + d;
            let g = (tg8 * (b0 * c0[1] + b1 * c1[1] + b2 * c2[1]) * tg) / 128 + d;
            let b = (tb8 * (b0 * c0[2] + b1 * c1[2] + b2 * c2[2]) * tb) / 128 + d;
            const o = idx * 4;
            px[o] = (r > 255 ? 255 : r < 0 ? 0 : r) & (fb.scale > 1 ? 0xFF : 0xF8);
            px[o + 1] = (g > 255 ? 255 : g < 0 ? 0 : g) & (fb.scale > 1 ? 0xFF : 0xF8);
            px[o + 2] = (b > 255 ? 255 : b < 0 ? 0 : b) & (fb.scale > 1 ? 0xFF : 0xF8);
          }
        }
      }
      w0 += A0; w1 += A1; w2 += A2;
    }
    r0 += B0; r1 += B1; r2 += B2;
  }
}

// instances: [{model, x, y, z, yaw(deg), pose, hide:Set, lights, scale, tint:[r,g,b]}]
export function render(fb, cam, instances, lights, otBits = 12) {
  fb.zbuf ||= new Float32Array(fb.w * fb.h);
  fb.zbuf.fill(Infinity);
  const focal = cam.f * fb.scale;
  const OT = 1 << otBits;
  const ot = new Array(OT);
  const W = fb.w, H = fb.h, hx = W >> 1, hy = H >> 1;
  for (const inst of instances) {
    const m = inst.model;
    const s = (inst.scale || 1) * 0.001;
    const Ry = rotXYZ(0, inst.roll || 0, inst.yaw || 0);            // roll: about the model's length (a wreck on its side)
    const world = mat4(Ry.map(v => v * s), [inst.x, inst.y, inst.z]);
    const mats = partMatrices(m, inst.pose || {});
    const L = inst.lights || lights;
    const tint = inst.tint || [1, 1, 1];
    for (let pi = 0; pi < m.parts.length; pi++) {
      const part = m.parts[pi];
      if (part.nv === 0 || (inst.hide && inst.hide.has(part.name))) continue;
      const ptint = (inst.partTint && inst.partTint[part.name]) || tint;     // e.g. Bryan's infected arm
      const M = mul4(cam.m, mul4(world, mats[pi]));
      // GTE: 4.12 rotation, integer mm translation, PS1 axes (y down, z forward)
      const R = [M[0], M[1], M[2], -M[4], -M[5], -M[6], -M[8], -M[9], -M[10]].map(v => Math.round(v * 1000 * 4096));
      const T = [Math.round(M[3] * 1000), Math.round(-M[7] * 1000), Math.round(-M[11] * 1000)];
      const n = part.nv, V = part.verts, N = part.normals;
      const sx = new Int32Array(n), sy = new Int32Array(n), Z = new Int32Array(n), zm = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const vx = V[i * 3], vy = V[i * 3 + 1], vz = V[i * 3 + 2];
        const X = Math.floor((R[0] * vx + R[1] * vy + R[2] * vz) / 4096) + T[0];
        const Y = Math.floor((R[3] * vx + R[4] * vy + R[5] * vz) / 4096) + T[1];
        const Zc = Math.floor((R[6] * vx + R[7] * vy + R[8] * vz) / 4096) + T[2];
        const zs = Zc > 1 ? Zc : 1;
        sx[i] = hx + Math.floor(focal * X / zs);                 // integer divide -> snapped vertices
        sy[i] = hy + Math.floor(focal * Y / zs);
        Z[i] = Zc; zm[i] = Zc / 1000;
      }
      // lighting in world space
      const wr = mul4(world, mats[pi]);
      const k = 1 / s;
      const nr = [wr[0] * k, wr[1] * k, wr[2] * k, wr[4] * k, wr[5] * k, wr[6] * k, wr[8] * k, wr[9] * k, wr[10] * k];
      const col = new Array(n);
      for (let i = 0; i < n; i++) {
        const ax = N[i * 3], ay = N[i * 3 + 1], az = N[i * 3 + 2];
        let wx = nr[0] * ax + nr[1] * ay + nr[2] * az, wy = nr[3] * ax + nr[4] * ay + nr[5] * az, wz = nr[6] * ax + nr[7] * ay + nr[8] * az;
        const l = Math.hypot(wx, wy, wz) || 1; wx /= l; wy /= l; wz /= l;
        let r = L.ambient[0], g = L.ambient[1], b = L.ambient[2];
        for (let j = 0; j < L.dirs.length; j++) {
          const d = L.dirs[j];
          const dot = -(wx * d[0] + wy * d[1] + wz * d[2]);
          if (dot > 0) { r += dot * L.colors[j][0]; g += dot * L.colors[j][1]; b += dot * L.colors[j][2]; }
        }
        col[i] = [Math.min(255, Math.floor(r * 128)), Math.min(255, Math.floor(g * 128)), Math.min(255, Math.floor(b * 128))];
      }
      for (const f of part.faces) {
        const vi = f.v;
        let near = false;
        for (const q of vi) if (Z[q] < 100) { near = true; break; }
        if (near) continue;
        const a = vi[0], b = vi[1], c = vi[2];
        const cross = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sy[b] - sy[a]) * (sx[c] - sx[a]);
        if (cross >= 0 && !f.dbl) continue;                      // NCLIP
        let sum = 0;
        for (const q of vi) sum += Z[q];
        const slot = Math.min(Math.max((sum / vi.length) >> 4, 0), OT - 1);   // AVSZ3/4 -> OT
        (ot[slot] || (ot[slot] = [])).push([m, sx, sy, zm, col, f, ptint]);
      }
    }
  }
  for (let s = OT - 1; s >= 0; s--) {
    const list = ot[s];
    if (!list) continue;
    for (const [m, sx, sy, zm, col, f, tint] of list) {
      const vi = f.v, uv = f.uv, clut = m.cluts[f.clut];
      drawTri(fb, sx[vi[0]], sy[vi[0]], sx[vi[1]], sy[vi[1]], sx[vi[2]], sy[vi[2]],
        uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], col[vi[0]], col[vi[1]], col[vi[2]],
        zm[vi[0]], zm[vi[1]], zm[vi[2]], m.tex, m.texW, m.texH, clut, tint);
      if (vi.length === 4) {
        drawTri(fb, sx[vi[0]], sy[vi[0]], sx[vi[2]], sy[vi[2]], sx[vi[3]], sy[vi[3]],
          uv[0], uv[1], uv[4], uv[5], uv[6], uv[7], col[vi[0]], col[vi[2]], col[vi[3]],
          zm[vi[0]], zm[vi[2]], zm[vi[3]], m.tex, m.texW, m.texH, clut, tint);
      }
    }
  }
}

// ---------------------------------------------------------------- moving lights on a plate
// Lights that travel (car headlights) cannot be baked, so they are painted onto the
// plate per frame: every pixel's world position comes back from its depth
// (camera-space z), and a spot or point light brightens it with a range falloff.
export function plateWorld(C) {
  if (C.world) return C.world;
  const m = C.cam.m, f = C.cam.f, D = C.depth, W = new Float32Array(320 * 240 * 3);
  for (let y = 0; y < 240; y++) for (let x = 0; x < 320; x++) {
    const i = y * 320 + x, d = D[i];
    const qx = (x - 160) * d / f - m[3], qy = -(y - 120) * d / f - m[7], qz = -d - m[11];
    W[i * 3] = m[0] * qx + m[4] * qy + m[8] * qz;
    W[i * 3 + 1] = m[1] * qx + m[5] * qy + m[9] * qz;
    W[i * 3 + 2] = m[2] * qx + m[6] * qy + m[10] * qz;
  }
  return (C.world = W);
}
// lamps: [{x, y, z, range, col:[r,g,b], power, dir?:[x,y,z] unit, cone?: half-angle deg}]
export function paintLamps(fb, C, lamps) {
  if (!lamps.length || !C.depth) return;
  const W = plateWorld(C), px = fb.px;
  for (const l of lamps) {
    const r2 = l.range * l.range, spot = !!l.dir;
    const cOut = spot ? Math.cos(l.cone * Math.PI / 180) : 0, cIn = spot ? Math.cos(l.cone * 0.55 * Math.PI / 180) : 0;
    const [cr, cg, cb] = l.col, pw = l.power ?? 1;
    for (let i = 0, n = 320 * 240; i < n; i++) {
      const dx = W[i * 3] - l.x, dy = W[i * 3 + 1] - l.y, dz = W[i * 3 + 2] - l.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) + 1e-6;
      let k = 1 - d / l.range; k *= (spot ? 1 : k) * pw;         // beams throw far; bulbs fall off fast
      if (spot) {
        const c = (dx * l.dir[0] + dy * l.dir[1] + dz * l.dir[2]) / d;
        if (c < cOut) continue;
        if (c < cIn) k *= (c - cOut) / (cIn - cOut);
      }
      // light what is there by its brightness (not per channel: that would blow the plate's
      // colour noise up into confetti), in the lamp's colour, plus a little glow
      const scale = fb.scale || 1;
      for (let sy=0;sy<scale;sy++) for(let sx=0;sx<scale;sx++) {
      const o = ((Math.floor(i / 320) * scale + sy) * fb.w + (i % 320) * scale + sx) * 4, lum = (px[o] * 0.3 + px[o + 1] * 0.55 + px[o + 2] * 0.15) * 2.6 * k + (spot ? 22 : 40) * k;     // beams: less flat glow, or dark asphalt turns brown
      const r = px[o] * (1 + 0.4 * k) + lum * cr, g = px[o + 1] * (1 + 0.4 * k) + lum * cg, b = px[o + 2] * (1 + 0.4 * k) + lum * cb;
      px[o] = (r > 255 ? 255 : r) & 0xF8; px[o + 1] = (g > 255 ? 255 : g) & 0xF8; px[o + 2] = (b > 255 ? 255 : b) & 0xF8;
      }
    }
  }
}

// world position of a local point on a posed part (for muzzles, hit sparks)
export function partPoint(inst, partName, local) {
  const m = inst.model;
  const pi = m.index[partName];
  const mats = partMatrices(m, inst.pose || {});
  const s = (inst.scale || 1) * 0.001;
  const world = mat4(rotXYZ(0, inst.roll || 0, inst.yaw || 0).map(v => v * s), [inst.x, inst.y, inst.z]);
  const M = mul4(world, mats[pi]);
  return xform(M, local[0], local[1], local[2]);
}

// ---------------------------------------------------------------- 2D helpers
export function blitSprite(fb, spr, x0, y0) {           // spr: {w,h,px(RGBA)}; alpha test
  const W = fb.w, H = fb.h, p = fb.px, s = spr.px, scale = spr.hd ? 1 : fb.scale;     // an HD sprite is already at the frame's resolution
  x0 = Math.round(x0 * fb.scale); y0 = Math.round(y0 * fb.scale);
  for (let y = 0; y < spr.h * scale; y++) {
    const yy = y0 + y;
    if (yy < 0 || yy >= H) continue;
    for (let x = 0; x < spr.w * scale; x++) {
      const xx = x0 + x;
      if (xx < 0 || xx >= W) continue;
      const si = (Math.floor(y / scale) * spr.w + Math.floor(x / scale)) * 4;
      if (s[si + 3] < 128) continue;
      const di = (yy * W + xx) * 4;
      p[di] = s[si]; p[di + 1] = s[si + 1]; p[di + 2] = s[si + 2];
    }
  }
}

export function rect(fb, x0, y0, w, h, r, g, b, a = 1) {
  const W = fb.w, H = fb.h, p = fb.px;
  x0 = Math.round(x0 * fb.scale); y0 = Math.round(y0 * fb.scale);
  w = Math.round(w * fb.scale); h = Math.round(h * fb.scale);
  for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) {
      const i = (y * W + x) * 4;
      if (a >= 1) { p[i] = r; p[i + 1] = g; p[i + 2] = b; }
      else { p[i] = p[i] * (1 - a) + r * a; p[i + 1] = p[i + 1] * (1 - a) + g * a; p[i + 2] = p[i + 2] * (1 - a) + b * a; }
    }
  }
}

export function darken(fb, k) {
  const p = fb.px;
  for (let i = 0; i < p.length; i += 4) { p[i] *= k; p[i + 1] *= k; p[i + 2] *= k; }
}

export function tintScreen(fb, r, g, b, a) {
  const p = fb.px;
  for (let i = 0; i < p.length; i += 4) {
    p[i] = p[i] * (1 - a) + r * a; p[i + 1] = p[i + 1] * (1 - a) + g * a; p[i + 2] = p[i + 2] * (1 - a) + b * a;
  }
}

// ---------------------------------------------------------------- bitmap font
export class Font {
  constructor(img, meta) {                    // img: {w,h,px} greyscale-ish RGBA
    this.img = img; this.meta = meta;
  }
  width(str) {
    let w = 0;
    for (const ch of str) w += (this.meta.widths[ch.charCodeAt(0) - 32] || 5) + 1;
    return w;
  }
  draw(fb, str, x, y, color = [240, 240, 232], scale = 1, shadow = true) {
    if (shadow) this._draw(fb, str, x + scale, y + scale, [0, 0, 0], scale);
    this._draw(fb, str, x, y, color, scale);
  }
  _draw(fb, str, x0, y0, color, scale) {
    const { cw, ch, widths } = this.meta;
    x0 = Math.round(x0 * fb.scale); y0 = Math.round(y0 * fb.scale); scale *= fb.scale;
    let x = x0;
    for (const c of str) {
      const k = c.charCodeAt(0) - 32;
      if (k < 0 || k >= 95) { x += 5 * scale; continue; }
      const gx = (k % 16) * cw, gy = Math.floor(k / 16) * ch;
      for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) {
        if (this.img.px[((gy + yy) * this.img.w + gx + xx) * 4] < 128) continue;
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
          const px = x + xx * scale + sx, py = y0 + yy * scale + sy;
          if (px < 0 || py < 0 || px >= fb.w || py >= fb.h) continue;
          const i = (py * fb.w + px) * 4;
          fb.px[i] = color[0]; fb.px[i + 1] = color[1]; fb.px[i + 2] = color[2];
        }
      }
      x += ((widths[k] || 5) + 1) * scale;
    }
  }
}

// Affine plate animation for a detached set piece. Inverse sampling leaves no
// holes as the span rotates and accelerates downwards in either resolution.
export function fallingSprite(fb,spr,x,y,t) {
  const angle=t*t*.65,c=Math.cos(angle),s=Math.sin(angle),scale=fb.scale;
  const cx=x+spr.w/2,cy=y+spr.h/2+170*t*t;
  const radius=Math.hypot(spr.w,spr.h)/2;
  const x0=Math.max(0,Math.floor((cx-radius)*scale)),x1=Math.min(fb.w,Math.ceil((cx+radius)*scale));
  const y0=Math.max(0,Math.floor((cy-radius)*scale)),y1=Math.min(fb.h,Math.ceil((cy+radius)*scale));
  for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++){
    const dx=(xx+.5)/scale-cx,dy=(yy+.5)/scale-cy;
    const sx=Math.floor(c*dx+s*dy+spr.w/2),sy=Math.floor(-s*dx+c*dy+spr.h/2);
    if(sx<0||sy<0||sx>=spr.w||sy>=spr.h)continue;
    const si=(sy*spr.w+sx)*4;if(spr.px[si+3]<128)continue;
    const di=(yy*fb.w+xx)*4;fb.px[di]=spr.px[si];fb.px[di+1]=spr.px[si+1];fb.px[di+2]=spr.px[si+2];
  }
}
