// Continuous input-driven QA run. No teleports, god mode, inventory grants,
// direct enemy damage, or direct story-flag edits. Navigation reads the map and
// drives tank controls; pickups, combat, menus and transitions use game input.
import {mkdir,writeFile} from 'node:fs/promises';
import {platform} from './platform.js';
import {Assets} from '../engine/assets.js';
import {Game} from '../engine/game.js';
import {Saves} from '../engine/state.js';
import {yawTo,angDiff} from '../engine/actors.js';
import {Frame} from '../engine/psx.js';
const seed=Number(process.env.PLAYTEST_SEED || 42);let rng=seed>>>0;
Math.random=()=>((rng=(1664525*rng+1013904223)>>>0)/4294967296);
const A=await new Assets({...platform,headless:false}).boot();
const memory=new Map();Saves.store={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};
const g=new Game(A,{headless:true});g.fb=new Frame(320,240,2);
const report={seed,method:'Continuous tank-control inputs, normal health/ammo/combat, normal pickups and transitions',events:[],dialogue:[],rooms:[],inputs:[],frames:0};
await mkdir('tests/artifacts/playthrough',{recursive:true});
let previousMessage='',lastRoom='',shotNumber=0;
function tick(I={}) {
 g.update(I);report.frames++;
 const msg=g.ui.msg?.lines[g.ui.msg.page];if(msg&&msg!==previousMessage){report.dialogue.push({room:g.state.room,text:msg});previousMessage=msg;}
 const key=JSON.stringify(I);const last=report.inputs.at(-1);if(last?.keys===key)last.frames++;else report.inputs.push({keys:key,frames:1});
 if(g.mode==='error')throw Error(g.error);
 if(g.state?.hp<=0)throw Error(`DEATH in ${g.state.room} after ${Math.round(g.state.time)}s; stats ${JSON.stringify(g.state.stats)}`);
}
async function shot(label){
 if(!g.room||g.mode==='door')return;g.drawWorld();g.ui.drawOverlays();
 const name=`${String(shotNumber++).padStart(3,'0')}-${label.replace(/[^a-z0-9_-]/gi,'_')}`;
 await writeFile(`tests/artifacts/playthrough/${name}.rgba`,g.fb.px);
 report.events.push({label,room:g.state.room,pos:[g.player.x,g.player.y],hp:g.state.hp,inventory:g.state.inventory.map(i=>({...i})),stats:{...g.state.stats},image:name});
 console.log(label,g.state.room,'HP',g.state.hp,'pos',g.player.x.toFixed(2),g.player.y.toFixed(2));
}
async function settle(){
 for(let i=0;i<9000;i++){
  if(g.state?.room!==lastRoom){lastRoom=g.state.room;report.rooms.push(lastRoom);await shot('enter-'+lastRoom);}
  if(g.mode==='door'||g.mode==='loading')await new Promise(r=>setTimeout(r,1));
  if(g.mode==='chapter')return;
  if(g.mode==='play'&&!g.ui.modal()&&!g.script.running.length&&!g.cinematic&&g.player.mode!=='pickup')return;
  tick(g.ui.msg?{confirmPressed:true}:g.ui.file?{cancelPressed:true}:{});
  if(i%120===0)await new Promise(r=>setImmediate(r));
 }
 throw Error('Script stuck: '+g.script.running.map(s=>s.label+':'+s.block));
}
async function menuItem(id){
 await settle();const index=g.state.inventory.findIndex(i=>i.id===id);if(index<0)throw Error('Missing inventory item '+id);
 tick({menuPressed:true});for(let i=0;i<8&&g.ui.menu.sel!==index;i++){const sel=g.ui.menu.sel;tick(sel%2!==index%2?{rightPressed:true}:{downPressed:true});}
 tick({confirmPressed:true});tick({confirmPressed:true});tick({cancelPressed:true});await settle();
}
async function heal(){if(g.state.hp>=45)return;const id=['fas','herb_gr','herb_ggg','herb_gg','herb'].find(id=>g.state.has(id));if(id){await menuItem(id);await shot('heal-'+id);}}
function ammo(id){const w=A.content.items[id]?.weapon;return w&&(g.state.mag[id]>0||g.state.has(w.ammo));}
async function arm(prefer){const id=[prefer,'pistol2','pistol','shotgun'].find(id=>id&&g.state.has(id)&&ammo(id));if(!id)throw Error('NO AMMO '+JSON.stringify(g.state.inventory));if(g.state.equipped!==id)await menuItem(id);}
async function fight(id,until=()=>false){
 await arm();let firing=0;
 for(let i=0;i<2500;i++){
  const e=g.enemies.find(e=>e.id===id&&e.alive());if(!e||until())break;
  await heal();if(g.ui.modal()||g.cinematic||g.script.running.length){await settle();continue;}
  if(g.player.mode==='grabbed'){tick({leftPressed:true,rightPressed:true,confirmPressed:true,firePressed:true});continue;}
  if(!ammo(g.state.equipped))await arm();
  const aimed=g.player.target?.alive()?g.player.target:e;
  const d=angDiff(yawTo(g.player.x,g.player.y,aimed.x,aimed.y),g.player.yaw);
  if(Math.abs(d)>15&&!g.player.target)tick(d>0?{left:true}:{right:true});
  else {tick({aim:true,firePressed:Math.abs(d)<18,reloadPressed:!g.state.mag[g.state.equipped]});firing++;}
  if(i===2499)throw Error(`Combat stalled ${id} hp=${e.hp} pos=${e.x},${e.y} player=${g.player.x},${g.player.y}`);
 }
 tick({});await settle();await shot('fight-'+id);
}
function bodyLine(ax,ay,bx,by){const R=g.room,n=Math.max(1,Math.ceil(Math.hypot(bx-ax,by-ay)/.06));for(let i=1;i<=n;i++)if(!R.canStand(ax+(bx-ax)*i/n,ay+(by-ay)*i/n,g.player.r)||g.blocksActor(g.player,ax+(bx-ax)*i/n,ay+(by-ay)*i/n))return false;return true;}
async function walkTo(target,{stop=()=>false,combat=true}={}){
 let path=null,stalled=0,prev=[g.player.x,g.player.y],startRoom=g.state.room;
 for(let frame=0;frame<18000;frame++){
  if(stop()||g.state.room!==startRoom||g.mode==='chapter')return;
  if(g.ui.modal()||g.cinematic||g.script.running.length||g.mode==='door'){const before=[g.player.x,g.player.y];await settle();path=null;if(Math.hypot(g.player.x-before[0],g.player.y-before[1])>2)return;continue;}
  await heal();const p=g.player;
  if(p.mode==='grabbed'){tick({leftPressed:true,rightPressed:true,confirmPressed:true,firePressed:true});continue;}
  const threat=combat&&g.state.equipped&&ammo(g.state.equipped)&&g.enemies.find(e=>e.hostile()&&!e.def.invulnerable&&e.B!=='target'&&e.B!=='hazard'&&Math.hypot(e.x-p.x,e.y-p.y)<4.0&&g.room.shotLos(p.x,p.y,p.z+1.35,e.x,e.y,e.z+e.chest()));
  if(threat){await fight(threat.id);path=null;continue;}
  if(Math.hypot(p.x-target[0],p.y-target[1])<.10)return;
  if(!path?.length){path=g.room.path(p.x,p.y,...target,p.r,(x,y)=>g.blocksActor(p,x,y));if(!path?.length)throw Error(`NO ROUTE ${g.state.room} ${[p.x,p.y]} -> ${target}`);}
  while(path.length>1&&Math.hypot(path[0][0]-p.x,path[0][1]-p.y)<.16)path.shift();
  for(let j=Math.min(path.length-1,20);j>0;j--)if(bodyLine(p.x,p.y,...path[j])){path.splice(0,j);break;}
  const next=path[0],distance=Math.hypot(next[0]-p.x,next[1]-p.y),d=angDiff(yawTo(p.x,p.y,...next),p.yaw);
  tick(Math.abs(d)>7?(d>0?{left:true}:{right:true}):{up:true,run:distance>.25});
  if(Math.hypot(p.x-prev[0],p.y-prev[1])<.002&&Math.abs(d)<=7)stalled++;else stalled=0;prev=[p.x,p.y];
  if(stalled>15){path=null;stalled=0;}
  if(frame%120===0)await new Promise(r=>setImmediate(r));
  if(frame===17999)throw Error(`WALK STALLED ${g.state.room} ${[p.x,p.y]} -> ${target}`);
 }
}
async function act(id,attempt=0){
 await settle();const c=g.candidates().find(c=>[c.pk?.id,c.ex?.id,c.door?.id].includes(id));if(!c)throw Error('Missing action '+id+' in '+g.state.room);
 if(c.pk&&!A.content.items[c.pk.item].held&&!g.state.has(c.pk.item)&&g.state.inventory.length>=g.slots){
  // Manage the same eight slots as a player: consolidate spare rounds first,
  // then use a single carried healing item. Never grant space or delete items.
  for(const it of [...g.state.inventory]){
   const w=A.content.items[it.id]?.weapon;if(!w)continue;
   const reserve=g.state.count(w.ammo),missing=w.mag-(g.state.mag[it.id]||0);
   if(reserve>0&&reserve<=missing){await menuItem(it.id);tick({reloadPressed:true});break;}
  }
  if(g.state.inventory.length>=g.slots){const healItem=g.state.inventory.find(it=>A.content.items[it.id].kind==='heal'&&it.n===1);if(healItem)await menuItem(healItem.id);}
  if(g.state.inventory.length>=g.slots)throw Error('Inventory full: visit an item box before '+id);
 }
 const R=g.room,p=g.player,poss=[];
 for(let k=0;k<R.walkA.length;k++){if(!R.walkA[k])continue;const x=R.x0+(k%R.nx+.5)*R.res,y=R.y0+(Math.floor(k/R.nx)+.5)*R.res,d=Math.hypot(x-c.at[0],y-c.at[1]);if(d<c.r-.16&&R.canStand(x,y,p.r)&&!g.blocksActor(p,x,y))poss.push({at:[x,y],cost:Math.hypot(x-p.x,y-p.y)});}
 poss.sort((a,b)=>a.cost-b.cost);let to;
 for(const q of poss.slice(0,80)){if(R.path(p.x,p.y,...q.at,p.r,(x,y)=>g.blocksActor(p,x,y))){to=q.at;break;}}
 if(!to)throw Error(`ACTION UNREACHABLE ${id} from ${[p.x,p.y]}`);
 await walkTo(to,{combat:!['ladder_up','manhole_go','ramp_door'].includes(id)});await settle();
 for(let i=0;i<60;i++){const d=angDiff(yawTo(p.x,p.y,...c.at),p.yaw);if(Math.abs(d)<10)break;tick(d>0?{left:true}:{right:true});}
 for(let i=0;i<g.nearby().length;i++){if(g.interactionId(g.nearest())===g.interactionId(c))break;tick({cyclePressed:true});}
 if(!g.nearest()||g.interactionId(g.nearest())!==g.interactionId(c))throw Error('Cannot select '+id);
 tick({actionPressed:true});await settle();if(c.pk&&!g.state.taken[c.pk.id]){if(attempt<3){await settle();return act(id,attempt+1);}throw Error('Pickup was not collected: '+id);}   // a hit mid-pickup: try again, like a player would
await shot('action-'+id);
}
async function huntFinale(){
 for(let i=0;i<12000&&!g.state.flags.lab_hunt_complete;i++){
  if(g.ui.modal()||g.script.running.length){await settle();continue;}
  const p=g.player,foes=g.enemies.filter(e=>e.B==='flee'&&e.alive()).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y));
  const e=foes[0];if(!e){tick({});continue;}
  const distance=Math.hypot(e.x-p.x,e.y-p.y),route=g.room.path(p.x,p.y,e.x,e.y,p.r);
  let target=[e.x,e.y];if(distance>1.35&&route?.length){target=route[Math.min(3,route.length-1)];}
  const d=angDiff(yawTo(p.x,p.y,...target),p.yaw);
  tick(Math.abs(d)>10?(d>0?{left:true}:{right:true}):distance<1.4?{firePressed:true}:{up:true,run:true});
  if(i%120===0)await new Promise(r=>setImmediate(r));
 }
 if(!g.state.flags.lab_hunt_complete)throw Error('Monster hunt stalled');await settle();await shot('monster-hunt-complete');
}
async function next(expected){if(g.mode!=='chapter'||g.chapter.next!==expected)throw Error('Expected chapter '+expected);for(let i=0;i<300;i++){tick({confirmPressed:true});if(g.mode!=='chapter')break;}await settle();}
try {
 await g.newGame();await settle();
 await walkTo([7,16],{stop:()=>g.state.flags.wilson_down});await act('wilson_gun');await fight('katie',()=>g.state.flags.katie_fled);await act('wagon_leave');await next('farm');
 await act('barn_door');await act('ammo_barn');await act('barn_door');await act('house_front');await act('truck_keys');await act('herb_living');await act('shells');
 await act('den_door');await act('cabinet_key');await act('den_door');await act('gun_cabinet');await act('shotgun');await arm('shotgun');
 await act('phone');await act('house_stairs');await act('bedroom_door');await fight('katie');await fight('daryl');await act('gate_key');await act('bedroom_door');await act('house_stairs');await act('house_front');await act('gate');await act('truck_go');await next('trailer');
 await act('trailer_door');await act('ammo_trailer');await act('herb_trailer');await act('kid_door');await act('trailer_door');await walkTo([8,-8.6],{combat:false});await act('suv');await next('city');
 await act('pistol2');await arm('pistol2');await act('bolt_cutters');await act('cruiser_shells');await act('alley_ammo');await act('fence_chain');await act('fence_gate');await fight('ct_z1');await act('court_spray');await act('suv_keys');await act('fence_gate');await walkTo([7,0],{combat:false,stop:()=>g.state.flags.paul_gone});await act('manhole_go');await next('sewers');
 await act('tunnel_ammo');await act('tunnel_herb');await act('valve');await act('office_door');await act('ammo_office');await act('herb_office');await act('office_door');await act('valve_spindle');await act('flood_gate');await act('cistern_ammo');await fight('swollen');await fight('swollen_burst');await act('ladder_up');await next('hospital_street');
 await act('police_ammo');await act('swat_shells');await act('ramp_door');await next('garage');
 await act('deck_ammo');await act('deck_shells');await act('card');await act('lobby_door');if(g.state.room==='garage_deck')await act('lobby_door');await act('herb_lobby');await act('intercom');await act('fire_door');await next('hospital');
 await act('stair_door');await act('shells_12');await act('herb_12');await act('fire_key');await act('elev_panel');await act('elev_door');await act('hatch');await act('spray_24');await act('ward_doors');await act('ammo_ward');await act('lab_card');await act('skybridge_go');await next('skybridge');
 await act('bridge_ammo');await walkTo([33.8,-.3],{combat:false});await fight('clamp');await act('door_b_go');await next('lab');
 await act('lab_shells');await act('airlock_in');if(g.state.room==='lab_corr')await act('airlock_in');await act('decon');await act('airlock_out');await act('carl');
 await huntFinale();await act('lab_climb');
 if(!g.chapter?.final)throw Error('Ending not reached');report.complete=true;await shot('ending');
} catch(e){report.failure=String(e);await shot('FAILED');console.error(e);process.exitCode=1;}
report.finalState=g.state?.toJSON();await writeFile('tests/artifacts/playthrough/report.json',JSON.stringify(report,null,2));
