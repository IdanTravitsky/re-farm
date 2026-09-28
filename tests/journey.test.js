// Scripted campaign regression: real interactions and triggers, accelerated combat.
// Positioning is direct; audit.js separately checks walk-grid reachability.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assets } from './platform.js';
import { Game } from '../engine/game.js';
import { Saves } from '../engine/state.js';
import { yawTo } from '../engine/actors.js';

test('campaign progresses from Route Six through all ten chapters to the ending',async()=>{
 const A=await assets();const store=new Map();Saves.store={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
 const g=new Game(A,{headless:true});g.god=true;
 async function settle(){
  for(let i=0;i<9000;i++){
   if(g.mode==='error')throw Error(g.error);
   if(g.mode==='door') await new Promise(resolve=>setTimeout(resolve,1));
   if(g.mode==='chapter')return;
   g.update(g.ui.msg?{confirmPressed:true}:g.ui.file?{cancelPressed:true}:{});
   if(i%60===0)await new Promise(resolve=>setImmediate(resolve));
   if(g.mode==='play'&&!g.ui.modal()&&!g.script.running.length&&g.player.mode!=='pickup')return;
  }
  throw Error(`Hung in ${g.state.room}: ${g.script.running.map(c=>c.label+':'+c.block+':'+c.wait+':'+JSON.stringify(c.actor?.scripted)+':'+[c.actor?.x,c.actor?.y]).join(',')}`);
 }
 async function enter(room,at){
  if(!at){const R=await A.room(room);at=R.nearestWalkable(R.x0+R.nx*R.res/2,R.y0+R.ny*R.res/2,100);}
  await g.enterRoom(room,...at,0);await settle();
 }
 async function act(id){
  const c=g.candidates().find(c=>c.pk?.id===id||c.ex?.id===id||c.door?.id===id);
  assert.ok(c,`${g.state.room}: missing action ${id}`);
  [g.player.x,g.player.y]=g.room.nearestWalkable(...c.at,4,g.player.r);g.player.z=g.room.floor(g.player.x,g.player.y);g.player.yaw=yawTo(g.player.x,g.player.y,...c.at);
  g.interactionKey=g.interactionId(c);assert.equal(g.interactionId(g.nearest()),g.interactionKey,`${id}: unreachable`);
  g.interact();await settle();
 }
 async function kill(id,n=999){const e=g.enemies.find(e=>e.id===id&&e.alive());assert.ok(e,`${id} missing`);e.damage(n,true,0);await settle();}
 const visited=[];
 async function next(expected){assert.equal(g.mode,'chapter',`${g.state.location}: expected chapter end`);assert.equal(g.chapter.next,expected);await g.continueToNext();visited.push(expected);await settle();}
 await g.newGame();visited.push('road');await settle();
 g.player.x=7;g.player.y=16;await settle();assert.ok(g.state.flags.wilson_down);
 await act('wilson_gun');await kill('katie',70);assert.ok(g.state.flags.katie_fled);await act('wagon_leave');await next('farm');
 await enter('farm_house');await act('truck_keys');
 await enter('farm_den');await act('cabinet_key');await enter('farm_house');await act('gun_cabinet');await act('shotgun');
 await enter('farm_bedroom');await kill('katie');await kill('daryl');assert.ok(g.state.flags.threads);await act('gate_key');
 await enter('farm_outside');await act('gate');await act('truck_go');await next('trailer');
 await enter('trailer_in');await enter('trailer_kid');assert.ok(g.state.flags.bitten);assert.equal(g.state.room,'trailer_in');
 await enter('trailer_lot');await kill('lot_z1');await kill('lot_z2');await act('suv');await next('city');
 await act('pistol2');await act('bolt_cutters');await act('fence_chain');await act('fence_gate');await kill('ct_z1');await act('suv_keys');await act('fence_gate');
 g.player.x=7;g.player.y=0;await settle();assert.ok(g.state.flags.paul_gone);await act('manhole_go');await next('sewers');
 await act('valve');await act('valve_spindle');await act('flood_gate');await kill('swollen',250);await kill('swollen_burst');await act('ladder_up');await next('hospital_street');
 await act('ramp_door');await next('garage');
 await act('card');await act('lobby_door');await act('intercom');await act('fire_door');await next('hospital');
 await act('stair_door');await act('fire_key');await act('elev_panel');await act('elev_door');await act('hatch');assert.equal(g.state.room,'hosp_24');
 await act('ward_doors');await act('lab_card');await act('skybridge_go');await next('skybridge');
 await kill('clamp');assert.ok(g.state.flags.bridge_down);await act('door_b_go');await next('lab');
 await act('airlock_in');await act('airlock_in');await act('decon');await act('airlock_out');await act('carl');assert.ok(g.state.flags.monster_bryan);
 await kill('sci1');await kill('sci2');await kill('carl');await act('lab_climb');
 assert.equal(g.chapter.final,true);assert.equal(g.mode,'chapter');assert.equal(g.state.has('package'),false);
 assert.deepEqual(visited,['road','farm','trailer','city','sewers','hospital_street','garage','hospital','skybridge','lab']);
});
