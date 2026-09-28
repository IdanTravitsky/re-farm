"""Build a compact many-body Amalgam using the game's original texture atlas.
The source snapshot is retained beside this script for reproducible art iteration.
"""
from pathlib import Path
import json,copy,math
root=Path(__file__).resolve().parents[1];d=json.loads((root/'tools/amalgam-source.json').read_text());original=copy.deepcopy(d['parts']);lookup={p['name']:i for i,p in enumerate(original)}
def rot(x,y,z):
 x,y,z=map(math.radians,(x,y,z));cx,sx,cy,sy,cz,sz=math.cos(x),math.sin(x),math.cos(y),math.sin(y),math.cos(z),math.sin(z)
 return [[cz*cy,cz*sy*sx-sz*cx,cz*sy*cx+sz*sx],[sz*cy,sz*sy*sx+cz*cx,sz*sy*cx-cz*sx],[-sy,cy*sx,cy*cx]]
def transform(v,R,s=1):return[round(sum(a*b for a,b in zip(row,v))*s)for row in R]
# A broad central body, supported by a spread stance rather than a tall thin torso.
for p in d['parts']:
 if p['name'] in ['hips','torso']:
  p['verts']=[[round(v[0]*1.9),round(v[1]*1.8),round(v[2]*1.08)]for v in p['verts']]
  p['normals']=[transform([v[0]/1.9,v[1]/1.8,v[2]/1.08],rot(0,0,0))for v in p['normals']]
 if p['name'] in ['thigh_r','thigh_l']:p['offset'][0]=(-1 if p['name'].endswith('_r')else 1)*510
 if p['name'].startswith('tent'):
  p['verts']=[[round(c*.48)for c in v]for v in p['verts']]
  if p['name'].endswith(('_1','_2')):p['offset']=[round(c*.48)for c in p['offset']]
def attach(index,offset,angles,scale,names):
 R=rot(*angles);anchor=len(d['parts']);d['parts'].append({'name':f'mass_{index}','parent':0,'offset':offset,'verts':[],'normals':[],'faces':[]});mapping={}
 for name in names:
  src=original[lookup[name]];p=copy.deepcopy(src);new=len(d['parts']);mapping[lookup[name]]=new
  p['name']=f'mass_{index}_{name}';p['parent']=mapping.get(src['parent'],anchor)
  p['offset']=[0,0,0]if p['parent']==anchor else transform(src['offset'],R,scale)
  p['verts']=[transform(v,R,scale)for v in src['verts']];p['normals']=[transform(v,R)for v in src['normals']];d['parts'].append(p)
body=['torso','upperarm_r','forearm_r','hand_r','upperarm_l','forearm_l','hand_l','head','beard']
female=['w_torso','w_head','w_hair','w_tent_arm_r0','w_tent_arm_r1','w_tent_arm_r2','w_tent_arm_l0','w_tent_arm_l1','w_tent_arm_l2']
for i,(at,angle,s)in enumerate([
 ([-640,-100,140],[25,10,-35],.85),([620,40,260],[-25,-20,40],.90),
 ([-200,320,520],[65,0,145],.92),([180,-350,570],[-45,0,-20],.83),
 ([0,80,910],[10,20,5],.78),([-690,270,560],[25,-40,100],.83),([700,-240,610],[-30,35,-70],.82)]):
 attach(i,at,angle,s,body if i%2==0 else female)
for i,(x,y,z)in enumerate([(-780,-250,-50),(780,-250,-50),(-630,420,100),(630,420,100)]):
 attach(7+i,[x,y,z],[8 if y<0 else -15,-10 if x<0 else 10,0],1.05,['thigh_r','shin_r','foot_r'])
d['stats']={'parts':len(d['parts']),'vertices':sum(len(p['verts'])for p in d['parts']),'faces':sum(len(p['faces'])for p in d['parts'])}
(root/'data/models/amalgam.json').write_text(json.dumps(d,separators=(',',':'))+'\n')
