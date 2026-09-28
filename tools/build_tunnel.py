"""Rebuild the tunnel exterior, its camera plates/depth masks and collision grid.
Run with Python 3.11 + bpy==4.5.3, numpy and Pillow. All geometry is authored here.
"""
from pathlib import Path
import bpy, math, json, random, base64
import numpy as np
from PIL import Image
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/'data';random.seed(17)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.resolution_x=640;scene.render.resolution_y=480;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
scene.world.color=(.025,.03,.035);scene.view_settings.view_transform='AgX'
def mat(name,col,rough=.8,metal=0,noise=False,emit=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*col,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*col,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 if emit:p.inputs['Emission Color'].default_value=(*col,1);p.inputs['Emission Strength'].default_value=emit
 if noise:
  n=m.node_tree.nodes.new('ShaderNodeTexNoise');n.inputs['Scale'].default_value=5;n.inputs['Detail'].default_value=3
  ramp=m.node_tree.nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(*(v*.4 for v in col),1);ramp.color_ramp.elements[1].color=(*col,1)
  m.node_tree.links.new(n.outputs['Fac'],ramp.inputs[0]);m.node_tree.links.new(ramp.outputs[0],p.inputs['Base Color'])
  bump=m.node_tree.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.18;bump.inputs['Distance'].default_value=.08;m.node_tree.links.new(n.outputs['Fac'],bump.inputs['Height']);m.node_tree.links.new(bump.outputs[0],p.inputs['Normal'])
 return m
concrete=mat('stained concrete',(.27,.30,.28),noise=True);road=mat('wet asphalt',(.075,.08,.075),.3,noise=True)
black=mat('rubber',(.018,.02,.018));glass=mat('dark broken glass',(.045,.09,.10),.2,.3);rust=mat('corroded metal',(.21,.10,.05),noise=True)
rv=mat('RV ivory panels',(.63,.6,.45),noise=True);stripe=mat('RV burgundy stripe',(.22,.05,.035));trim=mat('metal trim',(.22,.25,.25),.4,.5)
light=mat('warm lamps',(1,.54,.22),emit=5);white=mat('lane markings',(.55,.53,.41),noise=True);red=mat('tail lights',(.6,.014,.006),emit=.6)
blue=mat('emergency sign',(.03,.24,.16),emit=.5);paper=mat('sign letters',(.83,.87,.73),emit=.3)
paint=[mat('car paint '+str(i),c,noise=True)for i,c in enumerate([(.12,.18,.20),(.36,.12,.08),(.28,.27,.21),(.10,.14,.11),(.45,.42,.30)])]
obstacles=[]
def box(name,loc,size,m,bev=0):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m)
 if bev:mod=o.modifiers.new('soft edges','BEVEL');mod.width=bev;mod.segments=1;o.modifiers.new('weighted normals','WEIGHTED_NORMAL')
 return o
def cyl(name,loc,radius,depth,m,rotation=(0,0,0)):
 bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=radius,depth=depth,location=loc,rotation=rotation);o=bpy.context.object;o.name=name;o.data.materials.append(m);return o
def area(loc,power,col,size=4):
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.color=col;o.data.shape='DISK';o.data.size=size
 return o
def text(label,loc,size,material,rotation=(math.pi/2,0,0)):
 bpy.ops.object.text_add(location=loc,rotation=rotation);o=bpy.context.object;o.data.body=label;o.data.size=size;o.data.align_x='CENTER';o.data.extrude=.004;o.data.materials.append(material)
box('road',(0,-1.5,-.12),(170,25,.24),road)
# Continuous vaulted tunnel and repeated structural ribs.
for x in [-85,85]:box('end barrier',(x,-1.5,2),(1,25,4),concrete)
for y in [-14.2,11.2]:box('side wall',(0,y,1.5),(170,.4,3),concrete);box('raised curb',(0,y+(.55 if y<0 else -.55),.10),(170,.9,.20),concrete)
verts=[];faces=[]
for x in [-85,85]:
 for i in range(25):
  t=i*math.pi/24;verts.append((x,-1.5+12.5*math.cos(t),3+6*math.sin(t)))
