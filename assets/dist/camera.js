import * as THREE from './vendor/three.module.js';

export function createCameraTween(camera, controls, position, target, zoom, duration, reducedMotion) {
  return {
    from: camera.position.clone(), to: position.clone(), targetFrom: controls.target.clone(), targetTo: target.clone(),
    zoomFrom: camera.zoom, zoomTo: zoom, start: performance.now(), duration: reducedMotion ? 1 : duration
  };
}
export function advanceCameraTween(tween, camera, controls, now) {
  const progress = Math.min(1, Math.max(0, (now - tween.start) / tween.duration));
  const ease = 1 - (1 - progress) ** 3;
  camera.position.lerpVectors(tween.from, tween.to, ease);
  controls.target.lerpVectors(tween.targetFrom, tween.targetTo, ease);
  camera.zoom = THREE.MathUtils.lerp(tween.zoomFrom, tween.zoomTo, ease);
  camera.updateProjectionMatrix();
  return progress === 1;
}
