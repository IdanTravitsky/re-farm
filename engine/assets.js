// Asset loading with a pluggable platform (browser fetch/createImageBitmap, or
// Node fs for headless playtests). Rooms, plates and models load lazily and are
// cached; the door transition hides the loading, exactly like the originals.
import { Model, Font } from './psx.js';
import { Room } from './room.js';

export const BrowserPlatform = {
  base: 'data/',
  async json(p) { const r = await fetch(this.base + p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); },
  async bytes(p) { const r = await fetch(this.base + p); if (!r.ok) throw new Error(p + ' ' + r.status); return new Uint8Array(await r.arrayBuffer()); },
  async image(p) {
    const r = await fetch(this.base + p);
    if (!r.ok) throw new Error(p + ' ' + r.status);
    const img = await createImageBitmap(await r.blob());           // decodes even in hidden tabs
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, px: g.getImageData(0, 0, img.width, img.height).data };
  },
  headless: false,
};

export class Assets {
  constructor(platform = BrowserPlatform) { this.P = platform; this.models = {}; this.rooms = {}; this.locations = {}; this.pending = {}; }

  async boot() {
    const P = this.P;
    this.content = await P.json('content.json');
    this.poses = await P.json('poses.json');
    if (!P.headless) this.font = new Font(await P.image('font.png'), await P.json('font.json'));
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
        const room = new Room(await this.P.json('rooms/' + id + '.json'));
        if (!this.P.headless) await this.loadPlates(room);
        this.rooms[id] = room;
        delete this.pending[id];
        return room;
      })();
    }
    return this.pending[id];
  }
  async loadPlates(room) {
    await Promise.all(room.cameras.map(async c => {
      c.plate = await this.P.image('bg/' + c.id + '.png');
      const d16 = await this.P.bytes('bg/' + c.id + '_depth.u16');
      const u = new Uint16Array(d16.buffer, d16.byteOffset, d16.byteLength / 2);
      c.depth = new Float32Array(u.length);
      for (let i = 0; i < u.length; i++) c.depth[i] = u[i] / 100;
      await Promise.all(c.sprites.map(async s => { s.img = await this.P.image('bg/' + s.file); }));
    }));
  }
  roomLoaded(id) { return !!this.rooms[id]; }
  prefetch(id) { if (id && !this.rooms[id] && !this.pending[id]) this.room(id).catch(() => {}); }
}
