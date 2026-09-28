import { assets } from './platform.js';
const A = await assets();
let points = 0, doorSpawns = 0, issues = [];
for (const id of Object.keys(A.content.world.locations)) {
 const L = await A.location(id);
 for (const rid of L.rooms) {
  const R = await A.room(rid);
  // Flood the body-clear floor from the room entrance. Decorative isolated slivers
  // are irrelevant; every interaction and door spawn must join this component.
  const seen = new Uint8Array(R.walkA.length), queue = [];
  const safe=R.walkA.map((v,k)=>v&&R.canStand(R.x0+(k%R.nx+.5)*R.res,R.y0+(Math.floor(k/R.nx)+.5)*R.res,.23)?1:0);
  const spawns=(L.doors||[]).flatMap(d=>[d.a,d.b]).filter(s=>s.room===rid).map(s=>s.spawn);
  const entry=L.entry?.room===rid?L.entry.at:spawns[0];
  let start=safe.findIndex(v=>v===1);
  if(entry){let best=Infinity;for(let k=0;k<safe.length;k++)if(safe[k]){const d=Math.hypot(R.x0+(k%R.nx+.5)*R.res-entry[0],R.y0+(Math.floor(k/R.nx)+.5)*R.res-entry[1]);if(d<best){best=d;start=k;}}}
  if (start >= 0) { queue.push(start); seen[start] = 1; }
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q], x = k % R.nx, y = Math.floor(k / R.nx);
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const xx=x+dx,yy=y+dy,kk=yy*R.nx+xx;
      if(xx<0||xx>=R.nx||yy<0||yy>=R.ny||!safe[kk]||seen[kk])continue;
      seen[kk]=1;queue.push(kk);
    }
  }

  for(const spawn of spawns){
   doorSpawns++;
   const [x,y]=R.nearestWalkable(...spawn,4,.23);let connected=false;
   for(let j=0;j<R.ny&&!connected;j++)for(let i=0;i<R.nx;i++)if(seen[j*R.nx+i]&&Math.hypot(R.x0+(i+.5)*R.res-x,R.y0+(j+.5)*R.res-y)<R.res*1.5){connected=true;break;}
   if(!connected)issues.push({room:rid,error:'door spawn disconnected from entrance',spawn});
  }
  const targets = [
   ...(L.pickups || []).filter(p=>p.room===rid).map(p=>({...p,kind:'pickup'})),
   ...(L.examine || []).filter(p=>p.room===rid).map(p=>({...p,kind:'examine'})),
   ...(L.doors || []).flatMap(d=>[d.a,d.b].filter(s=>s.room===rid).map(s=>({...s,id:d.id,kind:'door'}))),
   ...(L.item_boxes || []).filter(p=>p.room===rid).map(p=>({...p,kind:'box'}))];
  for (const p of targets) {
   points++;
   let best=Infinity, camera=false;
   for(let j=0;j<R.ny;j++)for(let i=0;i<R.nx;i++) {
    const k=j*R.nx+i;if(!seen[k])continue;
    const x=R.x0+(i+.5)*R.res,y=R.y0+(j+.5)*R.res,d=Math.hypot(x-p.at[0],y-p.at[1]);
    if(d<best)best=d;
    if(d<=p.r && R.best[k]!==255)camera=true;
   }
   if(best>p.r)issues.push({room:rid,id:p.id,kind:p.kind,distance:+best.toFixed(2),radius:p.r});
   else if(!camera)issues.push({room:rid,id:p.id,error:'no camera at approach'});
  }
 }
}
console.log(JSON.stringify({rooms:Object.keys(A.content.world.rooms).length,points,doorSpawns,issues},null,2));
process.exitCode = issues.length ? 1 : 0;
