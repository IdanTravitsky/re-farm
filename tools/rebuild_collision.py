"""Recover physical collision from the shipped navigation grids and scene depth.

Depth maps provide independent geometry evidence: vertical surfaces block bodies,
while low, visible ground details (paint, blood, shallow snow) do not. Source grids
are retained so rebuilding never compounds a previous correction.
Requires numpy and Pillow; run with Python 3.11+.
"""
from pathlib import Path
import json, numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/'data';SOURCE=ROOT/'tools/collision_sources'
SOURCE.mkdir(exist_ok=True)

def shift(a,dy,dx,fill):
 out=np.full_like(a,fill);h,w=a.shape
 y0,y1=max(0,dy),min(h,h+dy);x0,x1=max(0,dx),min(w,w+dx)
 out[y0:y1,x0:x1]=a[y0-dy:y1-dy,x0-dx:x1-dx];return out

def geometry(room):
 result=[]
 for c in room['cameras']:
  a=np.array(Image.open(DATA/f"bg/{c['id']}_depth.png"),dtype=np.int32);z=(a[:,:,0]*256+a[:,:,1])/100
  yy,xx=np.indices(z.shape);local=np.stack(((xx+.5-160)*z/c['focal_px'],-(yy+.5-120)*z/c['focal_px'],-z,np.ones_like(z)),axis=-1)
  p=(local@np.linalg.inv(np.array(c['world_to_camera'])).T).reshape(-1,4)[:,:3]
  result.append((c,z,p))
 return result

