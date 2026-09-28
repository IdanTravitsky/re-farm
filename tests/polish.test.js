import test from 'node:test';
import assert from 'node:assert/strict';
import {assets} from './platform.js';
import {Game} from '../engine/game.js';
import {GameState,Saves} from '../engine/state.js';
import {Frame} from '../engine/psx.js';
import {wrapText} from '../engine/text.js';
const A=await assets();
Saves.store={getItem:()=>null,setItem:()=>{}};
async function scene(id,at=[0,0]) {
 const g=new Game(A,{headless:true});g.state=new GameState({room:id,location:A.content.world.rooms[id].location,at});
 await g.enterRoom(id,...at,0);g.script.running=[];g.ui.msg=null;g.ui.messageQueue=[];g.cinematic=false;g.mode='play';g.god=true;return g;
}
const words=s=>s.replace(/\s+/g,' ').trim();
test('every intro, chapter and file page preserves all text inside its reserved layout',async()=>{
 const g=await scene('road_main');g.fb=new Frame();const ui=g.ui,F=A.font,old=F.draw;let drawn=[];
 F.draw=(fb,text,x,y,col,scale=1)=>{drawn.push({text,x,y,w:F.width(text)*scale,h:F.meta.ch*scale});};
 function bounds(){for(const b of drawn){assert.ok(b.x>=8&&b.x+b.w<=312,JSON.stringify(b));assert.ok(b.y>=0&&b.y+b.h<=234,JSON.stringify(b));}drawn=[];}
 try {
  const intro=ui.introPages();assert.equal(words(intro.flat().join(' ')),words(A.content.game.intro.join(' ')));
  for(let p=0;p<intro.length;p++){g.introPage=p;g.introReveal=true;ui.drawIntro(50);bounds();assert.ok(intro[p].length<=12);}
  for(const id of Object.keys(A.content.world.locations)){
   const loc=await A.location(id);const walk=obj=>{if(!obj||typeof obj!=='object')return;for(const[k,v]of Object.entries(obj)){if(k==='chapter_end'){
    const ch={...v,hasNext:!!v.next};const pages=ui.chapterPages(ch);assert.equal(words(pages.flat().join(' ')),words(ch.text.join(' ')));
    for(let p=0;p<pages.length;p++){ch.page=p;ui.drawChapter(ch,50);bounds();assert.ok(pages[p].length<=8);}
   }else walk(v);}};walk(loc);
  }
  for(const[id,doc]of Object.entries(A.content.files)){const pages=ui.filePages(id);assert.equal(words(pages.flat().join(' ')),words(doc.pages.flat().join(' ')));for(let p=0;p<pages.length;p++){ui.readFile(id,p);ui.drawFile();bounds();assert.ok(pages[p].length<=9);}}
 }finally{F.draw=old;}
});
test('long questions paginate before offering a choice, and queued callbacks run once',async()=>{
 const g=await scene('road_main'),ui=g.ui;const events=[],q='A long cutscene sentence about the medical courier and the road ahead. '.repeat(8);
 ui.ask(q,()=>events.push('yes'),()=>events.push('no'));ui.say(['After the answer.'],()=>events.push('after'));
 assert.ok(ui.msg.lines.length>1);assert.equal(words(ui.msg.lines.join(' ')),words(q));
 for(let i=0;i<200&&ui.msg;i++){if(ui.msg.page<ui.msg.lines.length-1)assert.deepEqual(events,[]);ui.updateMsg({confirmPressed:true});}
 assert.deepEqual(events,['yes','after']);assert.equal(ui.msg,null);
 const long='W'.repeat(100);assert.equal(wrapText(long,80,s=>A.font.width(s)).join(''),long);assert.ok(wrapText(long,80,s=>A.font.width(s)).every(s=>A.font.width(s)<=80));
});
test('interior furniture cannot be loaded or walked onto, and wall clearance survives swept movement',async()=>{
 let seed=42;const rand=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
 for(const id of ['farm_house','farm_den','farm_bedroom','trailer_in','trailer_kid']){
  const g=await scene(id),R=g.room,p=g.player;g.enemies=[];g.script.running=[];
  // Old furniture-top samples have a floor above the room's -40m ground plane.
  for(let k=0;k<R.h.length;k++)if(R.h[k]>-3985)assert.equal(R.walkA[k],0,`${id} raised furniture ${k}`);
  const safe=[];for(let k=0;k<R.walkA.length;k++){const pt=[R.x0+(k%R.nx+.5)*R.res,R.y0+(Math.floor(k/R.nx)+.5)*R.res];if(R.canStand(...pt,p.r))safe.push(pt);}
  for(let run=0;run<20;run++){[p.x,p.y]=safe[Math.floor(rand()*safe.length)];p.z=R.floor(p.x,p.y);for(let i=0;i<80;i++){p.move((rand()-.5)*2,(rand()-.5)*2);assert.ok(R.canStand(p.x,p.y,p.r),id);assert.ok(Math.abs(p.z+40)<.09,id);}}
  const bad=R.h.findIndex((h,k)=>h>-3980&&h<0);if(bad>=0){await g.enterRoom(id,R.x0+(bad%R.nx+.5)*R.res,R.y0+(Math.floor(bad/R.nx)+.5)*R.res,0);assert.ok(R.canStand(g.player.x,g.player.y,g.player.r));}
 }
});
test('Wilson and the farm Amalgam stay outside vehicles and their cutscenes finish',async()=>{
 for(const[id,key,actor]of[['road_main','find_her','wilson'],['farm_outside','escape','amalgam']]){
  const g=await scene(id);g.script.start(g.location.sequences[key]);let frames=0,last=null;
  for(;frames<2200;frames++){g.update(g.ui.msg?{confirmPressed:true}:{});const e=g.enemies.find(e=>e.id===actor);if(e){assert.ok(g.room.canStand(e.x,e.y,e.r),`${actor} inside scenery`);assert.equal(g.blocksActor(e,e.x,e.y),false,`${actor} inside vehicle`);last=[e.x,e.y];}if(g.mode==='chapter'||!g.script.running.length&&!g.ui.msg)break;}
  assert.ok(frames<2200);assert.ok(last);if(actor==='amalgam')assert.ok(last[0]>12&&last[1]<4,'Amalgam must actually chase the truck');else assert.ok(g.state.flags.wilson_down);
 }
});
test('city Amalgam emerges on navigable ground and can pursue away from the burning truck',async()=>{
 const g=await scene('city_street',[-10,0]);g.script.start(g.location.sequences.paul_gone);
 for(let i=0;i<600&&g.script.running.length;i++)g.update(g.ui.msg?{confirmPressed:true}:{});
 const e=g.enemies.find(e=>e.id==='amalgam');assert.ok(e);assert.ok(g.room.canStand(e.x,e.y,e.r));const x=e.x;
 for(let i=0;i<300;i++)g.update({});assert.ok(e.x<x-3,`stuck at ${e.x},${e.y}`);
});
test('the tunnel has native enhanced plates, matching depth, and reachable RV/rescue routes',async()=>{
 const g=await scene('trailer_lot',[-6.8,-7.4]),R=g.room;assert.match(R.name,/TUNNEL/);
 for(const c of R.cameras)assert.ok(c.plateHDFile?.endsWith('_hd.png'));
 for(const target of [[4.5,1.1],[8,-8.6],[-12,9.5]])assert.ok(R.path(g.player.x,g.player.y,...target,g.player.r)?.length,`blocked route ${target}`);
 assert.ok(A.models.amalgam.parts.filter(p=>/^mass_\d+$/.test(p.name)).length>=11);
 assert.ok(A.models.amalgam.parts.filter(p=>p.name.endsWith('head')).length>=9);
});
