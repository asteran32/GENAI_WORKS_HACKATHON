import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from './dist/vendor/three.module.js';
import {createOperaHouse,operaOccluders,isOperaFootprint,OPERA} from './dist/opera-house.js';
import {project} from './dist/gis-data.js';
import {buildOcclusionIndex} from './dist/architecture.js';
const model=createOperaHouse((color,options={})=>new THREE.MeshStandardMaterial({color,...options}));
const bounds=new THREE.Box3().setFromObject(model),[x,z]=project(OPERA.coordinates);
assert.ok(bounds.min.x<x&&bounds.max.x>x&&bounds.min.z<z&&bounds.max.z>z);
assert.ok(bounds.max.y>14&&bounds.max.y<16);
let triangles=0;model.traverse(o=>{if(!o.isMesh)return;for(const name of ['position','normal'])assert.ok([...o.geometry.attributes[name].array].every(Number.isFinite));triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;});
assert.ok(triangles>10000);
const volumes=operaOccluders(model),occluded=buildOcclusionIndex(volumes);
const below=new THREE.Ray(new THREE.Vector3(x,0,z),new THREE.Vector3(0,1,0));
assert.equal(occluded(below),true);
model.clear(); // Display meshes can be merged/removed without losing the shadow geometry.
assert.equal(occluded(below),true);
assert.equal(occluded(new THREE.Ray(new THREE.Vector3(x+100,0,z),new THREE.Vector3(0,1,0))),false);
const data=JSON.parse(await fs.readFile(new URL('./dist/data/sydney-openfreemap.geojson',import.meta.url),'utf8'));
let replacements=0,total=0;for(const f of data.features.filter(f=>f.properties.layer==='building'))for(const p of f.geometry.coordinates){total++;if(isOperaFootprint(p))replacements++;}
assert.ok(replacements>=2&&replacements<20);
console.log(`Opera geometry and retained shadow checks passed; ${replacements} of ${total} source parts replaced on the landmark site.`);
