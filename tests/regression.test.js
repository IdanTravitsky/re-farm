import test from 'node:test';
import assert from 'node:assert/strict';
import { assets, platform } from './platform.js';
import { Assets } from '../engine/assets.js';
import { Game } from '../engine/game.js';
import { GameState, Saves } from '../engine/state.js';
import { Enemy, angDiff } from '../engine/actors.js';
import { Input } from '../engine/input.js';
import { Frame, rect, Font } from '../engine/psx.js';
import { Room } from '../engine/room.js';
const A = await assets();
const memory = () => { const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)}; };
async function game(room='city_street',at=[-25,-1.3]) {
 Saves.store=memory();
 const g=new Game(A,{headless:true});
 g.state=new GameState({room,location:A.content.world.rooms[room].location,at});
 await g.enterRoom(room,...at,0);g.script.running=[];g.ui.msg=null;g.cinematic=false;g.mode='play';return g;
}
function settle(g,limit=1800) {
 for(let i=0;i<limit;i++) {
  if(g.ui.msg)g.update({confirmPressed:true});
  else if(g.ui.file)g.update({cancelPressed:true});
  else g.update({});
  if(!g.ui.modal() && !g.script.running.length && g.player.mode!=='pickup')return;
 }
 throw Error('Scene did not settle');
}