for i in range(24):faces.append((i,i+1,26+i,25+i))
mesh=bpy.data.meshes.new('vault');mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new('vaulted ceiling',mesh);bpy.context.collection.objects.link(o);o.data.materials.append(concrete)
for x in range(-80,81,8):
 for i in range(16):
  t=(i+.5)*math.pi/16;y=-1.5+12.35*math.cos(t);z=3+5.85*math.sin(t)
  o=box('vault rib',(x,y,z),(.25,2.5,.22),trim);o.rotation_euler.x=math.atan2(5.85*math.cos(t),-12.35*math.sin(t))
 box('ceiling lamp',(x,-1.5,8.65),(2.6,.32,.12),light)
 area((x,-1.5,8.2),1300,(1,.69,.38),7)
 for y in [-7.5,.0,6.0]:box('lane dash',(x,y,.014),(3,.12,.025),white)
for x in range(-72,73,16):
 for y in [-13.9,10.9]:
  o=box('wall light',(x,y,2.9),(.9,.1,.18),light)
# RV: retain the door's world coordinates so interior and story connections match.
box('motorhome body',(.5,4.5,1.75),(15,5.8,3.15),rv,.12);obstacles.append((-7,1.55,8,7.45))
box('RV roof',(.5,4.5,3.38),(15.15,5.95,.16),trim,.05)
box('RV side stripe',(.5,1.57,1.35),(15.0,.025,.26),stripe)
for x in [-5,-2,1,6.5]:
 box('RV window frame',(x,1.55,2.48),(1.45,.08,.9),trim,.05);box('RV window',(x,1.50,2.48),(1.29,.02,.73),glass)
box('RV door',(4.5,1.48,1.42),(1.02,.08,2.5),trim,.04);box('RV door panel',(4.5,1.43,1.4),(.91,.03,2.32),rv)
box('RV door window',(4.5,1.40,2.1),(.62,.02,.55),glass);box('RV door handle',(4.83,1.35,1.25),(.08,.06,.18),trim)
for z,y,w in[(.14,.68,1.25),(.30,1.02,1.16)]:box('entry step',(4.5,y,z),(w,.45,.14),trim)
area((4.5,.9,3.05),55,(1,.55,.23),1)
for x in[-4.6,5.6]:
 for y in[1.7,7.3]:cyl('RV wheel',(x,y,.57),.60,.25,black,(math.pi/2,0,0))
text('NORTH PASS   /   KEEP MOVING',(-4,10.85,2.3),.48,paper)
text('EMERGENCY',(14,10.85,2.0),.35,paper)
box('service cabinet',(-12,10.65,1.1),(1.3,.5,1.9),rust)
def car(x,y,angle=0,index=0,crushed=False):
 before=set(bpy.context.scene.objects);p=paint[index%len(paint)]
 body=box('abandoned car body',(0,0,.65),(4.7,1.9,.85),p,.14)
 if crushed:
  for v in body.data.vertices:
   if v.co.x>1.5:v.co.x-=.28;v.co.z-=.17 if v.co.z>0 else 0

 box('car cabin',(-.2,0,1.30),(2.35,1.7,.66 if not crushed else .34),p,.16)
 box('windshield',(.91,0,1.33),(.06,1.51,.49),glass)
 box('rear glass',(-1.38,0,1.33),(.06,1.47,.43),glass)
 for yy in[-.87,.87]:
  for xx in[-.7,.4]:box('side window',(xx,yy,1.4),(.84,.018,.4),glass)
 for xx in[-1.5,1.5]:
  for yy in[-.94,.94]:cyl('wheel',(xx,yy,.39),.38,.18,black,(math.pi/2,0,0))
 for yy in[-.67,.67]:box('tail lamp',(-2.36,yy,.79),(.025,.32,.16),red)
 box('hood seam',(1.6,0,1.09),(1.2,.022,.02),rust)
 if crushed:
  hood=box('buckled hood',(1.5,0,1.12),(1.35,1.65,.055),p);hood.rotation_euler.y=math.radians(-16)
  # Visible broken windscreen spokes and missing glass, within the body footprint.
  box('windscreen hole',(.947,-.2,1.35),(.014,.38,.22),black)
  for yy,zz in [(-.65,1.52),(.56,1.51),(.52,1.15),(-.53,1.16)]:
   start=Vector((.955,-.2,1.35));end=Vector((.955,yy,zz));delta=end-start
   crack=cyl('cracked windscreen',(start+end)/2,.009,delta.length,trim);crack.rotation_euler=delta.to_track_quat('Z','Y').to_euler()

 objs=set(bpy.context.scene.objects)-before;a=math.radians(angle)
 for o in objs:
  xx,yy,zz=o.location;o.location=(x+math.cos(a)*xx-math.sin(a)*yy,y+math.sin(a)*xx+math.cos(a)*yy,zz);o.rotation_euler.z+=a
 if -17<x<17:
  hx=abs(math.cos(a))*2.45+abs(math.sin(a))*1.02;hy=abs(math.sin(a))*2.45+abs(math.cos(a))*1.02;obstacles.append((x-hx,y-hy,x+hx,y+hy))
