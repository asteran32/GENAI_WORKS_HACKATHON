import * as THREE from './vendor/three.module.js';
import { createWalkingRoutes, createWalker, sampleWalker } from './pedestrian-motion.js';

// A shared, instanced miniature-person kit: clearly separate from green tree crowns.
const sphere = new THREE.SphereGeometry(1, 10, 8);
const hairCap = new THREE.SphereGeometry(1, 10, 7, 0, Math.PI * 2, 0, Math.PI * .55);
const torso = new THREE.CapsuleGeometry(.3, .48, 3, 8);
const limb = new THREE.CylinderGeometry(1, 1, 1, 7);
const cube = new THREE.BoxGeometry(1, 1, 1);
const up = new THREE.Vector3(0, 1, 0);
const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

export function buildPedestrianCrowd(site, { random, material, positions=[], sizeScale=1, isWalkable=()=>true, metersPerUnit=5 }) {
  const group = new THREE.Group();
  const count = Math.round(site.footfall / 85);
  const shirts = ['#477cbd', '#ca6e5d', '#d3a347', '#7d6da6', '#f0e3cd', '#46637e'].map(c => material(c));
  const skins = ['#e9bc97', '#bd8667', '#895d49'].map(c => material(c));
  const hair = ['#453c39', '#705646'].map(c => material(c));
  const pants = material('#344657');
  const shoes = material('#25323c');
  const bag = material('#ac7b54');
  const buckets = new Map(), agents = [];
  const routes = createWalkingRoutes(positions, { isWalkable });
  const local = new THREE.Object3D();
  let personMatrix;

  function part(owner, geometry, mat, position, scale, rotation = null, motion = null) {
    local.position.set(...position);
    local.scale.set(...scale);
    local.quaternion.identity();
    if (rotation) local.quaternion.copy(rotation);
    local.updateMatrix();
    const matrix = new THREE.Matrix4().multiplyMatrices(personMatrix, local.matrix);
    const key = geometry.uuid + mat.uuid;
    if (!buckets.has(key)) buckets.set(key, { geometry, mat, parts: [] });
    buckets.get(key).parts.push({ owner, matrix, local: local.matrix.clone(), motion });
  }
  function segment(owner, mat, a, b, radius, motion = null) {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
    const d = to.clone().sub(from);
    part(owner, limb, mat, from.add(to).multiplyScalar(.5).toArray(), [radius, d.length(), radius], new THREE.Quaternion().setFromUnitVectors(up, d.normalize()), motion);
  }

  for (let i = 0; i < count; i++) {
    const route=routes.length?routes[Math.floor(random()*routes.length)]:null;
    const position=positions.length?positions[Math.floor(random()*positions.length)]:null;
    const walker=route?createWalker(route,{speedMps:.95+random()*.5,metersPerUnit,phase:random(),strideMetres:1.18+random()*.18}):null;
    const pose=walker?sampleWalker(walker,0):{x:position?.x??site.x,z:position?.z??site.z,heading:position?Math.PI/2-position.angle:0,gait:0,step:0,speedMps:0};
    const size = (1.02 + random() * .17)*sizeScale;
    personMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(pose.x, 1.79, pose.z),
      new THREE.Quaternion().setFromAxisAngle(up, pose.heading),
      new THREE.Vector3(size, size, size)
    );
    const agent={walker,pose,size,matrix:personMatrix.clone(),motions:[]};agents.push(agent);
    const shirt = shirts[i % shirts.length], skin = skins[i % skins.length];
    // Rounded shoulders, visible neck, face and a dark hair cap.
    part(i, torso, shirt, [0, 1.62, 0], [1.32, 1, .77]);
    part(i, limb, skin, [0, 2.16, 0], [.13, .2, .13]);
    part(i, sphere, skin, [0, 2.48, .025], [.34, .39, .33]);
    part(i, hairCap, hair[i % hair.length], [0, 2.51, -.015], [.351, .39, .34]);
    // Two separate trouser legs and projecting shoes make a walking silhouette.
    for (const side of [-1, 1]) {
      const footZ = 0;
      const legMotion={pivot:[side*.19,1.19,0],swing:side,matrix:new THREE.Matrix4()},armMotion={pivot:[side*.39,1.96,0],swing:-side*.7,matrix:new THREE.Matrix4()};
      agent.motions.push(legMotion,armMotion);
      segment(i, pants, [side * .19, 1.19, 0], [side * .21, .24, footZ], .145,legMotion);
      part(i, cube, shoes, [side * .21, .13, footZ + .09], [.31, .21, .52],null,legMotion);
      segment(i, shirt, [side * .39, 1.96, 0], [side * .52, 1.54, -footZ * .55], .145,armMotion);
      segment(i, skin, [side * .52, 1.54, -footZ * .55], [side * .5, 1.18, -footZ], .105,armMotion);
      part(i, sphere, skin, [side * .5, 1.15, -footZ], [.13, .14, .13],null,armMotion);
    }
    if (i % 4 === 0) part(i, torso, bag, [0, 1.7, -.28], [.84, .7, .62]);
  }

  for (const bucket of buckets.values()) {
    bucket.mesh = new THREE.InstancedMesh(bucket.geometry, bucket.mat, bucket.parts.length);
    bucket.parts.forEach((part, index) => bucket.mesh.setMatrixAt(index, part.matrix));
    bucket.mesh.castShadow = true;
    bucket.mesh.receiveShadow = true;
    bucket.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Walker positions change: do not cull using a sphere frozen at their spawn.
    // There are fewer than 100 people, already batched into a small mesh kit.
    bucket.mesh.frustumCulled=false;
    group.add(bucket.mesh);
  }
  let visibleCount = count;
  group.userData.setVisibleCount = requested => {
    const next = Math.max(0, Math.min(count, requested));
    if (next === visibleCount) return;
    visibleCount = next;
    for (const bucket of buckets.values()) {
      bucket.parts.forEach((part, index) => bucket.mesh.setMatrixAt(index, part.owner < next ? part.matrix : hiddenMatrix));
      bucket.mesh.instanceMatrix.needsUpdate = true;
    }
    lastPose=-Infinity;group.userData.animate(animationTime);
  };
  const animated=new THREE.Matrix4(),pivotMatrix=new THREE.Matrix4(),rotationMatrix=new THREE.Matrix4(),inversePivot=new THREE.Matrix4();
  const origin=new THREE.Vector3(),orientation=new THREE.Quaternion(),scale=new THREE.Vector3();
  let lastPose=-Infinity,animationTime=0;
  group.userData.animate=elapsed=>{
    if(elapsed-lastPose<1/30)return;lastPose=elapsed;animationTime=elapsed;
    for(let i=0;i<visibleCount;i++){
      const agent=agents[i];
      if(agent.walker)agent.pose=sampleWalker(agent.walker,elapsed);
      const pose=agent.pose,swing=Math.sin(pose.step)*.48*pose.gait;
      const bob=Math.sin(pose.step)**2*.035*pose.gait*agent.size;
      origin.set(pose.x,1.79+bob,pose.z);orientation.setFromAxisAngle(up,pose.heading);scale.setScalar(agent.size);
      agent.matrix.compose(origin,orientation,scale);
      for(const motion of agent.motions){
        const [x,y,z]=motion.pivot;
        pivotMatrix.makeTranslation(x,y,z);inversePivot.makeTranslation(-x,-y,-z);rotationMatrix.makeRotationX(swing*motion.swing);
        motion.matrix.copy(pivotMatrix).multiply(rotationMatrix).multiply(inversePivot);
      }
    }
    for(const bucket of buckets.values()){
      let changed=false;
      bucket.parts.forEach((part,index)=>{
        if(part.owner>=visibleCount)return;
        animated.copy(agents[part.owner].matrix);
        if(part.motion)animated.multiply(part.motion.matrix);
        animated.multiply(part.local);
        bucket.mesh.setMatrixAt(index,animated);changed=true;
      });
      if(changed)bucket.mesh.instanceMatrix.needsUpdate=true;
    }
  };
  group.userData.getMotionState=()=>({visibleCount,totalCount:count,walkers:agents.slice(0,visibleCount).map((agent,id)=>({id,...agent.pose,moving:!!agent.walker,valid:isWalkable([agent.pose.x,agent.pose.z])}))});
  group.userData.animate(0);
  return group;
}
