import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { Assets } from '../engine/assets.js';
export const root = new URL('../data/', import.meta.url);
export const platform = {
  headless: true,
  json: async p => JSON.parse(await readFile(new URL(p, root), 'utf8')),
  bytes: async p => new Uint8Array(await readFile(new URL(p, root))),
  inflate: async z => new Uint8Array(inflateSync(z)),
};
export const assets = () => new Assets(platform).boot();
