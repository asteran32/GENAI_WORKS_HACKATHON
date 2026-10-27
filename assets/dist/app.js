import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildPedestrianCrowd } from './pedestrians.js';
import { architecturalEnvironment, buildOcclusionIndex } from './architecture.js';
import { CITY, loadCityData, unproject, project } from './gis-data.js';
import { addGISCity, locateCandidate } from './gis-city.js';
import { OPERA } from './opera-house.js';
import { clamp, ambientTemperature, streetTemperature, footfallAtHour, coolingRadius, coolingDrop, coolingPriority, scenarioTemperature } from './simulation.js';

import { createCameraTween, advanceCameraTween } from './camera.js';
import { UI, number, decimal, applyStrings } from './i18n.js';
import { DEFAULT_DATE, validScenarioDate, formatHour, formatScenarioDate, solarAt, naturalComparisonHour } from './scenario-time.js';
import {subscribeFogPlan} from './fog-plan.js';

applyStrings();
document.querySelectorAll('.retry-button').forEach(button => button.addEventListener('click', () => location.reload()));
const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = () => innerWidth <= 700;
const state = { date: DEFAULT_DATE, hour: 15, trees: true, shadows: true, cloudy: false, playing: false, top: false, selected: 'townhall', installed: new Set(['townhall']), power: 65, after: true, heat: true, people: true };
let activeFogPlan=null,sampleInstalled=null;
const host = $('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
} catch (error) {
  $('loading').hidden = true;
  $('webgl-error').hidden = false;
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile() ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
host.prepend(renderer.domElement);
renderer.domElement.setAttribute('aria-label', UI.canvas);
renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  $('webgl-error').hidden = false;
});

const scene = new THREE.Scene();
scene.background = new THREE.Color('#edf3f1');
scene.fog = new THREE.Fog('#edf3f1', 1300, 2200);
const perspectiveCamera = new THREE.PerspectiveCamera(32, 1, .5, 1800);
const planCamera = new THREE.OrthographicCamera(-200, 200, 150, -150, .1, 1800);
let camera = perspectiveCamera;
const cameraHome = new THREE.Vector3(470, 520, 680);
const targetHome = new THREE.Vector3(8, 8, 24);
camera.position.copy(cameraHome);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(targetHome);
controls.enableDamping = true;
controls.dampingFactor = .065;
controls.minZoom = .65;
controls.maxZoom = 6;
controls.minDistance = 60;
controls.maxDistance = 1600;
controls.maxPolarAngle = Math.PI / 2.3;
controls.minPolarAngle = .14;
controls.enablePan = true;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
scene.environment = architecturalEnvironment(renderer);
scene.environmentIntensity = .38;
const hemi = new THREE.HemisphereLight('#eef5fb', '#b5b8aa', 1.3);
scene.add(hemi);
const ambient = new THREE.AmbientLight('#eaf1f0', .24);
scene.add(ambient);
const sun = new THREE.DirectionalLight('#fff6e1', 3.25);
sun.castShadow = true;
sun.shadow.mapSize.set(mobile() ? 2048 : 4096, mobile() ? 2048 : 4096);
Object.assign(sun.shadow.camera, { left: -400, right: 400, top: 400, bottom: -400, near: 1, far: 1200 });
sun.shadow.normalBias = .45;
sun.shadow.bias = -.0003;
sun.shadow.radius = 4;
sun.target.position.set(0, 0, 0);
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight('#d6eae7', .35);
fill.position.set(-150, 120, 80);
scene.add(fill);

const materials = {};
function mat(color, options = {}) {
  const key = color + JSON.stringify(options);
  return materials[key] ||= new THREE.MeshStandardMaterial({ color, roughness: .8, metalness: 0, ...options });
}
const M = {
  white: mat('#f9faf3'), stone: mat('#e9e9df'), roof: mat('#cfddd4'), glass: mat('#8fafad', { roughness: .35, metalness: .12 }),
  glassDark: mat('#83aaa9', { roughness: .4, metalness: .12 }), road: mat('#c8cfd1'), line: mat('#f8fcf7'),
  grass: mat('#b7c8a8'), grassLight: mat('#ccd7ba'), trunk: mat('#8a7a60'), bark: mat('#89765d'),
  mint: mat('#769f84'), mintLight: mat('#9ab79a'), mintDark: mat('#638d76'), water: mat('#80b5bd', { roughness: .35, metalness: .08 }),
  sand: mat('#e4dfcd'), teal: mat('#219687'), dark: mat('#466d66'), gold: mat('#d5c38e')
};
const world = new THREE.Group();
scene.add(world);
const buildings = new THREE.Group(); world.add(buildings);
const trees = new THREE.Group(); world.add(trees);
const obstacles = [], canopyBounds = [], labels = [];
let labelSafe={left:0,right:0,top:0,bottom:0,weatherLeft:Infinity,weatherBottom:0};
let seed = 1249;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
function box(x, y, z, w, h, d, material, parent = world, shadow = true) {
  const mesh = new THREE.Mesh(boxGeo, material);
  mesh.position.set(x, y, z); mesh.scale.set(w, h, d);
  mesh.castShadow = shadow; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function cylinder(x,y,z,r1,r2,h,material,parent=world,segments=12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,segments),material);
  mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function flatShape(points,y,material,parent=world) {
  const shape = new THREE.Shape();points.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape),material);mesh.rotation.x=-Math.PI/2;mesh.position.y=y;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function rod(a,b,r,material,parent=world) {
  const d = new THREE.Vector3().subVectors(b,a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r,r,d.length(),7),material);
  m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());m.castShadow=true;parent.add(m);return m;
}
const v3=(x,y,z)=>new THREE.Vector3(x,y,z);
function label(text,x,y,z,type='landmark',prefix='',focusId=null) {
  const el=document.createElement('div');el.className='map-label '+type;
  const span=document.createElement(focusId?'button':'span');span.className='label-text';
  if(focusId){el.classList.add('focusable');span.id='map-focus-'+focusId;span.setAttribute('aria-label',UI.focus(text));span.title=UI.focus(text);span.addEventListener('click',()=>focusPlace(focusId));}
  if(prefix){const b=document.createElement('b');b.textContent=prefix;span.append(b);}
  span.append(document.createTextNode(text));el.append(span);
  if(type==='endpoint'){const stem=document.createElement('span');stem.className='label-stem';el.append(stem);}
  $('labels').append(el);labels.push({el,position:v3(x,y,z),type});
}