def rebuild(path):
 room=json.loads(path.read_text());g=room['grid'];nx,ny=g['nx'],g['ny'];res=g['res'];src=SOURCE/Path(g['png']).name
 if not src.exists():src.write_bytes((DATA/g['png']).read_bytes())
 a=np.array(Image.open(src),dtype=np.int32);walk=(a[:ny,:,0]&1).astype(bool)
 floor=((a[ny:ny*2,:,1]<<8)|a[ny:ny*2,:,2])-32768;top=((a[ny*2:,:,0]<<8)|a[ny*2:,:,1])-32768
 if 'walk_floor_limit'in room:
  lo,hi=room['walk_floor_limit'];walk&=(floor>=lo*100)&(floor<=hi*100)
 base=np.where(walk,floor,np.nan);distance=np.where(walk,0,999)
 # Ground height comes from nearby supported navigation, never a furniture top.
 for r in range(1,16):
  unknown=np.isnan(base);total=np.zeros(base.shape);count=np.zeros(base.shape)
  for dy,dx in [(1,0),(-1,0),(0,1),(0,-1)]:
   v=shift(base,dy,dx,np.nan);valid=np.isfinite(v);total+=np.nan_to_num(v);count+=valid
  take=unknown&(count>0);base[take]=total[take]/count[take];distance[take]=r
 geo=geometry(room);yy,xx=np.indices(walk.shape);worldx=g['x0']+(xx+.5)*res;worldy=g['y0']+(yy+.5)*res
 # Vertical geometry samples in several height bands distinguish walls/closed
 # doors from ground paint, rugs, pools of blood, and snow surface triangles.
 bands=np.zeros(walk.shape,dtype=np.uint8)
 for c,depth,points in geo:
  ii=np.floor((points[:,0]-g['x0'])/res).astype(int);jj=np.floor((points[:,1]-g['y0'])/res).astype(int)
  inside=(ii>=0)&(ii<nx)&(jj>=0)&(jj<ny);ii=ii[inside];jj=jj[inside];z=points[inside,2]
  rel=z-base[jj,ii]/100;valid=(rel>.3)&(rel<2.1)&np.isfinite(rel)
  bins=np.floor((rel[valid]-.3)/.3).astype(int);np.bitwise_or.at(bands,(jj[valid],ii[valid]),(1<<bins).astype(np.uint8))
 bitcount=np.array([int(i).bit_count()for i in range(256)],dtype=np.uint8)
 walls=bitcount[bands]>=3
 # Recover low ground detail only if a scene camera actually observes ground
 # at the inferred height. This prevents filling voids or hidden building interiors.
 candidate=(~walk)&(distance<=10)&(top-base>=-15)&(top-base<=18)&np.isfinite(base)
 candidate[:2]=False;candidate[-2:]=False;candidate[:,:2]=False;candidate[:,-2:]=False
 visible=np.zeros(walk.shape,dtype=bool)
 for c,depth,points in geo:
  px=np.stack((worldx,worldy,base/100,np.ones(base.shape)),axis=-1)@np.array(c['world_to_camera']).T
  z=-px[:,:,2];sx=np.nan_to_num(160+c['focal_px']*px[:,:,0]/np.maximum(z,.01),nan=-1000);sy=np.nan_to_num(120-c['focal_px']*px[:,:,1]/np.maximum(z,.01),nan=-1000)
  ix=np.floor(sx).astype(int);iy=np.floor(sy).astype(int);ok=candidate&(z>.1)&(ix>=0)&(ix<320)&(iy>=0)&(iy<240)
  hit=points.reshape(240,320,3)[np.clip(iy,0,239),np.clip(ix,0,319)]
  visible|=ok&(np.abs(hit[:,:,2]-base/100)<.12)
 opened=candidate&visible&~walls
 walk|=opened;walk&=~walls
 floor[opened]=np.rint(base[opened]).astype(int)
 a[:ny,:,0]=(a[:ny,:,0]&~1)|walk.astype(int);encoded=floor+32768;a[ny:ny*2,:,1]=encoded>>8;a[ny:ny*2,:,2]=encoded&255
 # Newly recovered ground needs a valid character camera, not an arbitrary
 # neighbouring camera inherited from the old restricted nav region.
 best=a[:ny,:,1].copy();low=a[:ny,:,2].copy();high=a[ny:ny*2,:,0].copy();score=np.full(walk.shape,-1e9);masks=np.zeros(walk.shape,dtype=np.uint16)
 for ci,(c,depth,points) in enumerate(geo):
  p=np.stack((worldx,worldy,floor/100+1.0,np.ones(base.shape)),axis=-1)@np.array(c['world_to_camera']).T
  z=-p[:,:,2];sx=160+c['focal_px']*p[:,:,0]/np.maximum(z,.01);sy=120-c['focal_px']*p[:,:,1]/np.maximum(z,.01)
  valid=opened&(z>.1)&(sx>5)&(sx<315)&(sy>5)&(sy<235)
  ix=np.clip(np.floor(sx).astype(int),0,319);iy=np.clip(np.floor(sy).astype(int),0,239)
  clear=depth[iy,ix]>=z-.15;value=clear*1000-abs(sx-160)-abs(sy-130)*.5
  masks[valid]|=1<<ci;take=valid&(value>score);best[take]=ci;score[take]=value[take]
 no_camera=opened&(masks==0);walk[no_camera]=False;opened[no_camera]=False
 low[opened]=masks[opened]&255;high[opened]=masks[opened]>>8
 a[:ny,:,0]=(a[:ny,:,0]&~1)|walk.astype(int);a[:ny,:,1]=best;a[:ny,:,2]=low;a[ny:ny*2,:,0]=high
 # Low furniture needs leg clearance; walls and tall furniture also need
 # torso/shoulder clearance. Unknown void boundaries remain full-height solids.
 tall=((~walk)&((top-base>110)|~np.isfinite(base)))|(walls&((bands&56)!=0))
 solid_path=f"rooms/{room['id']}_body.png"
 Image.fromarray((tall*255).astype(np.uint8)).save(DATA/solid_path)
 room['grid']['body_png']=solid_path;room.pop('floor_corridors',None)
 path.write_text(json.dumps(room,separators=(',',':'))+'\n')
 Image.fromarray(a.astype(np.uint8)).save(DATA/g['png'])
 # Retain the independently recovered solids for explicit geometry regression tests.
 Image.fromarray((walls*255).astype(np.uint8)).save(SOURCE/(room['id']+'_solids.png'))
 return {'room':room['id'],'ground_detail_cells_opened':int(opened.sum()),'vertical_solid_cells':int(walls.sum()),'previously_walkable_solid_cells':int(((np.array(Image.open(src))[:ny,:,0]&1)>0)[walls].sum())}

if __name__=='__main__':
 reports=[]
 for path in sorted((DATA/'rooms').glob('*.json')):
  if path.stem=='trailer_lot':continue # Native authored mesh already has matching collision.
  r=rebuild(path);reports.append(r);print(r,flush=True)
 (SOURCE/'report.json').write_text(json.dumps(reports,indent=2)+'\n')
