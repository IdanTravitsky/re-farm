// Asset loading with a pluggable platform (browser fetch/createImageBitmap, or
// Node fs for headless playtests). Rooms, plates and models load lazily and are
// cached; the door transition hides the loading, exactly like the originals.
import { Model, Font } from './psx.js';
import { Room } from './room.js';
import { decodePNG, toRGBA } from './png.js';

export const BrowserPlatform = {
  base: 'data/',
  async json(p) { const r = await fetch(this.base + p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); },
  async bytes(p) { const r = await fetch(this.base + p); if (!r.ok) throw new Error(p + ' ' + r.status); return new Uint8Array(await r.arrayBuffer()); },
  async inflate(z) {                                     // zlib stream -> bytes (PNG IDAT)
    const ds = new DecompressionStream('deflate');
    const out = new Response(new Blob([z]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  },
  headless: false,
};

export class Assets {
  constructor(platform = BrowserPlatform) { this.P = platform; this.models = {}; this.rooms = {}; this.locations = {}; this.pending = {}; }

  async png(p) { return decodePNG(await this.P.bytes(p), (z) => this.P.inflate(z)); }
  async image(p) { return toRGBA(await this.png(p)); }

  async boot() {
    const P = this.P;
    this.content = await P.json('content.json');
    this.poses = await P.json('poses.json');
    this.font = new Font(P.headless ? null : await this.image('font.png'), await P.json('font.json'));
    await Promise.all(this.content.models.map(m => this.model(m)));
    return this;
  }
  async model(name) {
    if (!this.models[name]) this.models[name] = new Model(await this.P.json('models/' + name + '.json'));
    return this.models[name];
  }
  async location(id) {
    if (!this.locations[id]) this.locations[id] = await this.P.json('locations/' + id + '.json');
    return this.locations[id];
  }
  // load a room (+ its plates unless headless); concurrent calls share one promise
  room(id) {
    if (this.rooms[id]) return Promise.resolve(this.rooms[id]);
    if (!this.pending[id]) {
      this.pending[id] = (async () => {
        const json = await this.P.json('rooms/' + id + '.json');
        const [grid,body] = await Promise.all([this.png(json.grid.png), json.grid.body_png ? this.png(json.grid.body_png) : null]);
        const room = new Room(json, grid, body);
        if (!this.P.headless) await this.loadPlates(room);
        this.rooms[id] = room;
        delete this.pending[id];
        return room;
      })().catch(error => { delete this.pending[id]; throw error; });
    }
    return this.pending[id];
  }
  async loadPlates(room) {
    await Promise.all(room.cameras.map(async c => {
      c.plate = await this.image('bg/' + c.id + '.png');
      if (c.plateHDFile) c.plateHD = await this.image('bg/' + c.plateHDFile);
      const d = await this.png('bg/' + c.id + '_depth.png');
      c.depth = new Float32Array(d.w * d.h);
      for (let i = 0; i < c.depth.length; i++) c.depth[i] = ((d.data[i * 3] << 8) | d.data[i * 3 + 1]) / 100;
      await Promise.all(c.sprites.map(async s => { s.img = await this.image('bg/' + s.file); }));
    }));
  }
  roomLoaded(id) { return !!this.rooms[id]; }
  prefetch(id) { if (id && !this.rooms[id] && !this.pending[id]) this.room(id).catch(() => {}); }
}