// OpenFreeMap geometry in local, metrically scaled Web Mercator coordinates.
const treeGeo=new THREE.IcosahedronGeometry(1,2);
const treeVariants=[M.mint,M.mintLight,M.mintDark];
function tree(x,z,scale=1,type=0){
  const g=new THREE.Group();g.position.set(x,1.7,z);g.rotation.y=rnd()*Math.PI;trees.add(g);
  cylinder(0,2.4*scale,0,.3*scale,.45*scale,4.8*scale,M.trunk,g,7);
  if(type===1){
    for(let j=0;j<3;j++){
      const crown=new THREE.Mesh(new THREE.ConeGeometry((2.7-j*.55)*scale,4.7*scale,8),treeVariants[j%3]);crown.position.y=(4.3+j*1.8)*scale;crown.castShadow=true;crown.receiveShadow=true;g.add(crown);
    }
    canopyBounds.push({center:v3(x,8*scale,z),radius:2.6*scale,kind:'tree'});
  }else{
    const crown=new THREE.Mesh(treeGeo,treeVariants[Math.floor(rnd()*3)]);crown.position.y=6*scale;crown.scale.set(3.3*scale,3.6*scale,3.1*scale);crown.castShadow=true;crown.receiveShadow=true;g.add(crown);
    const bud=new THREE.Mesh(treeGeo,M.mintLight);bud.position.set(1.45*scale,6.8*scale,-.7*scale);bud.scale.setScalar(2.2*scale);bud.castShadow=true;g.add(bud);
    canopyBounds.push({center:v3(x,1.7+6*scale,z),radius:3.2*scale,kind:'tree'});
  }
}

let mapSource;
try { mapSource=await loadCityData({onStatus:message=>{$('loading').querySelector('strong').textContent=message;}}); }
catch(error){
  const loading=$('loading');loading.replaceChildren();loading.classList.add('failed');
  const message=document.createElement('strong');message.textContent=UI.mapError;
  const retry=document.createElement('button');retry.textContent=UI.retry;retry.addEventListener('click',()=>location.reload());
  loading.append(message,retry);throw error;
}
const geography=addGISCity({data:mapSource.data,world,buildings,renderer,material:mat,box,obstacles,tree,label});
const occludesBuilding=buildOcclusionIndex(obstacles);
const sourceText=mapSource.mode==='live'?UI.liveMap:UI.cachedMap;
$('map-source').textContent=sourceText;
document.querySelector('.map-live-dot').classList.toggle('cached',mapSource.mode!=='live');
$('map-source').title=UI.sourceSummary(number(geography.buildingParts),mapSource.data.metadata.retrievedAt?.slice(0,10)||'');
$('map-detail').textContent=UI.sourceDetail(sourceText,number(geography.buildingParts),number(geography.fallbackHeights));
const sunDirection=new THREE.Vector3(),solarCache=new Map();
function solar(hour){
  const key=state.date+':'+Math.round(hour*600);
  if(!solarCache.has(key)){
    const result=solarAt(hour,state.date);
    if(solarCache.size>1200)solarCache.clear();
    solarCache.set(key,{direction:v3(...result.direction).normalize(),altitude:result.altitude});
  }
  return solarCache.get(key);
}