for spec in[(-5,-4.9,18,1,True),(-10,-.3,20,0,False),(1,-5.4,-12,2,True),(7,-5.1,12,3,True),(12,-.6,72,4,True),(-12,-5.3,-8,3,False),(11.7,6.0,65,1,False)]:car(*spec)
for side in[-1,1]:
 for k in range(6):
  for y in[-4.5,1,6.5]:car(side*(22+k*8)+random.uniform(-1,1),y+random.uniform(-.4,.4),random.uniform(-12,12),k,True)
# Debris and damp patches add scale without adding invisible collision obstacles.
for i in range(100):
 x=random.uniform(-17,17);y=random.uniform(-12.5,9.8)
 if any(a<x<b and c<y<d for a,c,b,d in obstacles):continue
 o=box('debris',(x,y,.035),(random.uniform(.08,.3),random.uniform(.05,.22),.04),rust);o.rotation_euler.z=random.random()*6.28
# Save the authored scene as well as its deterministic build script.
scene.render.film_transparent=False
bpy.context.view_layer.update()
# Use evaluated geometry for the packed scene-depth masks and visibility tests.
verts=[];polys=[];deps=bpy.context.evaluated_depsgraph_get()
for ob in scene.objects:
 if ob.type not in {'MESH','FONT'}:continue
 eo=ob.evaluated_get(deps);me=eo.to_mesh();base=len(verts);verts.extend([eo.matrix_world@v.co for v in me.vertices]);polys.extend([tuple(base+i for i in p.vertices)for p in me.polygons]);eo.to_mesh_clear()
bvh=BVHTree.FromPolygons(verts,polys)
camera_defs=[
 ('lot_wreck',(-14,-11,4.6),(-4,-3,1.0),155),('lot_front',(12,-8,4.8),(0,1,1.0),145),
 ('lot_east',(15,7.7,4.8),(7,0,1.0),145),('lot_west',(-15,7.7,4.8),(-7,0,1.0),145),
 ('lot_back',(11,9.6,4.8),(-4,7.7,1.0),145),('lot_road',(-9,-12.5,4.2),(8,-7.7,1.0),145),
 ('suv_cut',(16,-5.5,3.6),(8,-9.5,1.1),175)]
