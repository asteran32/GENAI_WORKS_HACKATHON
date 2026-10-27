import * as THREE from './vendor/three.module.js';

// Shared façade materials, environment lighting and footprint-based occlusion.
export function footprint(width, depth, type = 'rect') {
  const w = width / 2, d = depth / 2, c = Math.min(width, depth) * .15;
  if (type === 'chamfer') return [[-w+c,-d],[w-c,-d],[w,-d+c],[w,d-c],[w-c,d],[-w+c,d],[-w,d-c],[-w,-d+c]];
  if (type === 'L') return [[-w,-d],[w,-d],[w,-d*.08],[w*.05,-d*.08],[w*.05,d],[-w,d]];
  if (type === 'round') {
    const points = [], radius = Math.min(width,depth) * .27;
    for (const [cx,cz,start] of [[w-radius,-d+radius,-Math.PI/2],[w-radius,d-radius,0],[-w+radius,d-radius,Math.PI/2],[-w+radius,-d+radius,Math.PI]]) {
      for (let j=0;j<=5;j++) {const a=start+j*Math.PI/10;points.push([cx+Math.cos(a)*radius,cz+Math.sin(a)*radius]);}
    }
    return points;
  }
  return [[-w,-d],[w,-d],[w,d],[-w,d]];
}

function inside(point, polygon) {
  let result=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i],b=polygon[j];
    if((a[1]>point.z)!==(b[1]>point.z) && point.x<(b[0]-a[0])*(point.z-a[1])/(b[1]-a[1])+a[0])result=!result;
  }
  return result;
}

// Exact footprint extrusion test after the existing bounding-box broad phase.
export function intersectsFootprintVolume(ray, volume) {
  if(volume.testRay)return volume.testRay(ray);
  const polygon=volume.footprint, minY=volume.min.y, maxY=volume.max.y;
  if(!polygon)return true;
  const rings=[polygon,...(volume.holes||[])],contains=p=>inside(p,polygon)&&!(volume.holes||[]).some(h=>inside(p,h));
  if(ray.origin.y>=minY && ray.origin.y<=maxY && contains(ray.origin))return true;
  if(Math.abs(ray.direction.y)>1e-8)for(const y of [minY,maxY]) {
    const t=(y-ray.origin.y)/ray.direction.y;
    if(t>=0 && contains(ray.at(t,new THREE.Vector3())))return true;
  }
  for(const ring of rings)for(let i=0;i<ring.length;i++) {
    const a=ring[i],b=ring[(i+1)%ring.length],ex=b[0]-a[0],ez=b[1]-a[1];
    const nx=ez,nz=-ex,denom=nx*ray.direction.x+nz*ray.direction.z;
    if(Math.abs(denom)<1e-8)continue;
    const t=(nx*(a[0]-ray.origin.x)+nz*(a[1]-ray.origin.z))/denom;
    if(t<0)continue;
    const y=ray.origin.y+t*ray.direction.y;if(y<minY-1e-6||y>maxY+1e-6)continue;
    const x=ray.origin.x+t*ray.direction.x,z=ray.origin.z+t*ray.direction.z;
    const u=((x-a[0])*ex+(z-a[1])*ez)/(ex*ex+ez*ez);
    if(u>=0 && u<=1)return true;
  }
  return false;
}

export function buildOcclusionIndex(volumes) {
  const hit=new THREE.Vector3();
  function build(items) {
    if(!items.length)return null;
    const bounds=new THREE.Box3();for(const item of items)bounds.union(item);
    if(items.length<=8)return {bounds,items};
    const axis=bounds.max.x-bounds.min.x>bounds.max.z-bounds.min.z?'x':'z';
    items.sort((a,b)=>(a.min[axis]+a.max[axis])-(b.min[axis]+b.max[axis]));const mid=items.length>>1;
    return {bounds,left:build(items.slice(0,mid)),right:build(items.slice(mid))};
  }
  const root=build([...volumes]);
  function visit(node,ray) {
    if(!node||!ray.intersectBox(node.bounds,hit))return false;
    if(node.items)return node.items.some(b=>ray.intersectBox(b,hit)&&intersectsFootprintVolume(ray,b));
    return visit(node.left,ray)||visit(node.right,ray);
  }
  return ray=>visit(root,ray);
}

const palette = {
  blue: {wall:'#496575',frame:'#b8c3c4',glass:['#617e8d','#698693','#5c7888','#718d99'],floor:2.1,bay:1.7,glassWall:true},
  silver: {wall:'#95a4a8',frame:'#d0d6d3',glass:['#93a8ae','#859da5','#9bb0b5','#8ba2ab'],floor:2.2,bay:1.8,glassWall:true},
  bronze: {wall:'#6c6355',frame:'#b3a38a',glass:['#84877a','#7c8379','#8c9284','#768379'],floor:2.25,bay:1.7,glassWall:true},
  limestone: {wall:'#d7d1c2',frame:'#e5dfd0',glass:['#667c82','#829498','#546b76','#9eaaa6'],floor:2.7,bay:2.5},
  brick: {wall:'#ab8d79',frame:'#d3c3ac',glass:['#6b7d7d','#8d9992','#526870','#b3b8a5'],floor:2.6,bay:2.1},
  sandstone: {wall:'#d8c7a9',frame:'#eee0c6',glass:['#607a79','#8e9990','#526c72','#a4ad9b'],floor:2.9,bay:2.6,arched:true},
  concrete: {wall:'#c8ccca',frame:'#e3e5dc',glass:['#6c868f','#8ba0a6','#576f7b','#a6b5b4'],floor:2.45,bay:2.3}
};

