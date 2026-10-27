import * as THREE from './vendor/three.module.js';
import {project} from './gis-data.js';

export const OPERA={id:'opera',name:'Sydney Opera House',coordinates:[151.21516,-33.85712]};

// Replace only individual outlines on the Opera House site, never an entire merged tile feature.
export function isOperaFootprint(coordinates) {
  const points=coordinates[0],xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  return Math.min(...xs)>=151.21435&&Math.max(...xs)<=151.2160&&Math.min(...ys)>=-33.85805&&Math.max(...ys)<=-33.85620;
}

// An architectural interpretation: paired halls, overlapping pointed shells and a broad podium.
// Dimensions are in the map's 5 m units, with no enlargement relative to the surrounding city.
export function createOperaHouse(material) {
  const group=new THREE.Group();group.name='Sydney Opera House';
  const [x,z]=project(OPERA.coordinates);group.position.set(x,1.7,z);group.rotation.y=-.25;
  const shellMat=material('#fffaf0',{roughness:.46,metalness:.04,side:THREE.DoubleSide});
  const ribMat=material('#dddccf',{roughness:.8}),edgeMat=material('#f8f4e5',{roughness:.55});
  const glass=material('#547d85',{roughness:.23,metalness:.32,side:THREE.DoubleSide}),frame=material('#566964');
  const stone=material('#ccbea5'),step=material('#e1d5bd'),shadow=material('#8c8e81');
  const cube=new THREE.BoxGeometry(1,1,1),up=new THREE.Vector3(0,1,0);
  function mesh(geometry,mat,parent=group,occludes=true){const object=new THREE.Mesh(geometry,mat);object.castShadow=object.receiveShadow=true;object.userData.occludes=occludes;parent.add(object);return object;}
  function box(x,y,z,w,h,d,mat,parent=group){const object=mesh(cube,mat,parent);object.position.set(x,y,z);object.scale.set(w,h,d);return object;}
  function line(points,r,mat,parent=group){return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),Math.max(16,points.length*2),r,5,false),mat,parent,false);}
  function slab(points,y,height,mat){
    const shape=new THREE.Shape();points.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
    const object=mesh(new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false}),mat);object.rotation.x=-Math.PI/2;object.position.y=y;return object;
  }
  const podium=[[-12.4,15.8],[-12.4,-9],[-9.5,-15.7],[-4,-18.2],[7.6,-16.6],[11.8,-8],[12.2,11.7],[8.5,16.3]];
  slab(podium,0,1.6,stone);slab(podium.map(([x,z])=>[x*.99,z*.99]),1.6,.14,step);
  // The dark inset under the roof reads as foyers rather than a solid white block.
  box(-4.9,2.35,-1,8.8,1.3,26,shadow);box(4.1,2.35,1.3,8,1.3,23,shadow);
  for(let i=0;i<14;i++)box(-.8,.06+i*.115,20.9-i*.43,19.8,.12,.65,i%3===0?stone:step);
  for(const side of [-1,1])box(side*10.6,.7,17.8,.28,1.4,6.7,stone);

  function sail(cx,cz,length,width,height,rotation=0){
    const roof=new THREE.Group();roof.position.set(cx,2.9,cz);roof.rotation.y=rotation;group.add(roof);
    const point=(u,v)=>{
      const growth=Math.sin(u*Math.PI/2),arch=Math.pow(Math.max(0,1-Math.pow(Math.abs(v),1.2)),.72);
      return new THREE.Vector3(width*v*Math.pow(growth,.82),height*Math.pow(growth,.94)*arch,length*(.5-u)-length*.16*arch*Math.pow(u,1.8));
    };
    const positions=[],uv=[],indices=[],rows=28,cols=36;
    for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){const p=point(j/rows,i/cols*2-1);positions.push(...p.toArray());uv.push(i/cols,j/rows);}
    for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const a=j*(cols+1)+i,b=a+cols+1;indices.push(a,b,a+1,b,b+1,a+1);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();mesh(geometry,shellMat,roof);
    // Fine radial seams and a crisp front lip retain the white-tiled sail silhouette at distance.
    for(let i=1;i<14;i++){const v=i/14*2-1,points=[];for(let j=1;j<=22;j++){const p=point(j/22,v);p.y+=.018;points.push(p);}line(points,.018,ribMat,roof);}
    const edge=[];for(let i=0;i<=48;i++)edge.push(point(1,i/48*2-1));line(edge,.055,edgeMat,roof);
    for(let j=5;j<28;j+=4){const points=[];for(let i=0;i<=30;i++){const p=point(j/28,i/30*2-1);p.y+=.012;points.push(p);}line(points,.009,ribMat,roof);}
    const glazing=[],triangles=[];
    for(let i=0;i<=cols;i++){const p=point(.985,i/cols*2-1);glazing.push(p.x,0,p.z+.15,p.x,p.y*.97,p.z+.15);if(i<cols){const a=i*2;triangles.push(a,a+2,a+1,a+1,a+2,a+3);}}
    const front=new THREE.BufferGeometry();front.setAttribute('position',new THREE.Float32BufferAttribute(glazing,3));front.setIndex(triangles);front.computeVertexNormals();mesh(front,glass,roof);
    for(let i=1;i<10;i++){const p=point(.985,i/10*2-1);line([new THREE.Vector3(p.x,0,p.z+.1),new THREE.Vector3(p.x,p.y*.97,p.z+.1)],.025,frame,roof);}
    return roof;
  }
  // Western concert hall, eastern opera hall, and the smaller southern restaurant shells.
  sail(-4.8,-8.0,13.3,4.55,9.0);
  sail(-4.8,.3,14.4,4.9,10.5);
  sail(-4.8,7.5,10.6,4.0,6.5,Math.PI);
  sail(4.2,-5.8,11.5,3.9,7.4);
  sail(4.2,1.4,12.0,4.25,8.5);
  sail(4.2,7.8,9.4,3.5,5.5,Math.PI);
  sail(4.0,13.0,6.3,2.65,3.7,Math.PI);
  group.updateMatrixWorld(true);
  return group;
}

export function operaOccluders(group) {
  const volumes=[],caster=new THREE.Raycaster(),hits=[];
  group.updateMatrixWorld(true);
  group.traverse(object=>{
    if(!object.isMesh||!object.userData.occludes)return;
    // Freeze world geometry before the display meshes are merged by material.
    const geometry=object.geometry.clone().applyMatrix4(object.matrixWorld);geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const proxy=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));proxy.updateMatrixWorld();
    const bounds=geometry.boundingBox.clone();bounds.testRay=ray=>{caster.ray.copy(ray);hits.length=0;proxy.raycast(caster,hits);return hits.length>0;};volumes.push(bounds);
  });
  return volumes;
}