room=json.loads((DATA/'rooms/trailer_lot.json').read_text());old=[c['id']for c in room['cameras']];cams=[]
for name,eye,target,f in camera_defs:
 bpy.ops.object.camera_add(location=eye);cam=bpy.context.object;cam.name=name;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='PERSP';cam.data.lens=f*32/320;cam.data.sensor_width=32;cam.data.sensor_fit='HORIZONTAL';cam.data.clip_end=200;scene.camera=cam;bpy.context.view_layer.update()
 view=cam.matrix_world.inverted();meta={'id':name,'world_to_camera':[list(row)for row in view],'focal_px':f,'plate_hd':name+'_hd.png','lights':{'pts':[[[0,-1,6],[1,.62,.3],16],[[10,-6,4],[.7,.8,.85],14]],'amb':[.26,.25,.23]},'sprites':[]};cams.append(meta)
 scene.render.filepath=str(DATA/'bg'/f'{name}_hd.png');bpy.ops.render.render(write_still=True)
 Image.open(scene.render.filepath).resize((320,240),Image.Resampling.LANCZOS).save(DATA/'bg'/f'{name}.png')
 depth=np.zeros((240,320,3),dtype=np.uint8);origin=Vector(eye);rot=cam.matrix_world.to_3x3();forward=rot@Vector((0,0,-1))
 for py in range(240):
  for px in range(320):
   direction=rot@Vector(((px+.5-160)/f,-(py+.5-120)/f,-1));direction.normalize();hit,_,_,distance=bvh.ray_cast(origin,direction,200)
   z=65535 if hit is None else min(65535,max(1,round((hit-origin).dot(forward)*100)))
   depth[py,px,0]=z>>8;depth[py,px,1]=z&255
 Image.fromarray(depth).save(DATA/'bg'/f'{name}_depth.png')
room['cameras']=cams;room['name']='NORTH PASS TUNNEL';room['wind']=0
# Same packed grid format as the shipped rooms; geometry and walk bounds come from this scene.
g=room['grid'];nx,ny=g['nx'],g['ny'];packed=np.zeros((ny*3,nx,3),dtype=np.uint8);walk=np.zeros((ny,nx),dtype=np.uint8);missing=0
from mathutils import Matrix
views=[Matrix(c['world_to_camera'])for c in cams]
for j in range(ny):
 for i in range(nx):
  x=g['x0']+(i+.5)*g['res'];y=g['y0']+(j+.5)*g['res'];blocked=not(-15.8<x<15.8 and -12.8<y<9.9)or any(a-.12<x<b+.12 and c-.12<y<d+.12 for a,c,b,d in obstacles)
  walk[j,i]=not blocked;packed[j,i,0]=(0 if blocked else 1)|(4<<1)
  # Flat walk floor and exact obstacle-top raycast for shots.
  packed[ny+j,i,1]=128
  hit,_,_,_=bvh.ray_cast(Vector((x,y,5)),Vector((0,0,-1)),6);top=0 if hit is None else max(0,hit.z)
  v=min(65535,int(top*100)+32768);packed[ny*2+j,i,0]=v>>8;packed[ny*2+j,i,1]=v&255
  best=-1;bs=-1e9;mask=0
  for k,(cam,view)in enumerate(zip(cams,views)):
   p=view@Vector((x,y,1.1,1));z=-p.z
   if z<.2:continue
   sx=160+cam['focal_px']*p.x/z;sy=120-cam['focal_px']*p.y/z
   if not(10<sx<310 and 10<sy<226):continue
   origin=Vector(camera_defs[k][1]);delta=Vector((x,y,1.1))-origin;distance=delta.length;hit,_,_,d=bvh.ray_cast(origin,delta.normalized(),distance)
   visible=hit is None or d>=distance-.2
   mask|=1<<k
   score=(1000 if visible else 0)-abs(sx-160)*.25-abs(sy-140)*.2-abs(z-12)*1.2
   if score>bs:bs=score;best=k
  if best<0:
   best=0
   if not blocked:missing+=1
  packed[j,i,1]=best;packed[j,i,2]=mask&255;packed[ny+j,i,0]=mask>>8
Image.fromarray(packed).save(DATA/g['png'])
m=room['map'];cells=[]
for j in range(m['h']):
 for i in range(m['w']):
  x=m['x0']+(i+.5)*m['res'];y=m['y0']+(j+.5)*m['res'];ii=int((x-g['x0'])/g['res']);jj=int((y-g['y0'])/g['res']);cells.append(bool(0<=ii<nx and 0<=jj<ny and walk[jj,ii]))
m['cells']=base64.b64encode(np.packbits(cells).tobytes()).decode();(DATA/'rooms/trailer_lot.json').write_text(json.dumps(room,separators=(',',':'))+'\n')
(DATA/'tunnel_obstacles.json').write_text(json.dumps(obstacles))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'tools/tunnel.blend'))
print('TUNNEL COMPLETE; walkable cells without an in-frame camera:',missing,flush=True)