// Real map positions snapped to nearby mapped surface paths; footfall remains an example input.
const sites = [
  { id:'quay', name:'Circular Quay', coordinates:[151.21035,-33.86120], footfall:2200, heatOffset:.35 },
  { id:'martin', name:'Martin Place', coordinates:[151.20980,-33.86748], footfall:2900, heatOffset:1.25 },
  { id:'townhall', name:'Town Hall', coordinates:[151.20682,-33.87318], footfall:2400, heatOffset:.65 }
].map(site=>({...site,...locateCandidate(site.coordinates,geography.roadPaths,geography.isBuilding,geography.isWater)}));
const ray=new THREE.Ray(),hit=new THREE.Vector3(),testSphere=new THREE.Sphere();
function shaded(p,direction=sunDirection){
  ray.set(p,direction);
  if(occludesBuilding(ray))return true;
  for(const b of canopyBounds){if(b.kind==='tree'&&!state.trees)continue;testSphere.set(b.center,b.radius);if(ray.intersectsSphere(testSphere))return true;}
  return false;
}
function shadeFraction(x,z,hour){
  const direction=solar(hour).direction;
  let count=0;
  for(const [dx,dz] of [[0,0],[2,0],[-2,0],[0,2],[0,-2]])if(shaded(v3(x+dx,2.1,z+dz),direction))count++;
  return count/5;
}
function baselineAt(site,hour){
  const shade=(shadeFraction(site.x,site.z,hour)*.5+shadeFraction(site.x,site.z,hour-.3)*.3+shadeFraction(site.x,site.z,hour-.6)*.2);
  return streetTemperature(hour,shade,site.heatOffset,state.cloudy);
}
function nextShade(site){
  if(shadeFraction(site.x,site.z,state.hour)>=.6)return {label:UI.alreadyShaded,minutes:0};
  for(let h=Math.ceil(state.hour*12)/12;h+1/6<=18+1e-6;h+=1/12){
    if(shadeFraction(site.x,site.z,h)>=.6&&shadeFraction(site.x,site.z,h+1/6)>=.6){
      return {label:formatHour(h,state.date),minutes:Math.round((h-state.hour)*60)};
    }
  }
  return {label:UI.noShade,minutes:120};
}
const humidity=()=>state.cloudy?68:42;
function dropAt(x,z,temperature){
  const drops=sites.filter(s=>state.installed.has(s.id)).map(s=>coolingDrop({power:state.power,humidity:humidity(),windKmh:12,temperature,distanceMeters:Math.hypot(x-s.x,z-s.z)*CITY.metersPerUnit}));
  return temperature-scenarioTemperature(temperature,drops,true);
}
const fogGroup=new THREE.Group();world.add(fogGroup);
const peopleGroup=new THREE.Group();world.add(peopleGroup);
const stationViews=new Map();
const particleTexture=(()=>{
  const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d');
  const g=ctx.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.22,'rgba(255,255,255,.7)');g.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);
})();
for(const s of sites){
  const group=new THREE.Group();group.position.set(s.x,1.8,s.z);fogGroup.add(group);
  const halo=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({map:particleTexture,color:'#40b9b5',transparent:true,opacity:.6,depthWrite:false}));
  halo.rotation.x=-Math.PI/2;halo.position.y=.18;group.add(halo);
  const ring=new THREE.Mesh(new THREE.RingGeometry(.97,1,64),new THREE.MeshBasicMaterial({color:'#48a99b',transparent:true,opacity:.55,depthWrite:false,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.2;group.add(ring);
  const hardware=new THREE.Group();hardware.scale.setScalar(.22);group.add(hardware);
  cylinder(0,.3,0,1,1.2,.6,M.white,hardware,16);cylinder(0,2.8,0,.16,.2,5,M.dark,hardware,8);cylinder(0,5.2,0,.65,.4,.4,M.teal,hardware,12);
  for(let i=0;i<4;i++){const a=i*Math.PI/2;rod(v3(0,5.15,0),v3(Math.cos(a)*1.1,5.35,Math.sin(a)*1.1),.11,M.white,hardware);}
  const count=130,coords=new Float32Array(count*3),seeds=Array.from({length:count},()=>({a:rnd()*Math.PI*2,r:rnd(),phase:rnd(),speed:.12+rnd()*.2}));
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(coords,3));
  const particles=new THREE.Points(geo,new THREE.PointsMaterial({color:'#c8f5ee',size:.85,map:particleTexture,transparent:true,opacity:.5,depthWrite:false,sizeAttenuation:true}));particles.frustumCulled=false;geo.boundingSphere=new THREE.Sphere(v3(0,3,0),20);group.add(particles);
  const marker=document.createElement('div');marker.className='map-label station';
  const button=document.createElement('button');button.className='station-label';button.id='map-focus-'+s.id;button.title=UI.focus(s.name);button.addEventListener('click',()=>selectSite(s.id));marker.append(button);
  const stem=document.createElement('span');stem.className='label-stem';marker.append(stem);$('labels').append(marker);
  labels.push({el:marker,position:v3(s.x,7,s.z),type:'station'});
  const row=document.createElement('button');row.className='candidate-row';row.id='candidate-'+s.id;row.title=UI.focus(s.name);row.setAttribute('aria-label',UI.candidate(s.name));row.addEventListener('click',()=>selectSite(s.id));
  const positions=geography.heatPoints.filter(p=>Math.hypot(p.x-s.x,p.z-s.z)<14);
  const people=buildPedestrianCrowd(s,{random:rnd,material:mat,positions,sizeScale:.13,metersPerUnit:CITY.metersPerUnit,isWalkable:point=>!geography.isBuilding(point)&&!geography.isWater(point)});peopleGroup.add(people);
  stationViews.set(s.id,{group,halo,ring,hardware,particles,coords,seeds,marker,button,row,people});
}
// Translucent street-temperature tiles; avoid obscuring buildings with a full-screen heat overlay.
const heatPoints=geography.heatPoints;
const heatMesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({transparent:true,opacity:.62,depthWrite:false,side:THREE.DoubleSide,toneMapped:false}),heatPoints.length);
const heatDummy=new THREE.Object3D();
heatPoints.forEach((p,i)=>{heatDummy.position.set(p.x,1.76,p.z);heatDummy.rotation.set(-Math.PI/2,0,-p.angle);heatDummy.scale.set(p.length,p.width,1);heatDummy.updateMatrix();heatMesh.setMatrixAt(i,heatDummy.matrix);});world.add(heatMesh);
const temperatureColors=[
  [27,new THREE.Color('#47b4b7')],
  [30,new THREE.Color('#efce8d')],
  [32,new THREE.Color('#ee906f')],
  [34,new THREE.Color('#d65752')],
  [36,new THREE.Color('#bb333d')]
];
const color=new THREE.Color();
function temperatureColor(temperature){
  const value=clamp(temperature,27,36);
  for(let i=1;i<temperatureColors.length;i++){
    const [upper,c1]=temperatureColors[i],[lower,c0]=temperatureColors[i-1];
    if(value<=upper)return color.copy(c0).lerp(c1,(value-lower)/(upper-lower));
  }
  return color.copy(temperatureColors.at(-1)[1]);
}
let siteResults=[];
function renderScenario(){
  siteResults=sites.map(s=>{
    const before=baselineAt(s,state.hour),shade=nextShade(s),footfall=footfallAtHour(s.footfall,state.hour);
    const after=before-dropAt(s.x,s.z,before);
    return {...s,before,after,shade,footfall,score:coolingPriority({temperature:before,footfall,minutesToShade:shade.minutes}),natural:baselineAt(s,naturalComparisonHour(state.hour))-before};
  }).sort((a,b)=>b.score-a.score);
  for(let i=0;i<siteResults.length;i++){
    const r=siteResults[i],view=stationViews.get(r.id),installed=state.installed.has(r.id),selected=state.selected===r.id;
    view.row.setAttribute('aria-label',UI.candidateSummary(r.name,r.score,number(r.footfall),decimal(r.before)));
    view.row.style.order=i;view.row.classList.toggle('selected',selected);view.row.setAttribute('aria-pressed',String(selected));
    view.row.innerHTML=`<span class="candidate-rank">0${i+1}</span><span class="candidate-name"><strong>${r.name}</strong><small>${r.before.toFixed(1)}°C <i>·</i> ${number(r.footfall)} people/hour</small></span><span class="candidate-score">${r.score}</span>`;
    view.button.innerHTML=`<i class="station-dot ${installed?'installed':''}"></i><span>${r.name}</span><strong>${(state.after?r.after:r.before).toFixed(1)}°</strong>`;
    view.button.setAttribute('aria-label',UI.marker(r.name,installed,decimal(state.after?r.after:r.before)));
    view.marker.classList.toggle('selected',selected);
    const active=installed&&state.after;
    view.button.setAttribute('aria-pressed',String(selected));
    view.hardware.visible=active;view.particles.visible=active&&state.power>0;view.halo.visible=active&&state.power>0;view.ring.visible=state.power>0&&(active||selected);
    const radius=coolingRadius(state.power)/5;view.halo.scale.set(radius*1.5,radius*1.5,1);view.ring.scale.setScalar(radius);
    view.ring.material.color.set(active?'#26998e':'#c9a46b');view.ring.material.opacity=selected?.7:.35;
    view.particles.material.opacity=.26+state.power*.004;view.people.visible=state.people;
    view.people.userData.setVisibleCount(Math.round(r.footfall/85));
  }
  const r=siteResults.find(s=>s.id===state.selected),installed=state.installed.has(r.id),delta=r.before-r.after;
  $('selected-site').textContent=r.name;$('site-state').textContent=installed?UI.installed:UI.uninstalled;$('site-state').classList.toggle('installed',installed);
  $('footfall').textContent=number(r.footfall);$('shade-onset').textContent=r.shade.label;
  $('shade-wait').textContent=r.shade.minutes===0?UI.shadedAround:r.shade.label===UI.noShade?UI.noShadeUntil:UI.shadeWait(r.shade.minutes);
  $('natural-label').textContent=state.hour>17?UI.naturalUntil(formatHour(18,state.date)):UI.naturalChange;
  $('natural-change').textContent=`${r.natural>=0?'+':'−'}${Math.abs(r.natural).toFixed(1)}°C`;
  $('temp-before').textContent=r.before.toFixed(1);$('temp-after').textContent=r.after.toFixed(1);
  $('cooling-delta').textContent=delta>.05?`−${delta.toFixed(1)}°C`:UI.noChange;$('cooling-delta').classList.toggle('no-change',delta<.05);
  $('power-value').textContent=state.power+'%';$('fog-radius').textContent=Math.round(coolingRadius(state.power))+' m';$('install-count').textContent=state.installed.size+' / 3';
  $('install-button').querySelector('span').textContent=installed?UI.remove:UI.install;$('install-button').classList.toggle('is-installed',installed);
  $('power-slider').setAttribute('aria-valuetext',UI.powerValue(state.power));
  const direction=solar(state.hour).direction;
  for(let i=0;i<heatPoints.length;i++){
    const p=heatPoints[i],shade=shaded(v3(p.x,2.1,p.z),direction)?1:0;
    const baseline=streetTemperature(state.hour,shade,.45,state.cloudy),drop=state.after?dropAt(p.x,p.z,baseline):0;
    // Common fixed color scale in both comparison modes (27–36 °C).
    heatMesh.setColorAt(i,temperatureColor(baseline-drop));
  }
  heatMesh.instanceColor.needsUpdate=true;heatMesh.visible=state.heat;
}
function selectSite(id){
  state.selected=id;renderScenario();
  focusPlace(id);
}
function focusPlace(id){
  state.focusedPlace=id;
  const allocation=activeFogPlan?.allocations.find(row=>'plan:'+row.allocation_id===id);
  const point=allocation?.position?project([allocation.position.longitude,allocation.position.latitude]):null;
  const [ox,oz]=project(OPERA.coordinates),place=point?{x:point[0],z:point[1],name:allocation.location}:id==='opera'?{x:ox,z:oz,name:OPERA.name}:sites.find(s=>s.id===id);
  if(!place)return;
  controls.enableDamping=false;controls.update();controls.enableDamping=true;
  const target=v3(place.x,id==='opera'?6:2,place.z);
  if(state.top)moveCamera(v3(place.x,780,place.z+2),target,id==='opera'?5.2:3.5,900);
  else {
    const offset=id==='opera'?v3(56,82,100):id==='quay'?v3(20,190,-170):v3(-55,270,-70);
    moveCamera(target.clone().add(offset),target,id==='opera'?(mobile()?2:1.5):(mobile()?2.25:2.0),1000);
  }
  $('scene').setAttribute('aria-label',UI.selectedMap(place.name));
}
function animateMist(elapsed){
  for(const site of sites){const view=stationViews.get(site.id);if(!view.particles.visible)continue;
    const radius=coolingRadius(state.power)/5;
    for(let i=0;i<view.seeds.length;i++){
      const s=view.seeds[i],life=((s.phase+(reducedMotion?0:elapsed*s.speed))%1+1)%1,r=radius*Math.sqrt(life)*(.4+s.r*.6);
      view.coords[i*3]=Math.cos(s.a)*r-life*1.8;view.coords[i*3+1]=1.1+Math.sin(life*Math.PI)*.5-life*.8;view.coords[i*3+2]=Math.sin(s.a)*r+life*1.8;
    }
    view.particles.geometry.attributes.position.needsUpdate=true;
  }
}