function facadeMaterial(name, renderer) {
  const p=palette[name],canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const ctx=canvas.getContext('2d');ctx.fillStyle=p.wall;ctx.fillRect(0,0,256,256);
  for(let row=0;row<4;row++)for(let col=0;col<4;col++) {
    const x=col*64,y=row*64,index=(col*7+row*3)%4;
    if(p.glassWall){
      const gradient=ctx.createLinearGradient(x,y,x+60,y+64);gradient.addColorStop(0,p.glass[index]);gradient.addColorStop(1,p.glass[(index+1)%4]);
      ctx.fillStyle=gradient;ctx.fillRect(x+2,y+2,60,55);
      ctx.fillStyle='rgba(32,47,56,.20)';ctx.fillRect(x+2,y+43,60,15);
      if((row*3+col)%7===1){ctx.fillStyle='rgba(223,210,175,.32)';ctx.fillRect(x+3,y+3,58,19);}
      ctx.fillStyle=p.frame;ctx.fillRect(x,0,1.5,256);ctx.fillRect(x,y,64,1.5);ctx.fillRect(x,y+58,64,2);
      ctx.fillStyle='rgba(236,245,243,.16)';ctx.fillRect(x+4,y+3,2,39);
    }else{
      ctx.fillStyle='rgba(41,48,46,.20)';ctx.fillRect(x+12,y+10,42,45);
      ctx.fillStyle=p.frame;ctx.fillRect(x+11,y+8,42,44);
      ctx.fillStyle=p.glass[index];
      if(p.arched){ctx.beginPath();ctx.moveTo(x+17,y+49);ctx.lineTo(x+17,y+26);ctx.arc(x+32,y+26,15,Math.PI,0);ctx.lineTo(x+47,y+49);ctx.closePath();ctx.fill();}
      else ctx.fillRect(x+16,y+12,32,36);
      ctx.fillStyle=p.frame;ctx.fillRect(x+31,y+15,2,35);ctx.fillRect(x+15,y+30,34,2);
      ctx.fillStyle='rgba(255,255,255,.20)';ctx.fillRect(x+14,y+52,39,2);
      ctx.fillStyle='rgba(65,68,59,.13)';ctx.fillRect(x,y+62,64,1);
      if(name==='brick'){ctx.fillStyle='rgba(217,202,178,.25)';for(let yy=0;yy<64;yy+=8){ctx.fillRect(x,y+yy,64,.6);for(let xx=yy%16?0:8;xx<64;xx+=16)ctx.fillRect(x+xx,y+yy,.6,8);}}
    }
  }
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  return new THREE.MeshStandardMaterial({map,color:'#ffffff',roughness:p.glassWall?.29:.86,metalness:p.glassWall?.18:.015,envMapIntensity:p.glassWall?.7:.16});
}

export function createFacadeMaterials(renderer) {return Object.fromEntries(Object.keys(palette).map(name=>[name,facadeMaterial(name,renderer)]));}

export function architecturalEnvironment(renderer) {
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;const ctx=canvas.getContext('2d');
  const gradient=ctx.createLinearGradient(0,0,0,512);
  gradient.addColorStop(0,'#8aabc0');gradient.addColorStop(.42,'#d9e5e9');gradient.addColorStop(.5,'#f4eee1');gradient.addColorStop(.6,'#bdc4bb');gradient.addColorStop(1,'#87978f');ctx.fillStyle=gradient;ctx.fillRect(0,0,1024,512);
  const glow=ctx.createRadialGradient(260,165,0,260,165,150);glow.addColorStop(0,'rgba(255,250,232,.85)');glow.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,1024,512);
  // Faint skyline reflections add depth without a photographic texture treatment.
  for(let i=0;i<25;i++){ctx.fillStyle=i%2?'rgba(67,87,97,.11)':'rgba(244,241,225,.16)';ctx.fillRect(i*43,230+(i%3)*6,15+(i%4)*5,40+(i%5)*11);}
  const source=new THREE.CanvasTexture(canvas);source.mapping=THREE.EquirectangularReflectionMapping;source.colorSpace=THREE.SRGBColorSpace;
  const pmrem=new THREE.PMREMGenerator(renderer),target=pmrem.fromEquirectangular(source);source.dispose();pmrem.dispose();return target.texture;
}
