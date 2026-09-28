import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';
import {assets} from './platform.js';
import {Game} from '../engine/game.js';
import {GameState,Saves} from '../engine/state.js';
import {Frame,paintLamps} from '../engine/psx.js';
import {decodePNG} from '../engine/png.js';
const A=await assets();
async function scene(room,at){
 const g=new Game(A,{headless:true});g.state=new GameState({room,location:A.content.world.rooms[room].location,at});
 const mem=new Map();Saves.store={getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,v)};
 await g.enterRoom(room,...at,0);g.script.running=[];g.ui.msg=null;g.ui.messageQueue=[];g.fx.card=null;g.cinematic=false;g.mode='play';return g;
}
test('the photographed den door blocks the full body under sustained and swept input',async()=>{
 const g=await scene('farm_house',[91.5,4.15]),p=g.player;g.enemies=[];p.yaw=180;
 // Independent scene depth puts the closed door plane at y=4.925.
 for(let i=0;i<600;i++)p.update({up:true,run:true});
 assert.ok(p.y+p.r<4.925,`door penetration ${p.y}`);
 p.move(0,30);assert.ok(p.y+p.r<4.925);
 await g.enterRoom('farm_house',91.5,4.925,180);
 assert.ok(g.player.y+g.player.r<4.925,'old saves inside the door recover to the floor');
});
test('depth-confirmed ground detail is traversable in road, city and sewer scenes',async()=>{
 for(const id of ['road_main','city_street','sewer_tunnel']){
  const g=await scene(id,[0,0]),R=g.room;
  const raw=await decodePNG(new Uint8Array(await readFile(new URL(`../tools/collision_sources/${id}_grid.png`,import.meta.url))),async z=>new Uint8Array(inflateSync(z)));
  let traversed=0;
  for(let k=0;k<R.walkA.length&&traversed<12;k++){
   if(raw.data[k*3]&1||!R.walkA[k])continue;
   const x=R.x0+(k%R.nx+.5)*R.res,y=R.y0+(Math.floor(k/R.nx)+.5)*R.res;
   if(!R.canStand(x,y,.23)||!R.canStand(x+.2,y,.23))continue;
   Object.assign(g.player,{x,y,z:R.floor(x,y)});g.enemies=[];g.player.move(.2,0);
   assert.ok(g.player.x>x+.15);traversed++;
  }
  assert.equal(traversed,12,`${id}: requires actual formerly blocked ground samples`);
 }
});
test('city entry and old saves cannot trap Bryan in the parked SUV',async()=>{
 const g=await scene('city_street',[3.6,-.2]),p=g.player;
 assert.equal(g.blocksActor(p,p.x,p.y),false);
 Object.assign(p,{x:6,y:-1.2,z:0});g.resolveActorPosition(p);
 assert.equal(g.blocksActor(p,p.x,p.y),false);assert.ok(g.room.canStand(p.x,p.y,p.r));
 const before=[p.x,p.y];for(const [dx,dy]of [[.5,0],[-.5,0],[0,.5],[0,-.5]]){p.move(dx,dy);if(Math.hypot(p.x-before[0],p.y-before[1])>.1)break;}assert.ok(Math.hypot(p.x-before[0],p.y-before[1])>.1);
});
test('fallen bridge dynamic boundary also blocks the edge of the actor footprint',async()=>{
 const R=await A.room('bridge');R.blocks=[[10,-20,11,20]];
 assert.equal(R.canStand(9.9,0,.23),false);R.blocks=[];
});
test('moving plate lights affect matching pixels in Classic and Enhanced',()=>{
 const C={depth:new Float32Array(320*240).fill(2),cam:{m:[1,0,0,0,0,1,0,0,0,0,1,0],f:200}};
 const lamps=[{x:0,y:0,z:-2,range:3,col:[1,.7,.3],power:1}];
 const a=new Frame(320,240,1),b=new Frame(320,240,2);a.fill(40,40,40);b.fill(40,40,40);paintLamps(a,C,lamps);paintLamps(b,C,lamps);
 for(const [x,y]of [[0,0],[160,120],[319,239]])for(let sy=0;sy<2;sy++)for(let sx=0;sx<2;sx++){
  const i=(y*320+x)*4,j=((y*2+sy)*640+x*2+sx)*4;assert.deepEqual([...a.px.slice(i,i+3)],[...b.px.slice(j,j+3)]);
 }
});
test('monster finale persists its form and workers and resolves claws on the impact frame',async()=>{
 const g=await scene('lab_main',[49.4,2.2]);g.state.flags.delivered=true;g.startMonster();
 assert.equal(g.player.model,A.models.bryan_mutant);assert.equal(g.cinematic,false);
 await g.loadFrom('checkpoint');g.script.running=[];g.ui.msg=null;g.ui.messageQueue=[];g.cinematic=false;
 assert.equal(g.player.model,A.models.bryan_mutant);assert.equal(g.enemies.filter(e=>e.B==='flee').length,3);
 const e=g.enemies.find(e=>e.id==='sci1'),p=g.player;
 Object.assign(p,{x:49,y:1.5,yaw:90});Object.assign(e,{x:49.8,y:1.5,hp:60});
 p.update({firePressed:true});assert.equal(e.hp,60);
 for(let i=0;i<24;i++)p.update({});assert.ok(g.state.dead.sci1);assert.equal(g.state.mag.pistol,undefined);
});

test('bench gestures continue while dialogue is visible without advancing the story',async()=>{
 const g=await scene('garage_lobby',[62,5.2]);g.script.start(g.location.sequences.message);
 for(let i=0;i<200&&!g.ui.msg;i++)g.update({});
 const e=g.enemies.find(e=>e.id==='bryan_sit');assert.ok(e);assert.equal(e.anim.cur,'record');
 const before=e.anim.t,page=g.ui.msg.page;
 for(let i=0;i<30;i++)g.update({});assert.ok(e.anim.t>before);assert.equal(g.ui.msg.page,page);
});