// Bake static facade details by material, keeping the city inexpensive to draw.
function bakeStatic(root,exclude){
  scene.updateMatrixWorld(true);
  const buckets=new Map(),originals=[];
  function visit(object){
    if(exclude.has(object))return;
    if(object.isMesh){
      const key=object.material.uuid+'_'+object.castShadow+'_'+object.receiveShadow;
      if(!buckets.has(key))buckets.set(key,{material:object.material,cast:object.castShadow,receive:object.receiveShadow,positions:[],normals:[],uvs:[],count:0});
      const b=buckets.get(key),geo=(object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone()).applyMatrix4(object.matrixWorld);
      b.positions.push(geo.attributes.position.array);b.normals.push(geo.attributes.normal.array);b.uvs.push(geo.attributes.uv?.array??new Float32Array(geo.attributes.position.count*2));b.count+=geo.attributes.position.array.length;originals.push(object);geo.dispose();
    }
    for(const child of object.children)visit(child);
  }
  visit(root);
  for(const object of originals)object.removeFromParent();
  for(const b of buckets.values()){
    const p=new Float32Array(b.count),n=new Float32Array(b.count),uv=new Float32Array(b.count/3*2);let offset=0,uvOffset=0;
    b.positions.forEach((a,i)=>{p.set(a,offset);n.set(b.normals[i],offset);uv.set(b.uvs[i],uvOffset);offset+=a.length;uvOffset+=b.uvs[i].length;});
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(p,3));geo.setAttribute('normal',new THREE.BufferAttribute(n,3));geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));geo.computeBoundingSphere();
    const mesh=new THREE.Mesh(geo,b.material);mesh.castShadow=b.cast;mesh.receiveShadow=b.receive;root.add(mesh);
  }
}
bakeStatic(world,new Set([trees,fogGroup,peopleGroup,heatMesh]));
bakeStatic(trees,new Set());
let lastScenarioHour=-100;
function updateSun(force=false){
  const s=solar(state.hour);sunDirection.copy(s.direction);sun.position.copy(s.direction).multiplyScalar(600);
  const evening=Math.max(0,(state.hour-16)/2);
  sun.color.set(state.cloudy?'#eff6ff':'#fff6df').lerp(new THREE.Color('#f4d0a0'),evening*.48);
  sun.intensity=state.cloudy?.75:2.6;
  hemi.intensity=state.cloudy?1.9:1.3;
  $('sun-altitude').textContent=Math.round(s.altitude)+'°';
  const time=formatHour(state.hour,state.date);
  $('time-display').textContent=time;
  $('scenario-date-display').textContent=formatScenarioDate(state.date);
  $('time-slider').setAttribute('aria-valuetext',`${time}, ${formatScenarioDate(state.date)}`);
  const percentage=(state.hour-8)/10*100;
  $('time-slider').style.background=`linear-gradient(to right,#a8ceba 0%,#168b7b ${percentage}%,#e3ebe5 ${percentage}%)`;
  document.querySelector('.sun-arc>span').style.left=`calc(${percentage}% - 10px)`;
  const temperature=Math.round(ambientTemperature(state.hour,state.cloudy));
  $('temperature').textContent=temperature;$('humidity-value').textContent=humidity();
  if(force||Math.abs(state.hour-lastScenarioHour)>.08){renderScenario();lastScenarioHour=state.hour;}
}

