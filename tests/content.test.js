import test from 'node:test';
import assert from 'node:assert/strict';
import { assets, platform } from './platform.js';
import { Assets } from '../engine/assets.js';
const A=await assets();

test('every model has valid palettes, texture indices, topology and named item/actor references',()=>{
 for(const [name,m] of Object.entries(A.models)) {
  assert.equal(m.tex.length,m.texW*m.texH,name);
  for(let i=0;i<m.parts.length;i++){
   const p=m.parts[i];assert.ok(p.parent<i,`${name}/${p.name}: cyclic parent`);
   assert.equal(p.normals.length,p.verts.length,`${name}/${p.name}: normals`);
   for(const f of p.faces){assert.ok(m.cluts[f.clut],`${name}: palette`);assert.ok(f.v.length===3||f.v.length===4);assert.equal(f.uv.length,f.v.length*2);assert.ok(f.v.every(v=>v>=0&&v<p.nv),`${name}: vertex`);}
  }
  for(const c of m.cluts)assert.ok([...m.tex].every(i=>i*3+2<c.length),`${name}: invalid texel`);
 }
 for(const [id,d]of Object.entries(A.content.items))assert.ok(A.models[d.model],id);
 for(const [id,d]of Object.entries(A.content.actors))assert.ok(A.models[d.model],id);
});
// Enhanced plates may be JPEG (decoded by the browser); Node reads the size from the frame header
function jpegSize(b){for(let i=2;i<b.length;){if(b[i]!==0xFF){i++;continue;}const m=b[i+1],len=(b[i+2]<<8)|b[i+3];if(m>=0xC0&&m<=0xCF&&m!==0xC4&&m!==0xC8&&m!==0xCC)return[(b[i+7]<<8)|b[i+8],(b[i+5]<<8)|b[i+6]];i+=2+len;}return[0,0];}
test('all scene plates and depth maps decode and match their camera dimensions',async()=>{
 const visual=new Assets({...platform,headless:false});
 let cameras=0;
 for(const id of Object.keys(A.content.world.rooms)){
  const r=await visual.room(id);
  for(const c of r.cameras){cameras++;assert.equal(c.plate.w,320,c.id);assert.equal(c.plate.h,240,c.id);assert.equal(c.depth.length,320*240,c.id);if(c.plateHDFile){const [w,h]=c.plateHD?[c.plateHD.w,c.plateHD.h]:jpegSize(await platform.bytes('bg/'+c.plateHDFile));assert.equal(w,640,c.id);assert.equal(h,480,c.id);}assert.ok(c.depth.every(Number.isFinite),c.id);}
 }
 assert.equal(cameras,196);
});
test('every walkable sample has an in-frame camera and all destinations exist',async()=>{
 for(const id of Object.keys(A.content.world.rooms)){
  const R=await A.room(id);
  for(let j=0;j<R.ny;j+=5)for(let i=0;i<R.nx;i+=5){
   const k=j*R.nx+i;if(!R.walkA[k])continue;
   const c=R.cameras[R.best[k]];assert.ok(c,`${id}: camera missing`);
   const p=c.cam.project(R.x0+(i+.5)*R.res,R.y0+(j+.5)*R.res,R.h[k]/100+1);
   assert.ok(p&&p[0]>=0&&p[0]<=320&&p[1]>=0&&p[1]<=240,`${id}: player offscreen`);
  }
 }
 for(const id of Object.keys(A.content.world.locations)){
  const L=await A.location(id);for(const d of L.doors||[])for(const s of[d.a,d.b]){
   assert.ok(A.content.world.rooms[s.room],`${id}/${d.id}`);
   const R=await A.room(s.room),p=R.nearestWalkable(...s.spawn,4,.23);assert.ok(R.canStand(...p,.23),`${id}/${d.id}: blocked spawn`);
  }
 }
});
test('script sequence names, pickup items, conditional items, and transition chapters resolve',async()=>{
 for(const id of Object.keys(A.content.world.locations)){
  const L=await A.location(id);
  for(const p of L.pickups||[])assert.ok(A.content.items[p.item],`${id}/${p.id}`);
  function visit(x){
   if(Array.isArray(x)){x.forEach(visit);return}if(!x||typeof x!=='object')return;
   if(typeof x.run==='string')assert.ok(L.sequences[x.run],`${id}: sequence ${x.run}`);
   if(x.chapter_end?.next)assert.ok(A.content.world.locations[x.chapter_end.next],`${id}: chapter ${x.chapter_end.next}`);
   if(x.goto_room)assert.ok(A.content.world.rooms[x.goto_room.room],`${id}: goto ${x.goto_room.room}`);
   if(x.give)assert.ok(A.content.items[x.give[0]],`${id}: give ${x.give[0]}`);
   if(x.use?.item)assert.ok(A.content.items[x.use.item],`${id}: use ${x.use.item}`);
   Object.values(x).forEach(visit);
  }visit(L);
 }
});
test('different camera transforms never share a background asset filename',async()=>{
 const seen=new Map();
 for(const id of Object.keys(A.content.world.rooms)){
  const data=await platform.json('rooms/'+id+'.json');
  for(const c of data.cameras){const transform=JSON.stringify(c.world_to_camera);assert.ok(!seen.has(c.id)||seen.get(c.id)===transform,`${c.id}: incompatible cameras overwrite the same plate`);seen.set(c.id,transform);}
 }
});
