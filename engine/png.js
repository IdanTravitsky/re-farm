// Minimal PNG decoder (8-bit grey / RGB / RGBA, non-interlaced) so every image
// (plates, sprites, packed level grids) decodes identically in the browser and
// in Node, with no canvas colour management or alpha premultiplication.
// `inflate(bytes) -> Promise<Uint8Array>` is supplied by the platform.

export async function decodePNG(bytes, inflate) {
  if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)) throw new Error('Invalid PNG signature');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8, w = 0, h = 0, depth = 0, ctype = 0;
  const idat = [];
  while (p < bytes.length) {
    if (p + 12 > bytes.length) throw new Error('Truncated PNG chunk');
    const len = dv.getUint32(p), type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    if (p + len + 12 > bytes.length) throw new Error('Truncated PNG data');
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); depth = bytes[p + 16]; ctype = bytes[p + 17]; if (bytes[p + 20]) throw new Error('interlaced PNG'); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error('PNG bit depth ' + depth);
  const ch = { 0: 1, 2: 3, 6: 4, 4: 2 }[ctype];
  if (!ch) throw new Error('PNG colour type ' + ctype);
  let total = 0;
  for (const d of idat) total += d.length;
  const z = new Uint8Array(total);
  let o = 0;
  for (const d of idat) { z.set(d, o); o += d.length; }
  const raw = await inflate(z);
  if (!w || !h || raw.length !== h * (w * ch + 1)) throw new Error('Invalid PNG scanline length');
  const stride = w * ch, out = new Uint8Array(w * h * ch);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    if (f > 4) throw new Error('Invalid PNG filter');
    const row = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? row[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[x] = v;
    }
    prev = row;
  }
  return { w, h, ch, data: out };
}

// -> {w, h, px: RGBA bytes}
export function toRGBA(img) {
  const { w, h, ch, data } = img;
  if (ch === 4) return { w, h, px: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += ch) {
    if (ch === 3) { px[i * 4] = data[j]; px[i * 4 + 1] = data[j + 1]; px[i * 4 + 2] = data[j + 2]; px[i * 4 + 3] = 255; }
    else if (ch === 1) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = data[j]; px[i * 4 + 3] = 255; }
    else { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = data[j]; px[i * 4 + 3] = data[j + 1]; }
  }
  return { w, h, px };
}