let cameraTween=null;
function moveCamera(position,target,zoom=1,duration=1000){
  cameraTween=createCameraTween(camera,controls,position,target,zoom,duration,reducedMotion);
}
function activateCamera(plan){
  const next=plan?planCamera:perspectiveCamera;
  if(camera===next)return;
  cameraTween=null;next.position.copy(camera.position);next.quaternion.copy(camera.quaternion);next.zoom=1;
  camera=next;controls.object=camera;controls.enableRotate=!plan;controls.minPolarAngle=plan?0:.14;controls.maxPolarAngle=plan?0:Math.PI/2.3;resize();controls.update();
}
function fitHome(animated=true){
  state.focusedPlace=null;
  $('scene').setAttribute('aria-label',UI.scene);
  activateCamera(false);
  const p=cameraHome.clone(),t=targetHome.clone();
  if(mobile()){t.set(8,3,-16);p.copy(cameraHome);}
  const zoom=mobile()?.80:1.23;
  if(animated)moveCamera(p,t,zoom);else{camera.position.copy(p);controls.target.copy(t);camera.zoom=zoom;camera.updateProjectionMatrix();}
  state.top=false;$('top-view').textContent='2D';$('top-view').setAttribute('aria-label',UI.top);$('top-view').title=UI.top;$('top-view').setAttribute('aria-pressed','false');
}
function resize(){
  const w=host.clientWidth,h=host.clientHeight,aspect=w/h;
  const view=mobile()?650/aspect:Math.max(540,690/aspect);
  planCamera.left=-view*aspect/2;planCamera.right=view*aspect/2;planCamera.top=view/2;planCamera.bottom=-view/2;
  perspectiveCamera.aspect=aspect;
  perspectiveCamera.fov=THREE.MathUtils.radToDeg(2*Math.atan(view/(2*cameraHome.distanceTo(targetHome))));
  for(const c of [planCamera,perspectiveCamera]){
    c.setViewOffset(w,h,mobile()?0:-w*.12,mobile()?h*.13:-h*.02,w,h);c.updateProjectionMatrix();
  }
  renderer.setSize(w,h);
  const hostRect=host.getBoundingClientRect(),panel=document.querySelector('.cooling-panel').getBoundingClientRect(),toolsRect=document.querySelector('.map-controls').getBoundingClientRect(),timeline=document.querySelector('.timeline').getBoundingClientRect(),weather=document.querySelector('.weather').getBoundingClientRect();
  labelSafe={left:mobile()?12:panel.right-hostRect.left+12,right:mobile()?w-12:toolsRect.left-hostRect.left-12,top:mobile()?182:115,bottom:(mobile()?panel.top:timeline.top)-hostRect.top-12,weatherLeft:weather.left-hostRect.left,weatherBottom:weather.bottom-hostRect.top+10};
}
const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);resizeObserver.observe(document.querySelector('.cooling-panel'));
fitHome(false);resize();updateSun(true);

