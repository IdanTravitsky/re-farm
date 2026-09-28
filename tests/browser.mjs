const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('tests/artifacts/scenes',{recursive:true});
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:800,height:600}}), errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await page.goto(process.env.GAME_URL || 'http://127.0.0.1:8000');await page.waitForFunction(()=>window.game);
await page.evaluate(async()=>{window.paused=true;await game.newGame();game.god=true});
const rooms=await page.evaluate(()=>Object.keys(game.A.content.world.rooms)),results=[];
for(const room of rooms){
 const r=await page.evaluate(async room=>{
  const g=game;g.script.running=[];g.ui.msg=null;g.ui.messageQueue=[];g.ui.file=null;g.ui.menu=null;g.ui.boxUI=null;g.cinematic=false;g.player.hidden=false;g.player.scripted=null;
  const R=await g.A.room(room),loc=await g.A.location(R.location);
  const point=loc.entry?.room===room?loc.entry.at:(loc.doors||[]).flatMap(d=>[d.a,d.b]).find(s=>s.room===room)?.spawn||R.nearestWalkable(R.x0+R.nx*R.res/2,R.y0+R.ny*R.res/2,100);
  await g.enterRoom(room,...point,0);g.script.running=[];g.ui.msg=null;g.ui.messageQueue=[];g.cinematic=false;g.forcedCamera=null;g.player.hidden=false;g.player.scripted=null;g.fx.card=null;g.fx.fade=0;g.mode='play';g.updateCamera();
  const t=performance.now();window.step({},0);const ms=performance.now()-t;
  // Exercise all plate/depth combinations, including cinematic cameras.
  for(let c=0;c<R.cameras.length;c++){g.cam=c;g.drawWorld();}
  const saved=g.fb, {Frame}=await import(new URL('engine/psx.js',location.href));
  g.fb=new Frame(320,240);for(let c=0;c<R.cameras.length;c++){g.cam=c;g.drawWorld();}g.fb=saved;
  g.cam=-1;g.updateCamera();window.step({},0);
  return {room,cameras:R.cameras.length,drawMs:Math.round(ms*10)/10,player:[g.player.x,g.player.y],camera:R.cameras[g.cam].id};
 },room);
 results.push(r);await page.screenshot({path:`tests/artifacts/scenes/${room}.png`});
}
// Capture the previously clipped narrative and the revised scripted scenes.
for(const scale of [1,2]) {
 const pages=await page.evaluate(async scale=>{const{Frame}=await import('/engine/psx.js');game.fb=new Frame(320,240,scale);const canvas=document.querySelector('#screen');canvas.width=game.fb.w;canvas.height=game.fb.h;game.mode='intro';game.introReveal=true;game.t=50;return game.ui.introPages().length;},scale);
 for(let p=0;p<pages;p++){await page.evaluate(p=>{game.introPage=p;window.step({},0)},p);await page.screenshot({path:`tests/artifacts/intro-${scale}-${p}.png`});}
 await page.evaluate(async()=>{const L=await game.A.location('lab');const end=L.sequences.deliver?.find(x=>x.chapter_end)?.chapter_end || Object.values(L.sequences).flat().find(x=>x.chapter_end?.final)?.chapter_end;if(!end)throw Error('Missing final chapter');game.chapter={...end,page:0};game.mode='chapter';game.t=50;window.step({},0)});
 await page.screenshot({path:`tests/artifacts/ending-${scale}.png`});
}
for(const [room,sequence,actor] of [['road_main','find_her','wilson'],['farm_outside','escape','amalgam'],['city_street','paul_gone','amalgam']]){
 await page.evaluate(async({room,sequence})=>{const g=game;g.resetScene();await g.enterRoom(room,0,0,0);g.script.running=[];g.ui.msg=null;g.ui.messageQueue=[];g.mode='play';g.god=true;g.fx.card=null;g.script.start(g.location.sequences[sequence]);},{room,sequence});
 for(let shot=0;shot<3;shot++){
  await page.evaluate(({actor,shot})=>{for(let i=0;i<1000;i++){game.update(game.ui.msg?{confirmPressed:true}:{});const e=game.enemies.find(e=>e.id===actor);if(e && (shot===0 || i>35))break;}window.step({},0);},{actor,shot});
  await page.screenshot({path:`tests/artifacts/${sequence}-${shot}.png`});
 }
}
// Inspect body-clear placement beside the farmhouse walls and kitchen furniture.
for(const [name,at,cam] of [['living',[91.5,4.2],'house_living'],['kitchen',[96,5.15],'house_kitchen']]){
 await page.evaluate(async({at,cam})=>{const g=game;g.resetScene();await g.enterRoom('farm_house',...at,0);g.script.running=[];g.ui.msg=null;g.ui.messageQueue=[];g.mode='play';g.cinematic=false;g.forcedCamera=cam;g.fx.card=null;g.fx.fade=0;g.updateCamera();window.step({},0);},{at,cam});
 await page.screenshot({path:`tests/artifacts/clearance-${name}.png`});
}
// Visual evidence for the acted bench scene, falling span, and playable finale.
for(const [room,sequence,frames,label] of [
 ['garage_lobby','message',48,'bench-sitting'],['garage_lobby','message',76,'bench-phone'],
 ['bridge','collapse',16,'bridge-falling'],['lab_main','delivery',360,'monster-playable']
]){
 await page.evaluate(async({room,sequence,frames})=>{
  const g=game;g.resetScene();g.state.flags={};g.state.fired={};g.state.dead={};g.state.enemies={};g.state.corpses={};
  await g.enterRoom(room,...(room==='lab_main'?[49.4,2.2]:room==='bridge'?[35,0]:[62,5.2]),0);
  g.script.running=[];g.ui.msg=null;g.ui.messageQueue=[];g.mode='play';g.fx.card=null;g.cinematic=false;g.script.start(g.location.sequences[sequence]);
  for(let i=0;i<frames;i++)g.update(g.ui.msg?{confirmPressed:true}:{});
  if(room==='lab_main'){g.ui.msg=null;g.ui.messageQueue=[];g.forcedCamera=null;g.updateCamera();}
  window.step({},0);
 },{room,sequence,frames});
 await page.screenshot({path:`tests/artifacts/${label}.png`});
}
await page.evaluate(()=>{const g=game;g.ui.msg=null;g.ui.messageQueue=[];g.script.running=[];g.player.script({at:[54.5,7.05],yaw:180});g.script.start(g.location.sequences.escape_monster);for(let i=0;i<48;i++)g.update({});window.step({},0);});
await page.screenshot({path:'tests/artifacts/monster-climb.png'});
// A real keyboard press should take the van pickup, rather than opening storage.
await page.evaluate(async()=>{
 const g=game;g.resetScene();g.state.flags.city_talk=true;g.state.flags.maxine_left=true;
 await g.enterRoom('city_street',-25,-1.3,0);g.mode='play';g.script.running=[];g.ui.msg=null;g.ui.messageQueue=[];g.cinematic=false;
 window.step({},0);window.paused=false;
});
await page.locator('#screen').focus();await page.keyboard.press('KeyE');
await page.waitForFunction(()=>game.ui.msg?.lines[0].includes('Bolt cutters'));
await page.evaluate(()=>{window.paused=true;game.ui.msg=null;window.step({},0)});
await page.screenshot({path:'tests/artifacts/van.png'});
await page.evaluate(()=>{game.state.add('pistol2',15,game.A.content.items,8);game.state.add('herb',2,game.A.content.items,8);game.ui.openMenu();window.step({},0)});
await page.screenshot({path:'tests/artifacts/inventory.png'});
// Settings and renderer toggling while paused.
await page.getByRole('button',{name:'Pause and open settings'}).click();
await page.locator('#quality').selectOption('1');
if(await page.locator('#screen').getAttribute('width')!=='320')throw Error('Classic size incorrect');
await page.locator('#quality').selectOption('2');
if(await page.locator('#screen').getAttribute('width')!=='640')throw Error('Enhanced size incorrect');
await page.screenshot({path:'tests/artifacts/settings.png'});
await writeFile('tests/artifacts/browser-results.json',JSON.stringify({results,errors},null,2));
console.log(JSON.stringify({rooms:results.length,cameras:results.reduce((a,b)=>a+b.cameras,0),maxDrawMs:Math.max(...results.map(r=>r.drawMs)),errors}));
await browser.close();
if(errors.length)throw new Error(errors.join('\n'));
