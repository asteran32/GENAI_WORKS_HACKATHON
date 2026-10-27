import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from './dist/vendor/three.module.js';
import {CITY,project,unproject,tileCoordinates,loadCityData} from './dist/gis-data.js';
import {containsPoint,buildingHeights,locateCandidate} from './dist/gis-city.js';
import {buildOcclusionIndex,intersectsFootprintVolume} from './dist/architecture.js';
const snapshot=JSON.parse(await fs.readFile(new URL('./dist/data/sydney-openfreemap.geojson',import.meta.url),'utf8'));
assert.equal(snapshot.metadata.provider,'OpenFreeMap');
assert.equal(tileCoordinates().length,4);
assert.deepEqual(project(CITY.center),[0,0]);
for(const coords of [[151.20682,-33.87318],[151.2153,-33.8568]]){const result=unproject(project(coords));assert.ok(Math.abs(result[0]-coords[0])<1e-8&&Math.abs(result[1]-coords[1])<1e-8);}
assert.ok(Math.abs(project([CITY.center[0]+.001,CITY.center[1]])[0]*CITY.metersPerUnit-92.4)<1);
assert.deepEqual(buildingHeights({render_height:120,render_min_height:12}),{height:120,min:12,fallback:false});
assert.deepEqual(buildingHeights({}),{height:3,min:0,fallback:true});
assert.equal(buildingHeights({render_height:0}).height,3);
assert.equal(buildingHeights({render_height:5,render_min_height:12}).min,5);
const rings=[[[-5,-5],[5,-5],[5,5],[-5,5]],[[-2,-2],[-2,2],[2,2],[2,-2]]];
assert.equal(containsPoint([0,0],rings),false);
assert.equal(containsPoint([4,0],rings),true);
const box=new THREE.Box3(new THREE.Vector3(-5,1,-5),new THREE.Vector3(5,10,5));box.footprint=rings[0];box.holes=rings.slice(1);
const vertical=new THREE.Ray(new THREE.Vector3(0,0,0),new THREE.Vector3(0,1,0));
assert.equal(intersectsFootprintVolume(vertical,box),false);
assert.equal(intersectsFootprintVolume(new THREE.Ray(new THREE.Vector3(0,5,0),new THREE.Vector3(1,0,0)),box),true);
const volumes=Array.from({length:40},(_,i)=>new THREE.Box3(new THREE.Vector3(i*4,1,0),new THREE.Vector3(i*4+2,12,2))),index=buildOcclusionIndex(volumes);
for(const x of [-5,1,3,25,99,159,170]){const ray=new THREE.Ray(new THREE.Vector3(x,0,1),new THREE.Vector3(0,1,0));assert.equal(index(ray),volumes.some(v=>ray.intersectsBox(v)));}
const roads=[{a:[-5,0],b:[5,0],path:true}],candidate=locateCandidate(CITY.center,roads,()=>false);
assert.equal(candidate.x,0);assert.equal(candidate.z,0);
const calls=[];const fallback=await loadCityData({fetcher:async url=>{calls.push(url);if(url===CITY.source)throw Error('offline');return{ok:true,json:async()=>snapshot};}});
assert.equal(fallback.mode,'snapshot');assert.equal(calls.at(-1),'./data/sydney-openfreemap.geojson');
for(const layer of ['building','transportation','water','park'])assert.ok(snapshot.features.some(f=>f.properties.layer===layer));
let parts=0;for(const f of snapshot.features.filter(f=>f.properties.layer==='building'))for(const polygon of f.geometry.coordinates){parts++;for(const ring of polygon)for(const [lon,lat] of ring){assert.ok(Number.isFinite(lon)&&Number.isFinite(lat));assert.ok(lon>=CITY.bounds[0]-1e-8&&lon<=CITY.bounds[2]+1e-8&&lat>=CITY.bounds[1]-1e-8&&lat<=CITY.bounds[3]+1e-8);}}
assert.ok(parts>2000);
console.log(`GIS checks passed: projection, height defaults, courtyard holes, BVH, candidate snapping, offline fallback, and ${parts} clipped building parts.`);
// Both live and bundled requests have deadlines, including a stalled body/fetch.
const stalled=await loadCityData({timeoutMs:10,fetcher:async url=>url===CITY.source?new Promise(()=>{}):{ok:true,json:async()=>snapshot}});
assert.equal(stalled.mode,'snapshot');
await assert.rejects(loadCityData({timeoutMs:10,snapshotTimeoutMs:10,fetcher:async()=>new Promise(()=>{})}),/could not load/);
await assert.rejects(loadCityData({fetcher:async url=>{if(url===CITY.source)throw Error('offline');return{ok:true,json:async()=>({})};}}),/could not load/);
assert.throws(()=>locateCandidate(CITY.center,roads,()=>false,()=>true),/surface path/);
console.log('Live timeout, cached timeout, invalid snapshot and water-exclusion checks passed.');