function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('show'),3200);}
function setPlaying(value){state.playing=value;$('play-time').setAttribute('aria-pressed',String(value));$('play-time').setAttribute('aria-label',value?UI.pause:UI.play);$('play-time').innerHTML=value?'<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>':'<svg viewBox="0 0 24 24"><path d="m9 5 10 7-10 7Z"/></svg>';}
$('time-slider').addEventListener('input',e=>{setPlaying(false);state.hour=Number(e.target.value);updateSun(true);});
$('play-time').addEventListener('click',()=>{setPlaying(!state.playing);if(state.playing&&state.hour>=17.95){state.hour=8;updateSun(true);}});
for(const after of [false,true])$('view-'+(after?'after':'before')).addEventListener('click',()=>{
  state.after=after;
  for(const v of [false,true]){const b=$('view-'+(v?'after':'before'));b.classList.toggle('selected',v===after);b.setAttribute('aria-pressed',String(v===after));}
  renderScenario();toast(after?UI.afterToast:UI.beforeToast);
});
$('install-button').addEventListener('click',()=>{
  const id=state.selected;if(state.installed.has(id))state.installed.delete(id);else state.installed.add(id);
  renderScenario();toast(state.installed.has(id)?UI.installToast:UI.removeToast);
});
$('recommend-button').addEventListener('click',()=>{selectSite(siteResults[0].id);toast(UI.recommendToast);});
$('power-slider').addEventListener('input',e=>{state.power=Number(e.target.value);renderScenario();});
$('toggle-heat').addEventListener('click',()=>{state.heat=!state.heat;heatMesh.visible=state.heat;$('toggle-heat').classList.toggle('active',state.heat);$('toggle-heat').setAttribute('aria-pressed',String(state.heat));});
$('toggle-people').addEventListener('click',()=>{state.people=!state.people;peopleGroup.visible=state.people;$('toggle-people').classList.toggle('active',state.people);$('toggle-people').setAttribute('aria-pressed',String(state.people));});
$('toggle-trees').addEventListener('click',()=>{state.trees=!state.trees;trees.visible=state.trees;$('toggle-trees').classList.toggle('active',state.trees);$('toggle-trees').setAttribute('aria-pressed',String(state.trees));updateSun(true);toast(state.trees?UI.treesOn:UI.treesOff);});
$('toggle-shadows').addEventListener('click',()=>{state.shadows=!state.shadows;sun.castShadow=state.shadows;renderer.shadowMap.needsUpdate=true;$('toggle-shadows').classList.toggle('active',state.shadows);$('toggle-shadows').setAttribute('aria-pressed',String(state.shadows));toast(state.shadows?UI.shadowsOn:UI.shadowsOff);});
$('weather-toggle').addEventListener('click',()=>{
  state.cloudy=!state.cloudy;
  $('weather-icon').querySelector('use').setAttribute('href',state.cloudy?'#i-cloud':'#i-sun');
  $('weather-desc').textContent=state.cloudy?UI.cloudy:UI.clear;
  $('weather-toggle').querySelector('span').textContent=state.cloudy?UI.showClear:UI.showCloudy;
  $('weather-toggle').setAttribute('aria-label',state.cloudy?UI.setClear:UI.setCloudy);
  updateSun(true);toast(state.cloudy?UI.cloudyToast:UI.clearToast);
});
$('zoom-in').addEventListener('click',()=>{cameraTween=null;camera.zoom=Math.min(6,camera.zoom*1.25);camera.updateProjectionMatrix();});
$('zoom-out').addEventListener('click',()=>{cameraTween=null;camera.zoom=Math.max(.65,camera.zoom/1.25);camera.updateProjectionMatrix();});
$('reset-view').addEventListener('click',()=>{fitHome();toast(UI.resetToast);});
$('top-view').addEventListener('click',()=>{
  state.top=!state.top;
  const focused=state.focusedPlace;
  activateCamera(state.top);
  if(focused)focusPlace(focused);
  else if(state.top)moveCamera(v3(8,780,-10),v3(8,0,-12),mobile()?.8:1.05);
  else fitHome();
  $('top-view').textContent=state.top?'3D':'2D';$('top-view').setAttribute('aria-label',state.top?UI.return3d:UI.top);$('top-view').title=state.top?UI.return3d:UI.top;$('top-view').setAttribute('aria-pressed',String(state.top));
});
controls.addEventListener('start',()=>{cameraTween=null;});
// A short click on the mapped district also focuses it; dragging always remains an orbit gesture.
let pointerDown=null;
const pickRay=new THREE.Raycaster(),groundPlane=new THREE.Plane(v3(0,1,0),-1.8),pickedPoint=new THREE.Vector3();
renderer.domElement.addEventListener('pointerdown',event=>{pointerDown=event.isPrimary?{id:event.pointerId,x:event.clientX,y:event.clientY,time:performance.now()}:null;});
renderer.domElement.addEventListener('pointercancel',()=>{pointerDown=null;});
renderer.domElement.addEventListener('pointerup',event=>{
  if(!pointerDown||event.button!==0||pointerDown.id!==event.pointerId)return;
  const start=pointerDown;pointerDown=null;
  if(Math.hypot(event.clientX-start.x,event.clientY-start.y)>5||performance.now()-start.time>450)return;
  const rect=renderer.domElement.getBoundingClientRect();pickRay.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);
  if(!pickRay.ray.intersectPlane(groundPlane,pickedPoint))return;
  const proposals=activeFogPlan?.allocations.filter(row=>row.position&&row.units).map(row=>{const [x,z]=project([row.position.longitude,row.position.latitude]);return{id:'plan:'+row.allocation_id,x,z};});
  const [x,z]=project(OPERA.coordinates),places=[...(proposals||sites),{id:'opera',x,z}],nearest=places.map(p=>({...p,d:Math.hypot(p.x-pickedPoint.x,p.z-pickedPoint.z)})).sort((a,b)=>a.d-b.d)[0];
  if(nearest.d<(nearest.id==='opera'?25:18)){if(nearest.id.startsWith('plan:'))selectAllocation(nearest.id.slice(5));else if(nearest.id==='opera')focusPlace('opera');else selectSite(nearest.id);}
});
$('scenario-date').addEventListener('change',event=>{
  if(!validScenarioDate(event.target.value)||!event.target.checkValidity()){event.target.value=state.date;return;}
  state.date=event.target.value;solarCache.clear();updateSun(true);
});
$('inspector-toggle').addEventListener('click',()=>{
  const expanded=$('inspector-toggle').getAttribute('aria-expanded')!=='true';
  $('inspector-toggle').setAttribute('aria-expanded',String(expanded));
  $('inspector-toggle').setAttribute('aria-label',expanded?UI.collapseDetails:UI.expandDetails);
  document.querySelector('.cooling-panel').classList.toggle('expanded',expanded);resize();
});
const dialog=$('info-dialog');document.querySelectorAll('.info-open').forEach(b=>b.addEventListener('click',()=>dialog.showModal()));
$('close-info').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog){const rect=dialog.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)dialog.close();}});
// Render the city, cooling-fog particles and moving shadows.
let previous=performance.now(),elapsed=0,peopleElapsed=0,first=true;
const projected=new THREE.Vector3();
function animate(now){
  requestAnimationFrame(animate);
  if(document.hidden){previous=now;return;}
  const dt=Math.max(0,Math.min(.05,(now-previous)/1000));previous=now;elapsed+=dt;
  if(state.playing){
    state.hour+=dt*.32;
    if(state.hour>=18){state.hour=18;setPlaying(false);}
    $('time-slider').value=state.hour;updateSun();
  }
  if(cameraTween){
    if(advanceCameraTween(cameraTween,camera,controls,now))cameraTween=null;
  }
  animateMist(elapsed);
  if(state.people&&!reducedMotion){peopleElapsed+=dt;for(const view of stationViews.values())view.people.userData.animate(peopleElapsed);}
  controls.update();
  camera.updateMatrixWorld();
  const w=host.clientWidth,h=host.clientHeight;
  const occupiedLabels=[];
  const orderedLabels=[...labels].sort((a,b)=>Number(b.el.classList.contains('selected'))-Number(a.el.classList.contains('selected')));
  for(const l of orderedLabels){
    if(l.planHidden){l.el.style.display='none';if(l.leader)l.leader.style.display='none';continue;}
    projected.copy(l.position).project(camera);
    let x=(projected.x*.5+.5)*w,y=(-projected.y*.5+.5)*h;
    let hidden=projected.z>1||x<20||x>w-20||y<10||y>h-20||(mobile()&&l.type!=='station'&&!l.el.classList.contains('focusable'));
    const anchorX=x,anchorY=y;
    if(!hidden&&l.type!=='station'&&!l.el.classList.contains('focusable')){
      const half=l.el.offsetWidth/2,height=l.el.offsetHeight;
      hidden=x-half<labelSafe.left||x+half>labelSafe.right||y>labelSafe.bottom||y-height<labelSafe.top||(x+half>labelSafe.weatherLeft&&y-height<labelSafe.weatherBottom);
    }
    l.el.style.display=hidden?'none':'';
    if(!hidden&&(l.type==='station'||l.el.classList.contains('focusable'))){
      const width=l.el.offsetWidth,height=l.el.offsetHeight,half=width/2;
      x=clamp(x,labelSafe.left+half,Math.max(labelSafe.left+half,labelSafe.right-half));
      y=clamp(y,labelSafe.top+height,Math.max(labelSafe.top+height,labelSafe.bottom));
      if(x+half>labelSafe.weatherLeft)y=Math.max(y,labelSafe.weatherBottom+height);
      const overlaps=()=>occupiedLabels.some(previous=>Math.abs(x-previous.x)<half+previous.half+6&&Math.abs(y-previous.y)<Math.max(height,previous.height)+6);
      let attempts=0;
      while(overlaps()&&attempts++<8){y+=height+8;if(y>labelSafe.bottom)y=labelSafe.top+height+(attempts-1)*(height+8);}
      hidden=y>labelSafe.bottom||overlaps();
      if(!hidden)occupiedLabels.push({x,y,half,height});
    }
    if(!l.leader){l.leader=document.createElement('div');l.leader.className='label-leader';l.leader.setAttribute('aria-hidden','true');$('labels').prepend(l.leader);}
    const displacement=Math.hypot(x-anchorX,y-anchorY);
    l.leader.style.display=hidden||displacement<12?'none':'';
    if(!hidden&&displacement>=12){l.leader.style.left=anchorX+'px';l.leader.style.top=anchorY+'px';l.leader.style.width=displacement+'px';l.leader.style.transform=`rotate(${Math.atan2(y-anchorY,x-anchorX)}rad)`;}
    l.el.style.display=hidden?'none':'';
    l.el.style.left=x+'px';l.el.style.top=y+'px';
  }
  const dir=camera.position.clone().sub(controls.target);$('compass-arrow').style.transform=`rotate(${Math.atan2(dir.x,dir.z)*180/Math.PI}deg)`;
  renderer.render(scene,camera);
  if(first){first=false;$('loading').classList.add('done');setTimeout(()=>$('loading').remove(),700);if(!reducedMotion)moveCamera(cameraHome,controls.target.clone(),mobile()?.8:1.23,1600);}
}
requestAnimationFrame(animate);

