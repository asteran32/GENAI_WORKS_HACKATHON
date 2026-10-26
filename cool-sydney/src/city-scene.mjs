import * as T from '/vendor/scene-vendor.mjs';
const R = 6371008.8, RAD = Math.PI / 180;
const polys = g => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
const lines = g => g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
export class CityScene {
  constructor(element) {
    this.element = element; this.scene = new T.Scene(); this.scene.background = new T.Color('#172a32'); this.scene.fog = new T.Fog('#172a32', 2600, 6500);
    this.camera = new T.PerspectiveCamera(42, 1, 1, 10000);
    this.renderer = new T.WebGLRenderer({ antialias: true }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', '실제 시드니 건물과 태양 그림자를 표시하는 3차원 지도'); element.append(this.renderer.domElement);
    this.controls = new T.OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true; this.controls.minDistance = 80; this.controls.maxDistance = 3200; this.controls.maxPolarAngle = Math.PI * .48; this.reset();
    this.scene.add(new T.HemisphereLight('#d8e9f4', '#5c6b5e', 2));
    this.sun = new T.DirectionalLight('#fff4d9', 3); this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048); Object.assign(this.sun.shadow.camera, { left: -2200, right: 2200, top: 2200, bottom: -2200, near: 1, far: 6500 }); this.sun.shadow.bias = -.00015; this.sun.shadow.normalBias = .3; this.scene.add(this.sun); this.scene.add(this.sun.target);
    const ground = new T.Mesh(new T.PlaneGeometry(6500, 6500), new T.MeshStandardMaterial({ color: '#73807b', roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);
    this.buildings = new T.Group(); this.ground = new T.Group(); this.samples = new T.Group(); this.scene.add(this.ground, this.buildings, this.samples);
    this.observer = new ResizeObserver(() => { const w = element.clientWidth, h = element.clientHeight; if (!w || !h) return; this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }); this.observer.observe(element);
    this.renderer.setAnimationLoop(() => { this.controls.update(); this.renderer.render(this.scene, this.camera); });
  }
  reset(top = false) { this.controls.target.set(0, 0, 0); this.camera.position.set(top ? 0 : 850, top ? 1500 : 1000, top ? 1 : 1000); this.controls.update(); }
  project(point) { return [(point[0] - this.area.longitude) * RAD * R * Math.cos(this.area.latitude * RAD), (point[1] - this.area.latitude) * RAD * R]; }
  shape(rings) { const shape = new T.Shape(rings[0].map(p => new T.Vector2(...this.project(p)))); shape.holes = rings.slice(1).map(r => new T.Path(r.map(p => new T.Vector2(...this.project(p))))); return shape; }
  clear(group) { for (const child of [...group.children]) { child.geometry?.dispose(); if (Array.isArray(child.material)) child.material.forEach(m => m.dispose()); else child.material?.dispose(); group.remove(child); } }
  setData(snapshot) {
    this.area = snapshot.area; this.clear(this.buildings); this.clear(this.ground);
    const groups = new Map();
    for (const f of snapshot.features) {
      const p = f.properties, layer = p.layer;
      for (const coordinates of polys(f.geometry)) {
        if (!coordinates[0]?.length) continue;
        const building = layer === 'building', h = p.casts_shadow ? p.height_m : .4, base = p.casts_shadow ? p.min_height_m || 0 : 0;
        const green = ['park', 'grass', 'wood', 'forest', 'recreation_ground', 'garden'].includes(p.class);
        if (!building && layer !== 'water' && !green) continue;
        const shape = this.shape(coordinates), geometry = building && p.casts_shadow ? new T.ExtrudeGeometry(shape, { depth: h - base, steps: 1, bevelEnabled: false, curveSegments: 1 }) : new T.ShapeGeometry(shape);
        geometry.rotateX(-Math.PI / 2); geometry.translate(0, building ? base + .3 : layer === 'water' ? .12 : .2, 0); geometry.deleteAttribute('uv');
        const key = `${p.source_tile}:${building ? p.casts_shadow ? 'building' : 'unknown' : layer === 'water' ? 'water' : 'green'}`;
        if (!groups.has(key)) groups.set(key, { geometries: [], p, building, color: building ? p.casts_shadow ? '#d5ded6' : '#d9ae64' : layer === 'water' ? '#438898' : '#6b9a79' });
        groups.get(key).geometries.push(geometry);
      }
      if (layer === 'transportation' && p.brunnel !== 'tunnel') for (const points of lines(f.geometry)) {
        const vertices = points.map(point => { const [x, y] = this.project(point); return new T.Vector3(x, .5, -y); });
        this.ground.add(new T.Line(new T.BufferGeometry().setFromPoints(vertices), new T.LineBasicMaterial({ color: p.class === 'path' ? '#d2bca2' : '#bfc8c2' })));
      }
    }
    for (const group of groups.values()) {
      const t = group.p.tile_bounds, [west, south] = this.project([t.west, t.south]), [east, north] = this.project([t.east, t.north]);
      const clippingPlanes = [new T.Plane(new T.Vector3(1, 0, 0), -west), new T.Plane(new T.Vector3(-1, 0, 0), east), new T.Plane(new T.Vector3(0, 0, -1), -south), new T.Plane(new T.Vector3(0, 0, 1), north)];
      const material = new T.MeshStandardMaterial({ color: group.color, roughness: .9, clippingPlanes, clipShadows: true, side: T.DoubleSide });
      const geometry = T.mergeGeometries(group.geometries); group.geometries.forEach(g => g.dispose()); if (!geometry) continue;
      const mesh = new T.Mesh(geometry, material); mesh.castShadow = group.building && group.p.casts_shadow; mesh.receiveShadow = true; (group.building ? this.buildings : this.ground).add(mesh);
    }
    const a = this.area, points = [[a.west,a.south],[a.east,a.south],[a.east,a.north],[a.west,a.north],[a.west,a.south]].map(p => { const [x,y] = this.project(p); return new T.Vector3(x, 1, -y); });
    this.ground.add(new T.Line(new T.BufferGeometry().setFromPoints(points), new T.LineBasicMaterial({ color: '#b6f2cd' })));
  }
  setRun(run) {
    const altitude = run.sun.altitude * RAD, azimuth = run.sun.azimuth * RAD, length = 3000;
    this.sun.position.set(Math.sin(azimuth) * Math.cos(altitude) * length, Math.sin(altitude) * length, -Math.cos(azimuth) * Math.cos(altitude) * length);
    this.sun.intensity = run.daylight ? 3 : 0; this.clear(this.samples);
    if (run.cells.length) {
      const g = new T.PlaneGeometry(18, 18); g.rotateX(-Math.PI / 2);
      const m = new T.MeshBasicMaterial({ color: '#42d1b6', transparent: true, opacity: .55, depthWrite: false });
      const mesh = new T.InstancedMesh(g, m, run.cells.length), matrix = new T.Matrix4();
      run.cells.forEach(([x,y], i) => { matrix.makeTranslation(x, .8, -y); mesh.setMatrixAt(i, matrix); }); mesh.instanceMatrix.needsUpdate = true; this.samples.add(mesh);
    }
  }
}
