// Difficulty modes, modern controls, the RE2-style map and Enhanced HD plates.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assets} from './platform.js';
import {Game} from '../engine/game.js';
import {GameState,Saves,DIFFICULTY} from '../engine/state.js';
const A=await assets();
Saves.store={getItem:()=>null,setItem:()=>{}};
async function scene(id,at=[0,0],difficulty='standard') {
 const g=new Game(A,{headless:true});g.state=new GameState({room:id,location:A.content.world.rooms[id].location,at});g.state.difficulty=difficulty;
 await g.enterRoom(id,...at,0);g.script.running=[];g.ui.msg=null;g.ui.messageQueue=[];g.cinematic=false;g.mode='play';return g;
}
test('new game offers ASSISTED / STANDARD / HARDCORE and records the choice',async()=>{
 const g=new Game(A,{headless:true});await g.init();g.mode='title';g.sel=g.titleOptions().indexOf('NEW GAME');
 g.update({confirmPressed:true});assert.equal(g.mode,'difficulty');assert.equal(g.diffSel,1);
 g.update({downPressed:true});g.t=1;g.update({confirmPressed:true});assert.equal(g.pendingDifficulty,'hardcore');assert.equal(g.mode,'intro');
});
test('enemy damage scales with the mode; scripted story damage does not',async()=>{
 for(const [mode,k] of [['assisted',.6],['standard',1],['hardcore',1.4]]){
  const g=await scene('road_main',[0,0],mode);g.state.hp=100;g.player.invulnT=0;g.player.hurt(20);assert.equal(g.state.hp,100-Math.round(20*k),mode);
  g.player.invulnT=0;g.player.hurt(10,{scripted:true});assert.equal(g.state.hp,100-Math.round(20*k)-10,mode+' scripted');
 }
});
test('assisted recovers health up to CAUTION when left alone, never beyond',async()=>{
 const g=await scene('road_main',[0,0],'assisted');g.state.hp=20;g.player.lastHurt=-99;
 for(let i=0;i<30*120;i++)g.update({});assert.ok(g.state.hp>=DIFFICULTY.assisted.regen-0.01&&g.state.hp<=DIFFICULTY.assisted.regen+0.01,String(g.state.hp));
 const s=await scene('road_main',[0,0],'standard');s.state.hp=20;for(let i=0;i<30*20;i++)s.update({});assert.equal(s.state.hp,20);
});
test('ammunition pickups scale with the mode and say the real count',async()=>{
 const g=await scene('road_main',[0,0],'hardcore'),pk={id:'t_ammo',room:'road_main',at:[0,0],r:1,item:'handgun_ammo',count:10,taken:['Took 10 HANDGUN BULLETS.','A box, half empty.']};
 g.location.pickups.push(pk);g.takePickup?g.takePickup(pk):g.interact?.(pk);
 if(g.ui.msg?.choice!==undefined){g.ui.msg.shown=1e9;g.update({confirmPressed:true});}
 for(let i=0;i<120&&!g.state.taken.t_ammo;i++)g.update({});
 assert.equal(g.state.count('handgun_ammo'),7);assert.ok(/x7/.test(JSON.stringify(g.ui.msg?.lines||g.ui.messageQueue)),JSON.stringify(g.ui.msg?.lines));
 g.location.pickups.pop();
});
test('assisted saves at typewriters without ink ribbons',async()=>{
 const g=await scene('farm_den',[91.5,19],'assisted');g.state.inventory=g.state.inventory.filter(i=>i.id!=='ink_ribbon');
 const t=g.location.typewriters.find(t=>t.room==='farm_den');g.player.x=t.at[0]-0.5;g.player.y=t.at[1];
 assert.ok(g.saveTo(0));assert.equal(g.state.saves,1);
});
test('modern controls walk toward screen-right, relative to the camera held at the press',async()=>{
 const g=await scene('road_main',[-3.4,-3.0]);g.modernControls=true;const C=g.room.cameras[g.cam].cam.m,r=[C[0],C[1]];
 const x0=g.player.x,y0=g.player.y;for(let i=0;i<45;i++)g.update({right:true});
 const dx=g.player.x-x0,dy=g.player.y-y0,along=(dx*r[0]+dy*r[1])/Math.hypot(...r);assert.ok(along>0.6,`moved ${dx.toFixed(2)},${dy.toFixed(2)}`);
});
test('every scene camera has an Enhanced 640x480 plate',async()=>{
 let n=0;for(const id of Object.keys(A.content.world.rooms)){const r=JSON.parse(fs.readFileSync(new URL(`../data/rooms/${id}.json`,import.meta.url)));for(const c of r.cameras){assert.ok(c.plate_hd,`${c.id} has no HD plate`);assert.ok(fs.existsSync(new URL(`../data/bg/${c.plate_hd}`,import.meta.url)),c.plate_hd);n++;}}
 assert.ok(n>=190);
});
test('finishing the game unlocks infinite ammo for the next new game',async()=>{
 const mem={};const old=Saves.store;Saves.store={getItem:k=>mem[k]??null,setItem:(k,v)=>{mem[k]=v;}};
 try{
  const g=new Game(A,{headless:true});await g.init();assert.equal(g.bonusUnlocked(),false);
  g.chapterEnd({final:true,text:['x']});assert.equal(g.bonusUnlocked(),true);
  g.mode='difficulty';g.diffSel=1;g.t=1;g.update({rightPressed:true});assert.equal(g.infiniteAmmo,true);
  g.pendingDifficulty='standard';await g.newGame();assert.equal(g.state.infiniteAmmo,true);
  const w=A.content.items.pistol.weapon;g.state.add('pistol',1,A.content.items,8);g.state.equipped='pistol';g.state.mag.pistol=5;g.player.cool=0;g.player.fire(w);assert.equal(g.state.mag.pistol,5);
 }finally{Saves.store=old;}
});