// One reference marker per surveyed segment; quantities are never treated as
// colocated hardware or multiplied into the illustrative cooling model.
const proposalGroup=new THREE.Group();scene.add(proposalGroup);
const proposalGeometry=new THREE.RingGeometry(1.5,2.1,24),proposalMaterial=new THREE.MeshBasicMaterial({color:'#168b7b',side:THREE.DoubleSide});
function selectAllocation(id){[...document.querySelectorAll('[data-allocation-id]')].find(button=>button.dataset.allocationId===id)?.click();}
document.addEventListener('mist-plan-focus',event=>focusPlace('plan:'+event.detail.allocation_id));
subscribeFogPlan(plan=>{
  if(plan?.plan_id===activeFogPlan?.plan_id)return;
  if(plan&&!activeFogPlan)sampleInstalled=new Set(state.installed);
  activeFogPlan=plan;
  state.installed=plan?new Set():sampleInstalled||state.installed;
  proposalGroup.clear();
  for(let i=labels.length-1;i>=0;i--)if(labels[i].planMarker){labels[i].el.remove();labels[i].leader?.remove();labels.splice(i,1);}
  for(const entry of labels)if(entry.type==='station')entry.planHidden=!!plan;
  for(const row of plan?.allocations||[]){
    if(!row.position||!row.units)continue;
    const [x,z]=project([row.position.longitude,row.position.latitude]);
    const marker=new THREE.Mesh(proposalGeometry,proposalMaterial);marker.rotation.x=-Math.PI/2;marker.position.set(x,1.95,z);proposalGroup.add(marker);
    const el=document.createElement('div');el.className='map-label station proposal-marker';
    const button=document.createElement('button');button.className='station-label';button.textContent=`${row.location} · ${row.units} units`;button.title=`Site ${row.site_id}: survey reference location`;
    button.addEventListener('click',()=>selectAllocation(row.allocation_id));el.append(button);$('labels').append(el);
    labels.push({el,position:v3(x,5,z),type:'station',planMarker:true});
  }
  if(plan&&validScenarioDate(plan.analysis_date)){state.date=plan.analysis_date;$('scenario-date').value=state.date;solarCache.clear();}
  state.focusedPlace=null;updateSun(true);resize();
});

