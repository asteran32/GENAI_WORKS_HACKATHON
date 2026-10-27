import assert from 'node:assert/strict';
import * as THREE from './dist/vendor/three.module.js';
import { createWalkingRoutes, createWalker, sampleWalker } from './dist/pedestrian-motion.js';
import { buildPedestrianCrowd } from './dist/pedestrians.js';
const routes=createWalkingRoutes([{x:0,z:0,length:4,width:1,angle:0,path:true}],{isWalkable:([x,z])=>x<.9&&Math.abs(z)<.4});
assert.ok(routes.length>0);
assert.ok(routes.every(r=>r.b[0]<.9&&r.a[0]>=-2));
assert.deepEqual(createWalkingRoutes([{x:0,z:0,length:4,angle:0}],{isWalkable:()=>false}),[]);
assert.deepEqual(createWalkingRoutes([{x:NaN,z:0,length:4,angle:0}]),[]);
const route=routes[0],walker=createWalker(route,{speedMps:1.2,phase:0});
const start=sampleWalker(walker,0),walk=sampleWalker(walker,2);
assert.ok(walk.x>start.x);
assert.ok(Math.abs(walk.speedMps-1.2)<1e-9);
const turning=sampleWalker(walker,walker.travel+walker.turn/2);
assert.ok(Math.abs(turning.x-route.b[0])<1e-10);assert.equal(turning.speedMps,0);
assert.ok(Math.abs(turning.heading-route.heading-Math.PI/2)<1e-8);
const returning=sampleWalker(walker,walker.travel+walker.turn+2);
assert.ok(returning.x<turning.x);
const end=sampleWalker(walker,walker.period),nearEnd=sampleWalker(walker,walker.period-1e-5);
assert.ok(Math.hypot(start.x-end.x,start.z-end.z)<1e-10);
assert.ok(Math.hypot(start.x-nearEnd.x,start.z-nearEnd.z)<1e-8);
assert.ok(Math.abs(Math.cos(nearEnd.heading)-Math.cos(start.heading))<1e-7);
for(let t=0;t<walker.period*2;t+=.071){const pose=sampleWalker(walker,t);assert.ok(pose.x>=route.a[0]-1e-9&&pose.x<=route.b[0]+1e-9&&Math.abs(pose.z)<.4);}
let seed=22;const random=()=>((seed=seed*16807%2147483647)-1)/2147483646;
const crowd=buildPedestrianCrowd({x:0,z:0,footfall:170},{random,material:color=>new THREE.MeshStandardMaterial({color}),positions:[{x:0,z:0,length:4,width:1,angle:0,path:true}],sizeScale:.13,isWalkable:([x])=>Math.abs(x)<2});
const first=crowd.userData.getMotionState();crowd.userData.animate(2);const second=crowd.userData.getMotionState();
assert.ok(second.walkers.some((p,i)=>Math.hypot(p.x-first.walkers[i].x,p.z-first.walkers[i].z)>.1));
for(const mesh of crowd.children)assert.ok([...mesh.instanceMatrix.array].every(Number.isFinite));
// Every body part, including stationary head/torso parts, follows its walker.
const head=crowd.children.find(mesh=>mesh.geometry.type==='SphereGeometry');
const oldHead=new THREE.Matrix4();head.getMatrixAt(0,oldHead);crowd.userData.animate(4);const movedHead=new THREE.Matrix4();head.getMatrixAt(0,movedHead);
assert.notDeepEqual(oldHead.elements.slice(12,15),movedHead.elements.slice(12,15));
crowd.userData.setVisibleCount(0);assert.equal(crowd.userData.getMotionState().walkers.length,0);
for(const mesh of crowd.children)for(let i=0;i<mesh.count;i++){const matrix=new THREE.Matrix4();mesh.getMatrixAt(i,matrix);assert.equal(matrix.determinant(),0);}
crowd.userData.animate(6);crowd.userData.setVisibleCount(2);
assert.equal(crowd.userData.getMotionState().visibleCount,2);
for(const mesh of crowd.children)assert.ok([...mesh.instanceMatrix.array].every(Number.isFinite));
console.log('Pedestrian route safety, movement, smooth turns, continuous loops, instanced body motion and visibility checks passed.');
