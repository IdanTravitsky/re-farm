import { assets } from './platform.js';
const A = await assets();
let points = 0, issues = [];
for (const id of Object.keys(A.content.world.locations)) {
 const L = await A.location(id);
 for (const rid of L.rooms) {
  const R = await A.room(rid);
  // Every authored walk cell must connect by edge-adjacent steps. This is stricter
  // than diagonal-only connectivity and matches swept movement around corners.
  const seen = new Uint8Array(R.walkA.length), queue = [];
  const start = R.walkA.findIndex(v => v === 1);
  if (start >= 0) { queue.push(start); seen[start] = 1; }
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q], x = k % R.nx, y = Math.floor(k / R.nx);
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const xx=x+dx,yy=y+dy,kk=yy*R.nx+xx;
      if(xx<0||xx>=R.nx||yy<0||yy>=R.ny||!R.walkA[kk]||seen[kk])continue;
      seen[kk]=1;queue.push(kk);
    }
  }
  if (queue.length !== R.walkA.reduce((a,b)=>a+b,0)) issues.push({room:rid,error:'disconnected walk grid'});
  const targets = [
   ...(L.pickups || []).filter(p=>p.room===rid).map(p=>({...p,kind:'pickup'})),
   ...(L.examine || []).filter(p=>p.room===rid).map(p=>({...p,kind:'examine'})),
   ...(L.doors || []).flatMap(d=>[d.a,d.b].filter(s=>s.room===rid).map(s=>({...s,id:d.id,kind:'door'}))),
   ...(L.item_boxes || []).filter(p=>p.room===rid).map(p=>({...p,kind:'box'}))];
  for (const p of targets) {
   points++;
   let best=Infinity, camera=false;
   for(let j=0;j<R.ny;j++)for(let i=0;i<R.nx;i++) {
    const k=j*R.nx+i;if(!R.walkA[k])continue;
    const x=R.x0+(i+.5)*R.res,y=R.y0+(j+.5)*R.res,d=Math.hypot(x-p.at[0],y-p.at[1]);
    if(d<best)best=d;
    if(d<=p.r && R.best[k]!==255)camera=true;
   }
   if(best>p.r)issues.push({room:rid,id:p.id,kind:p.kind,distance:+best.toFixed(2),radius:p.r});
   else if(!camera)issues.push({room:rid,id:p.id,error:'no camera at approach'});
  }
 }
}
console.log(JSON.stringify({rooms:Object.keys(A.content.world.rooms).length,points,issues},null,2));
process.exitCode = issues.length ? 1 : 0;