// Read-only diagnostic surface for this local demonstration.
window.mistDemo={getState:()=>({map:{mode:mapSource.mode,buildingParts:geography.buildingParts,heatSegments:heatPoints.length,source:mapSource.data.metadata.tileTemplate,treeCount:geography.treeCount},...state,installed:[...state.installed],sites:siteResults.map(s=>({id:s.id,coordinates:unproject([s.x,s.z]),before:s.before,after:s.after,score:s.score,shade:s.shade.label,natural:s.natural,footfall:s.footfall,valid:!geography.isBuilding([s.x,s.z])&&!geography.isWater([s.x,s.z])})),camera:{type:camera.type,position:camera.position.toArray(),target:controls.target.toArray(),zoom:camera.zoom,moving:!!cameraTween},stations:[...stationViews].map(([id,v])=>({id,mist:v.particles.visible,hardware:v.hardware.visible})),pedestrians:[...stationViews].map(([id,view])=>({id,...view.people.userData.getMotionState()})),screenPoints:[...sites,{id:'opera',x:project(OPERA.coordinates)[0],z:project(OPERA.coordinates)[1]}].map(place=>{const p=v3(place.x,1.8,place.z).project(camera),rect=host.getBoundingClientRect();return{id:place.id,x:rect.left+(p.x*.5+.5)*rect.width,y:rect.top+(-p.y*.5+.5)*rect.height};}),renderer:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles}})};
