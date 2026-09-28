// Playable final transformation. Uses the same swept collision and tank controls
// as human Bryan; attacks resolve on the animation's impact frame, through LOS.
import {Animator,CLIPSETS} from './anim.js';
const DT=1/30,rad=Math.PI/180;
const angle=(a,b)=>((a-b+540)%360)-180;
const heading=(x,y)=>Math.atan2(x,-y)/rad;
export function applyMonsterForm(p) {
 const g=p.g,def=g.A.content.actors.bryan_mutant;
 p.model=g.A.models[def.model];p.anim=new Animator(CLIPSETS[def.clips](g.A.poses[def.model]||{}));
 p.scale=.92;p.r=.34;p.wig=.8;p.hide=new Set();p.partTint=null;p.hidden=false;p.mode='move';p.target=null;
 p.anim.play('idle');
}
export function updateMonster(p,I) {
 const g=p.g;
 if(p.mode==='claw'){
  const before=p.anim.t;p.anim.update(DT);
  if(before<.7&&p.anim.t>=.7){
   let hit=false;
   for(const e of g.enemies){
    const dx=e.x-p.x,dy=e.y-p.y;
    if(e.B!=='flee'||!e.alive()||Math.hypot(dx,dy)>1.9||Math.abs(angle(heading(dx,dy),p.yaw))>65)continue;
    if(!g.room.shotLos(p.x,p.y,p.z+1.2,e.x,e.y,e.z+1.2))continue;
    e.damage(70,true,p.yaw);g.blood(e.x,e.y,e.z+1.1,14);hit=true;
   }
   g.sfx(hit?'squelch':'swing');g.fx.shake=Math.max(g.fx.shake,hit?.35:.08);
  }
  if(p.anim.done())p.mode='move';return;
 }
 if(I.firePressed&&p.cool<=0){p.mode='claw';p.cool=1.4;p.anim.play('attack',{restart:true,fade:.08});g.sfx('roar');return;}
 if(I.left)p.yaw+=150*DT;if(I.right)p.yaw-=150*DT;
 const speed=I.up?(I.run?3.6:1.8):I.back?-1.1:0;
 if(speed)p.move(Math.sin(p.yaw*rad)*speed*DT,-Math.cos(p.yaw*rad)*speed*DT);
 p.anim.play(speed?(I.run?'run':'walk'):'idle');p.anim.update(DT);
 if(I.actionPressed)g.interact();
}
export function updateFlee(e) {
 const g=e.g,p=g.player;
 // Choose among reachable room cells; never escape by teleporting through a wall.
 e.fleeClock=(e.fleeClock||0)-DT;
 if(e.fleeClock<=0||!e.fleePath?.length){
  e.fleeClock=1.5;const R=g.room,choices=[];
  for(let j=3;j<R.ny;j+=9)for(let i=3;i<R.nx;i+=9){
   const x=R.x0+(i+.5)*R.res,y=R.y0+(j+.5)*R.res;
   if(!R.canStand(x,y,e.r))continue;
   const distance=Math.hypot(x-e.x,y-e.y);if(distance<1||distance>8)continue;
   choices.push({x,y,score:Math.hypot(x-p.x,y-p.y)-distance*.15});
  }
  choices.sort((a,b)=>b.score-a.score);
  for(const v of choices.slice(0,12)){const path=R.path(e.x,e.y,v.x,v.y,e.r);if(path?.length){e.fleePath=path;break;}}
 }
 const target=e.fleePath?.[0];
 if(target){const dx=target[0]-e.x,dy=target[1]-e.y,d=Math.hypot(dx,dy);
  if(d<.13)e.fleePath.shift();else{e.yaw=heading(dx,dy);e.move(dx/d*1.5*DT,dy/d*1.5*DT);}
 }
 e.anim.play('run');
}