test('angle wrapping works after arbitrarily many player rotations',()=>{
 assert.equal(angDiff(0,2160),0);assert.equal(angDiff(-1440,10),-10);assert.equal(angDiff(10,-2160),10);
});
test('bolt cutters are offered from the city item-box approach; cycling reaches the box',async()=>{
 const g=await game();assert.equal(g.nearest().pk?.id,'bolt_cutters');
 const seen=new Set();for(let i=0;i<g.nearby().length;i++){seen.add(g.nearest().kind);g.cycleInteraction();}
 assert.ok(seen.has('pickup'));assert.ok(seen.has('box'));
 g.interactionKey=null;g.interact();settle(g);assert.ok(g.state.has('bolt_cutters'));assert.ok(g.state.taken.bolt_cutters);
});
test('city key, gate, return event and manhole progress to sewers',async()=>{
 const g=await game();g.god=true;g.state.add('bolt_cutters',1,A.content.items,8);
 g.useAt(g.location.examine.find(x=>x.id==='fence_chain'));settle(g);assert.ok(g.state.flags.fence_cut);
 g.script.running=[];g.ui.msg=null;
 await g.enterRoom('city_court',-6.4,25,0);g.script.running=[];g.ui.msg=null;g.cinematic=false;
 const e=g.enemies.find(e=>e.id==='ct_z1');e.damage(999,true,0);
 const keys=g.location.pickups.find(x=>x.id==='suv_keys');g.interactionKey=g.interactionId({kind:'pickup',pk:keys,at:keys.at});g.interact();settle(g);
 assert.ok(g.state.has('key_suv'));
 await g.enterRoom('city_street',7,0,0);settle(g);assert.ok(g.state.flags.paul_gone);
 g.player.x=-12.5;g.player.y=.6;g.interact();settle(g);assert.equal(g.mode,'chapter');assert.equal(g.chapter.next,'sewers');
});
test('sewer boss transforms once, keeps 140 phase-two HP, and unlocks ladder',async()=>{
 const g=await game('sewer_cistern',[81.5,0]);g.god=true;
 g.script.start(g.location.sequences.boss_intro);settle(g);
 const first=g.enemies.find(e=>e.id==='swollen');first.damage(250,false,0);settle(g);
 const second=g.enemies.find(e=>e.id==='swollen_burst');assert.ok(second);assert.equal(second.hp,140);
 assert.equal(g.enemies.filter(e=>e.type==='rat').length,6);
 second.damage(150,false,0);settle(g);
 g.player.x=101.3;g.player.y=0;assert.equal(g.nearest().ex.id,'ladder_up');
 g.interact();settle(g);assert.equal(g.chapter.next,'hospital_street');
});
test('cutscene damage bypasses combat invulnerability',async()=>{
 const g=await game();g.player.invulnT=10;g.player.hurt(10);assert.equal(g.state.hp,100);
 g.script.start([{damage:7}]);assert.equal(g.state.hp,93);
});
test('multiple hits cannot stun-lock or instantly kill in one frame',async()=>{
 const g=await game();g.player.invulnT=0;g.player.hurt(18);g.player.hurt(18);assert.equal(g.state.hp,82);
 for(let i=0;i<21;i++)g.player.update({});g.player.hurt(18);assert.equal(g.state.hp,64);
});
test('melee and charge damage respect intervening walls',async()=>{
 const g=await game('sewer_cistern',[81.5,0]);g.player.invulnT=0;
 const e=g.enemies.find(e=>e.id==='swollen');e.x=g.player.x+.5;e.y=g.player.y;e.yaw=270;
 const original=g.room.los;g.room.los=()=>false;
 try {e.t=1;e.hitDone=false;e.updateAttack(.5,-.5,0,270);assert.equal(g.state.hp,100);
 e.state='charge';e.t=0;e.hitDone=false;e.update();assert.equal(g.state.hp,100);}finally{g.room.los=original;}
});
test('swept movement cannot tunnel through a thin wall or cut diagonal corners',async()=>{
 const g=await game();const p=g.player;
 g.room={res:.1,walkable:(x,y)=>x<.1 || x>=.2,floor:()=>0};p.x=0;p.y=0;
 p.move(.4,0);assert.ok(p.x<.1);
 g.room.walkable=(x,y)=>(x<.1&&y<.1)||(x>=.1&&y>=.1);p.x=.08;p.y=.08;
 p.move(.06,.06);assert.ok(p.x<.1&&p.y<.1);
});
test('saved enemy wake zones survive leaving and re-entering a room',async()=>{
 const g=await game();const e=g.enemies.find(e=>e.id==='al_z1');const snapshot=e.snapshot();
 const restored=new Enemy(g,{...snapshot,id:e.id});assert.deepEqual(restored.wake,e.wake);
 g.player.x=-4.6;g.player.y=12;restored.update();assert.equal(restored.state,'chase');
});
test('loading and starting over clear cutscenes, hidden actors, UI and stale enemies',async()=>{
 const g=await game();g.ui.openBox();g.fx.fade=1;g.player.hidden=true;g.cinematic=true;g.script.start([{wait:999}]);
 await g.newGame();assert.equal(g.state.location,'road');assert.equal(g.ui.boxUI,null);assert.equal(g.player.hidden,false);assert.equal(g.fx.fade,0);
 assert.equal(g.state.enemies.al_z1,undefined);assert.ok(!g.script.running.some(c=>c.wait===999));
});
test('failed saves keep ink ribbons and save count',async()=>{
 const g=await game();g.state.add('ink_ribbon',2,A.content.items,8);
 Saves.store={getItem:()=>null,setItem:()=>{throw Error('quota')}};
 assert.equal(g.saveTo(0),false);assert.equal(g.state.count('ink_ribbon'),2);assert.equal(g.state.saves,0);
});
test('successful save/load preserves inventory, enemies and exact position',async()=>{
 const g=await game();g.state.add('ink_ribbon',2,A.content.items,8);g.player.yaw=123;
 assert.equal(g.saveTo(0),true);assert.equal(g.state.count('ink_ribbon'),1);
 g.ui.openBox();g.fx.whiteout=10;assert.equal(await g.loadFrom(0),true);
 assert.equal(g.player.yaw,123);assert.equal(g.state.count('ink_ribbon'),1);assert.equal(g.ui.boxUI,null);assert.equal(g.fx.whiteout,0);
});
test('corrupt save structures do not crash title/load menus',()=>{
 for(const value of ['null','{}','[null,{"state":{}}]','broken']){Saves.store={getItem:()=>value};assert.equal(Saves.any(),false);assert.deepEqual(Saves.list(),[null,null,null]);assert.equal(Saves.readCheckpoint(),null);}
});
test('checkpoint precedes chapter entry triggers and can restart the introduction',async()=>{
 const g=await game();g.chapter={next:'sewers'};g.mode='chapter';await g.continueToNext();
 const checkpoint=Saves.readCheckpoint();assert.equal(checkpoint.room,'sewer_tunnel');assert.equal(checkpoint.fired['sewers:down_here'],undefined);
 assert.ok(g.state.fired['sewers:down_here']);await g.loadFrom('checkpoint');assert.ok(g.state.fired['sewers:down_here']);
});
test('scripted rewards are stored instead of lost when inventory is full',async()=>{
 const g=await game();for(const id of Object.keys(A.content.items).filter(id=>!A.content.items[id].held).slice(0,8))g.state.add(id,1,A.content.items,8);
 const id=Object.keys(A.content.items).find(id=>!g.state.has(id)&&!A.content.items[id].held);assert.equal(g.give(id,3),false);assert.ok(g.state.box.some(i=>i.id===id&&i.n===3));
});
test('two green herbs in the same stack can be combined',async()=>{
 const g=await game();g.state.add('herb',2,A.content.items,8);g.ui.combine(0,0);assert.ok(g.state.has('herb_gg'));assert.equal(g.state.has('herb'),false);
});
test('combination cannot overflow slots or consume ingredients on failure',async()=>{
 const g=await game();g.state.add('herb',3,A.content.items,8);
 for(const id of Object.keys(A.content.items).filter(id=>!A.content.items[id].held && !['herb','herb_gg'].includes(id)).slice(0,7))g.state.add(id,1,A.content.items,8);
 g.ui.combine(0,0);assert.equal(g.state.inventory.length,8);assert.equal(g.state.count('herb'),3);assert.equal(g.state.has('herb_gg'),false);
});
test('holding aim acquires a new enemy after the target dies',async()=>{
 const g=await game();g.state.add('pistol2',15,A.content.items,8);g.state.equipped='pistol2';g.player.mode='aim';g.player.target={hostile:()=>false};
 const wanted=g.enemies.find(e=>e.id==='al_z1');g.pickTarget=()=>wanted;g.player.update({aim:true});assert.equal(g.player.target,wanted);
});
test('manual reload moves only available rounds into the magazine',async()=>{
 const g=await game();g.state.add('pistol2',3,A.content.items,8);g.state.add('handgun_ammo',5,A.content.items,8);g.state.equipped='pistol2';
 g.player.update({reloadPressed:true});assert.equal(g.state.mag.pistol2,8);assert.equal(g.state.count('handgun_ammo'),0);
});
test('input blur clears all held and pending keyboard/mouse input',()=>{
 const i=new Input({});i.held.add('KeyZ');i.edge.add('Enter');i.mouseAim=true;i.mouseFire=true;i.reset();const r=i.read();assert.equal(r.aim,false);assert.equal(r.confirmPressed,false);assert.equal(r.firePressed,false);
});
test('failed room fetch can be retried',async()=>{
 let fail=true;const a=new Assets({...platform,json:async p=>{if(fail){fail=false;throw Error('offline')}return platform.json(p)}});
 await assert.rejects(a.room('city_street'));assert.ok(await a.room('city_street'));
});
test('enhanced frame scales colour, depth, rectangles and bitmap text consistently',()=>{
 const f=new Frame(2,2,2);f.blit(Uint8ClampedArray.from([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]));assert.equal(f.px.length,64);assert.equal(f.px[3],255);
 f.sceneDepth(Float32Array.from([1,2,3,4]));assert.deepEqual([...f.depth],[1,1,2,2,1,1,2,2,3,3,4,4,3,3,4,4]);
 rect(f,.5,.5,1,1,10,20,30);assert.equal(f.px[(1*4+1)*4],10);
});
test('manually turning while aiming does not immediately lock back onto the old target',async()=>{
 const g=await game();g.state.add('pistol2',15,A.content.items,8);g.state.equipped='pistol2';g.player.mode='aim';g.pickTarget=()=>g.enemies[0];
 g.player.update({aim:true,left:true});assert.equal(g.player.target,null);
});
test('rendered item icons have opaque pixels and appear when blitted into inventory',async()=>{
 const g=await game();const icon=g.ui.icon('bolt_cutters');assert.ok(icon.px.some((n,i)=>i%4===3&&n===255));
 assert.ok(icon.px.some((n,i)=>i%4!==3&&n>40));
});
test('transformation with a reused ID clears the old death state',async()=>{
 const g=await game();g.state.dead.reborn=true;
 g.spawnEnemy({id:'reborn',type:'civ_hoodie',at:[-4.6,12]});assert.equal(g.state.dead.reborn,undefined);assert.ok(g.enemies.find(e=>e.id==='reborn').alive());
});
test('offscreen enemy spawns retain scripted health and wake conditions',async()=>{
 const g=await game();g.spawnEnemy({id:'test_spawn',type:'civ_hoodie',room:'city_court',at:[-7,25],hp:7,state:'idle',wake_rect:[-8,24,-6,26]});
 await g.enterRoom('city_court',-5,21,0);const e=g.enemies.find(e=>e.id==='test_spawn');assert.equal(e.hp,7);assert.deepEqual(e.wake,[-8,24,-6,26]);
});
