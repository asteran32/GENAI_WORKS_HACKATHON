import * as THREE from './vendor/three.module.js';
import {CITY,project} from './gis-data.js';
import {createFacadeMaterials} from './architecture.js';
import {OPERA,isOperaFootprint,createOperaHouse,operaOccluders} from './opera-house.js';
import {UI} from './i18n.js';

export function containsPoint([x,z],rings) {
  const inside=ring=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
  return inside(rings[0])&&!rings.slice(1).some(inside);
}
function ringArea(ring){return ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;}
function localPolygon(coordinates) {return coordinates.map((ring,i)=>{let points=ring.slice(0,-1).map(project);if((ringArea(points)>0)!==(i===0))points.reverse();return points;});}
export function buildingHeights(p) {
  const top=Number(p.render_height),bottom=Number(p.render_min_height);
  const height=Number.isFinite(top)&&top>0?top:3,min=Number.isFinite(bottom)&&bottom>=0?Math.min(bottom,height):0;
  return {height,min,fallback:!(Number.isFinite(top)&&top>0)};
}
export function addGISCity({data,world,buildings,renderer,material,box,obstacles,tree,label}) {
  const facades=createFacadeMaterials(renderer),roof=material('#c4cec8'),ledge=material('#dfe2d8'),roadMat=material('#bbc5c5'),pathMat=material('#e5decb'),railMat=material('#91a9a4');
  const green=material('#bfceb0'),wood=material('#aac1a6'),water=material('#85b8bd',{roughness:.36,metalness:.06}),paving=material('#e3e6dc');
  const [west,south]=project([CITY.bounds[0],CITY.bounds[1]]),[east,north]=project([CITY.bounds[2],CITY.bounds[3]]);
  box(0,-3,0,2200,2,2200,material('#edf3f1'),world,false);
  box((west+east)/2,.5,(north+south)/2,east-west,2,south-north,paving,world,false);
  const roadBuckets=new Map(),roadPaths=[],heatPoints=[],greenPolygons=[],waterPolygons=[],buildingPolygons=[];
  let partCount=0,fallbackCount=0;
  function ground(rings,y,mat,parent=world){
    const shape=new THREE.Shape();rings[0].forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
    for(const hole of rings.slice(1)){const path=new THREE.Path();hole.forEach(([x,z],i)=>i?path.lineTo(x,-z):path.moveTo(x,-z));path.closePath();shape.holes.push(path);}
    const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape),mat);mesh.rotation.x=-Math.PI/2;mesh.position.y=y;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  for(const f of data.features){
    const p=f.properties;if(p.layer==='building'||p.layer==='transportation')continue;
    const polygons=f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[f.geometry.coordinates];
    for(const coordinates of polygons){
      const rings=localPolygon(coordinates);
      if(p.layer==='water'){ground(rings,1.54,water);waterPolygons.push(rings);}
      else if(p.layer==='park'||p.layer==='landcover'&&['grass','wood'].includes(p.class)){ground(rings,1.56,p.class==='wood'?wood:green);greenPolygons.push(rings);}
      else if(p.layer==='landuse'&&['pedestrian','square','recreation_ground'].includes(p.class))ground(rings,1.55,pathMat);
    }
  }
  for(const f of data.features.filter(f=>f.properties.layer==='building')){
    const p=f.properties,h=buildingHeights(p),base=1.7+h.min/CITY.metersPerUnit,top=1.7+h.height/CITY.metersPerUnit;
    if(top<=base)continue;
    for(const coordinates of f.geometry.coordinates){
      const rings=localPolygon(coordinates),outer=rings[0];if(outer.length<3||Math.abs(ringArea(outer))<.1)continue;
      const bounds=new THREE.Box3();for(const [x,z] of outer){bounds.expandByPoint(new THREE.Vector3(x,base,z));bounds.expandByPoint(new THREE.Vector3(x,top,z));}
      bounds.footprint=outer;bounds.holes=rings.slice(1);buildingPolygons.push({rings,bounds});partCount++;if(h.fallback)fallbackCount++;
      if(isOperaFootprint(coordinates))continue;
      obstacles.push(bounds);
      const hash=Math.abs(Math.floor(bounds.min.x*19+bounds.min.z*31)),styles=h.height>55?['blue','silver','bronze']:['limestone','sandstone','concrete','brick'];
      const style=styles[hash%styles.length],positions=[],uv=[];let offset=0;
      for(const ring of rings)for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
        positions.push(a[0],base,a[1],a[0],top,a[1],b[0],base,b[1],b[0],base,b[1],a[0],top,a[1],b[0],top,b[1]);
        const u0=offset/2,u1=(offset+length)/2,v=(top-base)/2.64;uv.push(u0,0,u0,v,u1,0,u1,0,u0,v,u1,v);offset+=length;
      }
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();
      const mesh=new THREE.Mesh(g,facades[style]);mesh.castShadow=mesh.receiveShadow=true;buildings.add(mesh);const cap=ground(rings,top,roof,buildings);cap.castShadow=true;
      // Cosmetic roof detail stays inside the supplied outline; no invented massing or height.
      const cx=(bounds.min.x+bounds.max.x)/2,cz=(bounds.min.z+bounds.max.z)/2,w=bounds.max.x-bounds.min.x,d=bounds.max.z-bounds.min.z;
      if(h.height>25&&w>2&&d>2&&[[cx-.6,cz-.4],[cx+.6,cz-.4],[cx+.6,cz+.4],[cx-.6,cz+.4]].every(p=>containsPoint(p,rings))){box(cx,top+.18,cz,1.2,.36,.8,material('#899b9d'),buildings);box(cx,top+.38,cz,1.3,.08,.9,ledge,buildings);}
    }
  }
  const opera=createOperaHouse(material);buildings.add(opera);obstacles.push(...operaOccluders(opera));
  const [operaX,operaZ]=project(OPERA.coordinates);label(OPERA.name,operaX,20,operaZ,'landmark','','opera');
  const isBuilding=([x,z])=>buildingPolygons.some(({bounds,rings})=>x>=bounds.min.x&&x<=bounds.max.x&&z>=bounds.min.z&&z<=bounds.max.z&&bounds.min.y<2.2&&containsPoint([x,z],rings));
  const isWater=point=>waterPolygons.some(rings=>containsPoint(point,rings));
  function clipped(a,b){let t0=0,t1=1;const dx=b[0]-a[0],dz=b[1]-a[1];for(const [p,q] of [[-dx,a[0]-west],[dx,east-a[0]],[-dz,a[1]-north],[dz,south-a[1]]]){if(!p){if(q<0)return null;continue;}const t=q/p;if(p<0)t0=Math.max(t0,t);else t1=Math.min(t1,t);if(t0>t1)return null;}return [[a[0]+dx*t0,a[1]+dz*t0],[a[0]+dx*t1,a[1]+dz*t1]];}
  const heatKeys=new Set(),pathKeys=new Set();
  for(const f of data.features.filter(f=>f.properties.layer==='transportation')){
    const p=f.properties,c=p.class,path=c==='path'||['pedestrian','footway','steps'].includes(p.subclass),rail=['rail','transit'].includes(c);
    if(['ferry','aerialway'].includes(c))continue;
    const width=(path?4:rail?2:['motorway','trunk'].includes(c)?19:['primary','secondary'].includes(c)?14:10)/CITY.metersPerUnit;
    const mat=path?pathMat:rail?railMat:roadMat,y=rail?1.72:path?1.67:1.63;
    if(!roadBuckets.has(mat))roadBuckets.set(mat,[]);const positions=roadBuckets.get(mat);
    const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates;
    for(const line of lines)for(let i=1;i<line.length;i++){
      const clippedLine=clipped(project(line[i-1]),project(line[i]));if(!clippedLine)continue;const [a,b]=clippedLine,dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.03)continue;
      const key=[...a,...b].map(v=>v.toFixed(2)).join(',');if(pathKeys.has(key))continue;pathKeys.add(key);
      const nx=-dz/length*width/2,nz=dx/length*width/2;
      positions.push(a[0]-nx,y,a[1]-nz,a[0]+nx,y,a[1]+nz,b[0]-nx,y,b[1]-nz,b[0]-nx,y,b[1]-nz,a[0]+nx,y,a[1]+nz,b[0]+nx,y,b[1]+nz);
      if(!rail&&!['motorway','trunk'].includes(c)){
        roadPaths.push({a,b,width,path,length});
        const count=Math.max(1,Math.ceil(length/4));
        for(let k=0;k<count;k++){
          const t=(k+.5)/count,x=a[0]+dx*t,z=a[1]+dz*t,heatKey=Math.round(x)+','+Math.round(z);
          if(heatKeys.has(heatKey)||isBuilding([x,z])||isWater([x,z]))continue;heatKeys.add(heatKey);
          heatPoints.push({x,z,length:length/count+.12,width:width*.88,angle:Math.atan2(dz,dx),path});
        }
      }
    }
  }
  for(const [mat,positions] of roadBuckets){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,mat);mesh.material.side=THREE.DoubleSide;mesh.receiveShadow=true;world.add(mesh);}
  // The tile schema does not contain a tree inventory: decorative park trees are explicitly illustrative.
  let treeCount=0;
  for(let x=west+4;x<east;x+=9)for(let z=north+4;z<south;z+=9){
    const jitter=Math.sin(x*8.73+z*4.1),point=[x+jitter*2,z+Math.cos(z*2.9)*2];
    if(greenPolygons.some(r=>containsPoint(point,r))&&!waterPolygons.some(r=>containsPoint(point,r))&&!isBuilding(point)&&!roadPaths.some(r=>distanceToSegment(point,r)<r.width*.7+1)){
      tree(point[0],point[1],.27+(jitter+1)*.055,treeCount%13===0?1:0);treeCount++;
    }
  }
  for(const [name,coords,y] of [['Sydney Tower',[151.2094,-33.87045],66],['Hyde Park',[151.2119,-33.8740],5],['Royal Botanic Garden',[151.2165,-33.8644],5],['Darling Harbour',[151.2014,-33.8716],3]]){const [x,z]=project(coords);label(name,x,y,z);}
  return {heatPoints,roadPaths,isBuilding,isWater,buildingParts:partCount,fallbackHeights:fallbackCount,treeCount,bounds:{west,east,north,south}};
}
export function distanceToSegment(point,{a,b}){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dz)/(dx*dx+dz*dz)));return Math.hypot(point[0]-a[0]-dx*t,point[1]-a[1]-dz*t);}
export function locateCandidate(coords,roads,isBuilding,isWater=()=>false){
  const origin=project(coords),options=[];
  for(const r of roads){const dx=r.b[0]-r.a[0],dz=r.b[1]-r.a[1],t=Math.max(0,Math.min(1,((origin[0]-r.a[0])*dx+(origin[1]-r.a[1])*dz)/(dx*dx+dz*dz))),x=r.a[0]+dx*t,z=r.a[1]+dz*t,d=Math.hypot(x-origin[0],z-origin[1]);if(d<10&&!isBuilding([x,z])&&!isWater([x,z]))options.push({x,z,d,heading:Math.atan2(dx,dz),path:r.path});}
  options.sort((a,b)=>(a.d+(a.path?0:2))-(b.d+(b.path?0:2)));
  const best=options[0];if(!best)throw Error(UI.candidateError);return best;
}
