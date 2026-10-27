import * as T from '/vendor/scene-vendor.mjs';
const R = 6371008.8, RAD = Math.PI / 180;
const polys = g => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
const lines = g => g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];

/**
 * Light monotone massing — buildings are context, data is the ink.
 * Lightness steps with height band so skyline depth reads without hue.
 */
const MASSING = {
  tower: { color: '#c3cdd8', edge: '#64748b' },
  high: { color: '#d3dbe4', edge: '#7b8aa0' },
  mid: { color: '#e2e8ef', edge: '#8e9bb0' },
  low: { color: '#eef2f6', edge: '#9aa7ba' },
};

function buildingStyle(height) {
  const band = height >= 90 ? 'tower' : height >= 45 ? 'high' : height >= 18 ? 'mid' : 'low';
  const { color, edge } = MASSING[band];
  if (band === 'tower') return { key: band, color, edge, metalness: .05, roughness: .7, floor: 3.7, bay: 1.45, glass: 0.6 };
  if (band === 'high') return { key: band, color, edge, metalness: .03, roughness: .78, floor: 3.45, bay: 1.6, glass: 0.45 };
  if (band === 'mid') return { key: band, color, edge, metalness: .02, roughness: .85, floor: 3.2, bay: 1.85, glass: 0.3 };
  return { key: band, color, edge, metalness: 0, roughness: .9, floor: 3.0, bay: 2.1, glass: 0.2 };
}

/** Procedural facade — wall colour carries through windows/spandrels. */
function facadeMaterial({ color, metalness, roughness, floor, bay, glass = 0.4, clippingPlanes }) {
  const material = new T.MeshStandardMaterial({
    color, metalness, roughness, clippingPlanes, clipShadows: true,
    side: T.FrontSide,
    flatShading: false,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.uFloor = { value: floor };
    shader.uniforms.uBay = { value: bay };
    shader.uniforms.uGlass = { value: glass };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWorldN = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldN;\nuniform float uFloor;\nuniform float uBay;\nuniform float uGlass;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 wn = normalize(vWorldN);
        float roof = smoothstep(0.62, 0.88, wn.y);
        float under = step(0.7, -wn.y);
        vec3 absN = abs(wn);
        float along = mix(vWorldPos.x, vWorldPos.z, step(absN.x, absN.z));
        float across = mix(vWorldPos.z, vWorldPos.x, step(absN.x, absN.z));
        float floorH = max(uFloor, 0.1);
        float bayW = max(uBay, 0.1);
        float fy = fract(vWorldPos.y / floorH);
        float fx = fract(along / bayW);
        float fz = fract(across / (bayW * 1.35));

        float plate = 1.0 - smoothstep(0.0, 0.06, fy) * smoothstep(1.0, 0.94, fy);
        float mullionV = 1.0 - smoothstep(0.0, 0.07, fx) * smoothstep(1.0, 0.93, fx);
        float mullionH = smoothstep(0.04, 0.1, fy) * (1.0 - smoothstep(0.88, 0.96, fy));
        float paneX = smoothstep(0.14, 0.2, fx) * (1.0 - smoothstep(0.8, 0.86, fx));
        float paneY = smoothstep(0.18, 0.26, fy) * (1.0 - smoothstep(0.72, 0.82, fy));
        float pane = paneX * paneY * (1.0 - roof);
        float spandrel = smoothstep(0.08, 0.14, fy) * (1.0 - smoothstep(0.16, 0.22, fy)) * (1.0 - roof);
        float grain = fract(sin(dot(floor(vec2(along, vWorldPos.y) * 4.2), vec2(12.9898, 78.233))) * 43758.5453);

        vec3 wallCol = diffuseColor.rgb;
        wallCol = mix(wallCol, wallCol * 0.88, plate * 0.9);
        wallCol = mix(wallCol, wallCol * 0.84, mullionV * 0.75);
        wallCol = mix(wallCol, wallCol * 0.92, mullionH * 0.5);
        wallCol = mix(wallCol, wallCol * 0.8, spandrel);
        wallCol = mix(wallCol, wallCol * (0.97 + 0.03 * grain), 0.35);

        vec3 glassCol = mix(wallCol * 0.82, vec3(0.70, 0.76, 0.83), 0.35 + 0.25 * uGlass);
        glassCol *= 0.9 + 0.1 * grain;
        wallCol = mix(wallCol, glassCol, pane * (0.35 + 0.35 * uGlass));

        float parapet = (1.0 - smoothstep(0.0, 0.12, fz)) * roof;
        vec3 roofCol = mix(diffuseColor.rgb, vec3(1.0), 0.35);
        roofCol = mix(roofCol, roofCol * 0.86, parapet);
        roofCol = mix(roofCol, roofCol * (0.96 + 0.04 * grain), 0.5);

        diffuseColor.rgb = mix(wallCol, roofCol, roof);
        if (under > 0.5) diffuseColor.rgb *= 0.55;
      `);
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => `facade-v4-${floor}-${bay}-${glass}`;
  return material;
}

/** Flat map layers need real vertical separation — cm gaps z-fight at city scale. */
const LAYER_Y = { base: -8, water: 2.2, shade: 3.4, cells: 4.2, bounds: 14, roadBase: 0.35 };
const CANVAS = '#f8fafc';
const DATA_INK = { shade: '#1d4ed8', cells: '#1e40af', bounds: '#1d4ed8', hover: '#1d4ed8' };
/** Server shadow grid (gis-shadow.js): 20 m samples starting 10 m inside the south-west corner. */
const SAMPLE_M = 20, ESTIMATE_PX_M = 4;
const MAX_SHADE_M = 260;
const GREEN_CLASSES = new Set(['park', 'grass', 'wood', 'forest', 'recreation_ground', 'garden', 'pitch', 'playground', 'farmland', 'wetland', 'sand', 'rock']);

function terrainNoise(x, z) {
  return Math.sin(x * 0.017) * Math.cos(z * 0.014) * 2.4
    + Math.sin(x * 0.045 + z * 0.038) * 1.05
    + Math.sin((x + z) * 0.09) * 0.4;
}

function landStyle(cls) {
  if (cls === 'wood' || cls === 'forest') return { key: 'wood', color: '#c4d6c8', thickness: 6.5, lift: 1.2, relief: 1.6 };
  if (cls === 'wetland') return { key: 'wetland', color: '#cfdcd6', thickness: 1.1, lift: 0.4, relief: 0.6 };
  if (cls === 'sand') return { key: 'sand', color: '#ece6d8', thickness: 0.7, lift: 0.5, relief: 0.35 };
  if (cls === 'rock') return { key: 'rock', color: '#dcdcd8', thickness: 2.8, lift: 0.8, relief: 1.8 };
  if (cls === 'pitch' || cls === 'track') return { key: 'pitch', color: '#cfe0d2', thickness: 0.55, lift: 0.9, relief: 0.15 };
  if (cls === 'playground') return { key: 'play', color: '#d3e3d5', thickness: 0.7, lift: 1.0, relief: 0.25 };
  if (cls === 'farmland') return { key: 'farm', color: '#e0e4d2', thickness: 0.8, lift: 0.7, relief: 0.5 };
  return { key: 'grass', color: '#d5e3d8', thickness: 1.15, lift: 0.85, relief: 0.85 };
}

function roadStyle(p) {
  const cls = p.class || 'minor';
  const level = Number(p.level);
  const levelM = Number.isFinite(level) ? Math.max(-12, Math.min(18, level * 3.4)) : 0;
  const bridge = p.brunnel === 'bridge' ? 7.5 : 0;
  const y = LAYER_Y.roadBase + bridge + levelM;
  const widths = {
    motorway: 15, trunk: 13, primary: 10, secondary: 8, tertiary: 6.5, minor: 5.5,
    service: 4.2, path: 2.0, track: 2.4, rail: 3.2, transit: 3.4, pier: 5.5, bridge: 8, ferry: 0,
  };
  const colors = {
    motorway: '#b4bfcc', trunk: '#bcc6d2', primary: '#c6cfd9', secondary: '#ccd4dd',
    tertiary: '#d3dae2', minor: '#d9dfe6', service: '#e0e5eb', path: '#e6e9ed',
    track: '#e4e2dc', rail: '#8f9aab', transit: '#97a2b2', pier: '#d4d0c6', bridge: '#c2cbd6',
  };
  return {
    key: `${cls}-${p.brunnel || 'g'}-${Math.round(y)}`,
    width: widths[cls] ?? 5,
    color: colors[cls] ?? '#d9dfe6',
    y,
    thickness: cls === 'path' || cls === 'track' ? 0.18 : cls === 'rail' || cls === 'transit' ? 0.35 : 0.45,
  };
}

/** Centreline → paved strip with constant width in projected metres. */
function roadRibbon(points, width, y, thickness) {
  if (!points || points.length < 2) return null;
  const half = width * 0.5;
  const left = [], right = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 1e-6) { dx = 1; dy = 0; len = 1; }
    const nx = (-dy / len) * half, ny = (dx / len) * half;
    left.push([points[i][0] + nx, points[i][1] + ny]);
    right.push([points[i][0] - nx, points[i][1] - ny]);
  }
  const top = y + thickness, bot = y;
  const positions = [];
  const indices = [];
  const push = (x, yy, z) => positions.push(x, yy, -z);
  for (let i = 0; i < points.length; i++) {
    push(left[i][0], top, left[i][1]);
    push(right[i][0], top, right[i][1]);
    push(left[i][0], bot, left[i][1]);
    push(right[i][0], bot, right[i][1]);
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 4, b = a + 4;
    indices.push(a, a + 1, b + 1, a, b + 1, b); // top
    indices.push(a + 2, b + 2, b + 3, a + 2, b + 3, a + 3); // bottom
    indices.push(a, b, b + 2, a, b + 2, a + 2); // left wall
    indices.push(a + 1, a + 3, b + 3, a + 1, b + 3, b + 1); // right wall
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function applyRelief(geometry, relief) {
  if (!relief) return geometry;
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    pos.setY(i, y + terrainNoise(x, z) * relief);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const v of p) { while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), v) <= 0) lower.pop(); lower.push(v); }
  for (const v of p.slice().reverse()) { while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), v) <= 0) upper.pop(); upper.push(v); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Orientation anchors — more reliable than sparse OSM building names. */
const LANDMARKS = [
  { id: 'town-hall', name: 'Town Hall', lon: 151.2055, lat: -33.8732 },
  { id: 'circular-quay', name: 'Circular Quay', lon: 151.2113, lat: -33.8612 },
  { id: 'darling-harbour', name: 'Darling Harbour', lon: 151.2008, lat: -33.8722 },
  { id: 'hyde-park', name: 'Hyde Park', lon: 151.2116, lat: -33.8734 },
  { id: 'barangaroo', name: 'Barangaroo', lon: 151.2014, lat: -33.8628 },
  { id: 'wynyard', name: 'Wynyard', lon: 151.2057, lat: -33.8659 },
  { id: 'martin-place', name: 'Martin Place', lon: 151.209, lat: -33.8675 },
  { id: 'opera-house', name: 'Opera House', lon: 151.215, lat: -33.8568 },
];

export class CityScene {
  constructor(element, { onPlace } = {}) {
    this.element = element; this.onPlace = onPlace;
    this.scene = new T.Scene(); this.scene.background = new T.Color(CANVAS); this.scene.fog = new T.Fog(CANVAS, 2400, 6200);
    this.camera = new T.PerspectiveCamera(42, 1, 2, 9000);
    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = false;
    // Neutral keeps the off-white canvas and blue data ink true to their tokens.
    this.renderer.toneMapping = T.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label', '실제 시드니 건물과 태양 그림자를 표시하는 3차원 지도'); element.append(this.renderer.domElement);
    this.labelsRoot = document.createElement('div'); this.labelsRoot.className = 'place-labels'; this.labelsRoot.setAttribute('aria-hidden', 'true'); element.append(this.labelsRoot);
    this.controls = new T.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 60; this.controls.maxDistance = 3200; this.controls.maxPolarAngle = Math.PI * .48;
    this.controls.rotateSpeed = 0.65; this.controls.panSpeed = 0.7; this.controls.zoomSpeed = 0.85;
    this.reset();
    this.hemi = new T.HemisphereLight('#ffffff', '#e2e8f0', 1.5); this.scene.add(this.hemi);
    this.ambient = new T.AmbientLight('#f8fafc', 0.9); this.scene.add(this.ambient);
    this.sun = new T.DirectionalLight('#ffffff', 1.35); this.sun.castShadow = false;
    this.scene.add(this.sun); this.scene.add(this.sun.target);
    const ground = new T.Mesh(
      new T.PlaneGeometry(6500, 6500),
      new T.MeshBasicMaterial({ color: '#f8fafc', polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 }),
    );
    ground.rotation.x = -Math.PI / 2; ground.position.y = LAYER_Y.base; this.scene.add(ground);
    // Drafting grid: 100 m minor / 500 m major, like plotted survey paper.
    this.grid = new T.Group();
    for (const [step, color] of [[100, '#e2e8f0'], [500, '#cbd5e1']]) {
      const g = new T.GridHelper(6000, 6000 / step, color, color);
      g.position.y = LAYER_Y.base + (step === 500 ? 0.2 : 0.1); g.material.transparent = true; g.material.opacity = step === 500 ? .9 : .75; g.material.depthWrite = false;
      this.grid.add(g);
    }
    this.scene.add(this.grid);
    this.buildings = new T.Group(); this.ground = new T.Group(); this.edges = new T.Group(); this.shades = new T.Group(); this.cells = new T.Group(); this.highlight = new T.Group();
    this.scene.add(this.ground, this.shades, this.cells, this.buildings, this.edges, this.highlight);
    this.shadeCasters = []; this.excluders = []; this.landmarks = []; this.focusId = null; this._ndc = new T.Vector3(); this._sun = null;
    this.layers = { shade: true, cells: true };
    this.raycaster = new T.Raycaster(); this._pointer = new T.Vector2(); this.hoverId = null;
    this.observer = new ResizeObserver(() => { const w = element.clientWidth, h = element.clientHeight; if (!w || !h) return; this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }); this.observer.observe(element);
    this.renderer.setAnimationLoop(() => {
      this.scaleControlsToZoom();
      this.controls.update();
      this.updatePlaceLabels();
      this.renderer.render(this.scene, this.camera);
    });
  }
  /** Closer zoom → slower orbit/pan so fine framing is possible. */
  scaleControlsToZoom() {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const min = this.controls.minDistance, max = Math.max(this.controls.maxDistance, min + 1);
    const t = Math.min(1, Math.max(0, (Math.log(dist) - Math.log(min)) / (Math.log(max) - Math.log(min))));
    this.controls.rotateSpeed = 0.18 + t * 0.72;
    this.controls.panSpeed = 0.22 + t * 0.85;
    this.controls.zoomSpeed = 0.55 + t * 0.5;
  }
  reset(top = false) {
    const span = this.areaSpan();
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(top ? 0 : span * .55, top ? span * .95 : span * .65, top ? 1 : span * .55);
    this.controls.update();
  }
  areaSpan() {
    if (!this.area) return 1600;
    const [w] = this.project([this.area.west, this.area.latitude]);
    const [e] = this.project([this.area.east, this.area.latitude]);
    const [, s] = this.project([this.area.longitude, this.area.south]);
    const [, n] = this.project([this.area.longitude, this.area.north]);
    return Math.max(Math.abs(e - w), Math.abs(n - s), 1200);
  }
  project(point) { return [(point[0] - this.area.longitude) * RAD * R * Math.cos(this.area.latitude * RAD), (point[1] - this.area.latitude) * RAD * R]; }
  shape(rings) { const shape = new T.Shape(rings[0].map(p => new T.Vector2(...this.project(p)))); shape.holes = rings.slice(1).map(r => new T.Path(r.map(p => new T.Vector2(...this.project(p))))); return shape; }
  clear(group) { for (const child of [...group.children]) { child.geometry?.dispose(); if (Array.isArray(child.material)) child.material.forEach(m => m.dispose()); else child.material?.dispose(); group.remove(child); } }
  clipPlanes(tile) {
    const [west, south] = this.project([tile.west, tile.south]), [east, north] = this.project([tile.east, tile.north]);
    return [new T.Plane(new T.Vector3(1, 0, 0), -west), new T.Plane(new T.Vector3(-1, 0, 0), east), new T.Plane(new T.Vector3(0, 0, -1), -south), new T.Plane(new T.Vector3(0, 0, 1), north)];
  }
  tuneAtmosphere() {
    const span = this.areaSpan();
    this.scene.fog.near = span * .85;
    this.scene.fog.far = span * 1.55;
    this.controls.maxDistance = span * 2.2;
  }
  buildLandmarks() {
    this.labelsRoot.replaceChildren();
    this.landmarks = LANDMARKS.filter(place => {
      if (!this.area) return false;
      return place.lon >= this.area.west && place.lon <= this.area.east && place.lat >= this.area.south && place.lat <= this.area.north;
    }).map(place => {
      const [x, z] = this.project([place.lon, place.lat]);
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'place-label'; el.textContent = place.name; el.dataset.id = place.id;
      el.addEventListener('click', () => this.focusPlace(place));
      this.labelsRoot.append(el);
      return { ...place, x, z, el, world: new T.Vector3(x, 28, -z) };
    });
    this.focusId = null;
  }
  focusPlace(place) {
    const hit = this.landmarks.find(p => p.id === place.id) || place;
    const [x, z] = hit.x != null ? [hit.x, hit.z] : this.project([hit.lon, hit.lat]);
    this.controls.target.set(x, 0, -z);
    const dist = Math.max(220, this.camera.position.distanceTo(this.controls.target) * 0.45);
    this.camera.position.set(x + dist * 0.55, dist * 0.62, -z + dist * 0.55);
    this.controls.update();
    this.focusId = hit.id;
    this.onPlace?.({ name: hit.name, id: hit.id, focused: true });
  }
  nearestLandmark() {
    if (!this.landmarks.length) return null;
    const t = this.controls.target;
    let best = null, bestD = Infinity;
    for (const place of this.landmarks) {
      const d = (place.x - t.x) ** 2 + (place.z + t.z) ** 2;
      if (d < bestD) { bestD = d; best = place; }
    }
    return best;
  }
  updatePlaceLabels() {
    if (!this.landmarks.length) return;
    const w = this.element.clientWidth, h = this.element.clientHeight;
    const near = this.nearestLandmark();
    if (near && near.id !== this.focusId) {
      this.focusId = near.id;
      this.onPlace?.({ name: near.name, id: near.id, focused: false });
    }
    for (const place of this.landmarks) {
      this._ndc.copy(place.world).project(this.camera);
      const visible = this._ndc.z > -1 && this._ndc.z < 1 && Math.abs(this._ndc.x) <= 1.15 && Math.abs(this._ndc.y) <= 1.15;
      place.el.hidden = !visible;
      if (!visible) continue;
      const px = (this._ndc.x * 0.5 + 0.5) * w, py = (-this._ndc.y * 0.5 + 0.5) * h;
      place.el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -120%)`;
      place.el.classList.toggle('is-near', place.id === this.focusId);
    }
  }
  extrudeBuilding(shape, height, base) {
    const depth = Math.max(height - base, 0.5);
    // No bevel — bevel lids sit nearly coplanar with roofs and flicker when orbiting.
    const geometry = new T.ExtrudeGeometry(shape, {
      depth,
      steps: 1,
      bevelEnabled: false,
      curveSegments: 2,
    });
    geometry.rotateX(-Math.PI / 2);
    // Keep building soles clear of park/water slabs.
    geometry.translate(0, base + 0.8, 0);
    geometry.computeVertexNormals();
    return geometry;
  }
  setData(snapshot) {
    this.area = snapshot.area; for (const g of [this.buildings, this.ground, this.edges, this.shades, this.cells, this.highlight]) this.clear(g);
    this.shadeCasters = []; this.excluders = []; this.hoverId = null; this._estimateMask = null;
    this.tuneAtmosphere();
    this.buildLandmarks();
    const groups = new Map();
    const addGroup = (key, meta, geometry) => {
      if (!geometry) return;
      if (!groups.has(key)) groups.set(key, { geometries: [], ...meta });
      groups.get(key).geometries.push(geometry);
    };
    for (const f of snapshot.features) {
      const p = f.properties, layer = p.layer;
      for (const coordinates of polys(f.geometry)) {
        if (!coordinates[0]?.length) continue;
        const building = layer === 'building', known = !!(building && p.casts_shadow);
        const h = known ? p.height_m : .4, base = known ? p.min_height_m || 0 : 0;
        const green = GREEN_CLASSES.has(p.class);
        const water = layer === 'water' && !['swimming_pool'].includes(p.class);
        // Same exclusions as the server sampler: every building and water polygon.
        if (building || layer === 'water') this.excluders.push(coordinates.map(ring => ring.map(point => this.project(point))));
        if (!building && !water && !green) continue;
        if (building && !known) continue;
        const shape = this.shape(coordinates);
        if (known) {
          const geometry = this.extrudeBuilding(shape, h, base);
          const ring = coordinates[0].map(point => this.project(point));
          const xs = ring.map(q => q[0]), ys = ring.map(q => q[1]);
          this.shadeCasters.push({
            ring, height: h, base,
            box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
            info: { id: p.osm_id ?? f.id, cls: p.class || p.render_type || null, method: p.height_method, tile: p.source_tile },
          });
          const style = buildingStyle(h);
          addGroup(`${p.source_tile}:b-${style.key}`, { p, building: true, known: true, style, kind: 'building', color: style.color }, geometry);
          continue;
        }
        if (water) {
          const depth = p.class === 'river' ? 1.2 : p.class === 'lake' ? 2.2 : 1.6;
          const geometry = new T.ExtrudeGeometry(shape, { depth, steps: 1, bevelEnabled: false, curveSegments: 2 });
          geometry.rotateX(-Math.PI / 2);
          geometry.translate(0, LAYER_Y.water - (p.class === 'river' ? 0.4 : 0), 0);
          applyRelief(geometry, 0.25);
          addGroup(`${p.source_tile}:water-${p.class || 'w'}`, {
            p, building: false, known: false, kind: 'water', color: p.class === 'river' ? '#c9dae8' : '#cddeeb',
          }, geometry);
          continue;
        }
        const land = landStyle(p.class);
        const geometry = new T.ExtrudeGeometry(shape, { depth: land.thickness, steps: 1, bevelEnabled: false, curveSegments: 2 });
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, land.lift, 0);
        applyRelief(geometry, land.relief);
        addGroup(`${p.source_tile}:land-${land.key}`, {
          p, building: false, known: false, kind: 'land', color: land.color, land,
        }, geometry);
      }
      if (layer === 'transportation' && p.brunnel !== 'tunnel' && p.class !== 'ferry') {
        const style = roadStyle(p);
        if (!style.width) continue;
        for (const points of lines(f.geometry)) {
          const projected = points.map(point => this.project(point)).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
          const geometry = roadRibbon(projected, style.width, style.y, style.thickness);
          addGroup(`${p.source_tile}:road-${style.key}`, {
            p, building: false, known: false, kind: 'road', color: style.color,
          }, geometry);
        }
      }
    }
    for (const group of groups.values()) {
      const clippingPlanes = this.clipPlanes(group.p.tile_bounds);
      const geometry = T.mergeGeometries(group.geometries); group.geometries.forEach(g => g.dispose()); if (!geometry) continue;
      geometry.computeVertexNormals();
      let material;
      if (group.known) material = facadeMaterial({ ...group.style, clippingPlanes });
      else if (group.kind === 'road') {
        material = new T.MeshStandardMaterial({
          color: group.color, roughness: 0.92, metalness: 0.02,
          clippingPlanes, side: T.FrontSide,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        });
      } else if (group.kind === 'water') {
        material = new T.MeshStandardMaterial({
          color: group.color, roughness: 0.28, metalness: 0.12,
          clippingPlanes, side: T.FrontSide,
          polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        });
      } else {
        material = new T.MeshStandardMaterial({
          color: group.color, roughness: 0.9, metalness: 0,
          clippingPlanes, side: T.FrontSide,
          polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: 0,
        });
      }
      const mesh = new T.Mesh(geometry, material);
      mesh.renderOrder = group.building ? 2 : 0;
      (group.building ? this.buildings : this.ground).add(mesh);
      if (group.known) {
        const edges = new T.EdgesGeometry(geometry, 35);
        const line = new T.LineSegments(edges, new T.LineBasicMaterial({
          color: group.style.edge, transparent: true, opacity: 0.55, clippingPlanes,
        }));
        line.renderOrder = 3;
        this.edges.add(line);
      }
    }
    const a = this.area, points = [[a.west,a.south],[a.east,a.south],[a.east,a.north],[a.west,a.north],[a.west,a.south]].map(p => { const [x,y] = this.project(p); return new T.Vector3(x, LAYER_Y.bounds, -y); });
    this.ground.add(new T.Line(new T.BufferGeometry().setFromPoints(points), new T.LineDashedMaterial({ color: DATA_INK.bounds, dashSize: 24, gapSize: 12, transparent: true, opacity: 0.6 })).computeLineDistances());
    this.reset();
    if (this._sun) this.updateShadeAreas(this._sun);
  }
  /**
   * Soft grey ground shade: roof tip + wall-cast strips only (no footprint).
   * depthTest on so opaque buildings occlude shade — no “shadow through walls”.
   */
  updateShadeAreas(sun) {
    this.clear(this.shades);
    const daylight = sun?.daytime ?? (sun && sun.altitude > 0);
    if (!daylight || !this.shadeCasters.length) return;
    const altitudeDeg = Math.max(sun.altitude, 2);
    const altitude = altitudeDeg * RAD;
    const azimuth = sun.azimuth * RAD;
    const scale = 1 / Math.tan(altitude);
    const geometries = [];
    const flat = ring => {
      const shape = new T.Shape(ring.map(p => new T.Vector2(p[0], p[1])));
      const geometry = new T.ShapeGeometry(shape);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, LAYER_Y.shade, 0);
      return geometry;
    };
    for (const b of this.shadeCasters) {
      const rise = Math.max(b.height - b.base, 0.5);
      const drop = Math.min(rise * scale, MAX_SHADE_M);
      if (drop < 0.8) continue;
      const ox = -Math.sin(azimuth) * drop, oy = -Math.cos(azimuth) * drop;
      const ring = [];
      for (const [x, y] of b.ring) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (ring.length && Math.hypot(x - ring[0][0], y - ring[0][1]) < 1e-6) continue;
        ring.push([x, y]);
      }
      if (ring.length < 3) continue;
      const tip = ring.map(([x, y]) => [x + ox, y + oy]);
      geometries.push(flat(tip));
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length];
        geometries.push(flat([a, c, tip[(i + 1) % tip.length], tip[i]]));
      }
    }
    if (!geometries.length) return;
    const merged = T.mergeGeometries(geometries);
    geometries.forEach(g => g.dispose());
    if (!merged) return;
    const material = new T.MeshBasicMaterial({
      color: DATA_INK.shade,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      depthTest: true,
      side: T.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      // Overlapping wall strips would stack alpha; stencil paints each pixel once.
      stencilWrite: true, stencilRef: 1, stencilFunc: T.NotEqualStencilFunc, stencilZPass: T.ReplaceStencilOp,
    });
    const mesh = new T.Mesh(merged, material);
    mesh.renderOrder = 1;
    mesh.visible = this.layers.shade;
    this.shades.add(mesh);
  }
  setSunLight(sun) {
    if (!sun) return;
    this._sun = sun;
    const altitude = sun.altitude * RAD, azimuth = sun.azimuth * RAD, length = 4200;
    const daylight = sun.daytime ?? sun.altitude > 0;
    this.sun.position.set(
      Math.sin(azimuth) * Math.cos(altitude) * length,
      Math.sin(altitude) * length,
      -Math.cos(azimuth) * Math.cos(altitude) * length,
    );
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();
    // Soft day curve — brightest vs dim daylight contrast stays mild.
    const day = daylight ? Math.min(1, Math.max(0, sun.altitude / 75)) : 0;
    // Night dims only slightly: this is a drafting view, not a render.
    this.sun.intensity = daylight ? 1.2 + day * 0.3 : 0.15;
    this.hemi.intensity = daylight ? 1.45 : 1.15;
    this.ambient.intensity = daylight ? 0.85 : 0.75;
    this.updateShadeAreas(sun);
  }
  /** Server-verified shaded samples (20 m grid) as plotted points. */
  setRun(run) {
    this.setSunLight(run.sun);
    this.clear(this.cells);
    if (!run.cells?.length) return;
    const positions = new Float32Array(run.cells.length * 3);
    run.cells.forEach(([x, y], i) => positions.set([x, LAYER_Y.cells, -y], i * 3));
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    const points = new T.Points(geometry, new T.PointsMaterial({ color: DATA_INK.cells, size: 5, sizeAttenuation: true, transparent: true, opacity: .85, depthWrite: false }));
    points.renderOrder = 2;
    this.cells.add(points);
    this.cells.visible = this.layers.cells;
  }
  /** Verified samples describe one instant; hide them once the clock moves away. */
  setCellsStale(stale) { this.cells.visible = this.layers.cells && !stale; }
  setLayer(name, on) {
    if (name === 'buildings') { this.buildings.visible = on; this.edges.visible = on; return; }
    if (name === 'ground') { this.ground.visible = on; return; }
    this.layers[name] = on;
    if (name === 'shade') this.shades.children.forEach(m => { m.visible = on; });
    if (name === 'cells') this.cells.visible = on;
  }
  /**
   * Fast screen-side estimate of the server's shade ratio: rasterise each caster's swept
   * footprint (base ring → roof ring, joined by one parallelogram per wall) and read it at the
   * server's 20 m samples. The server's ray intersection remains the reference value.
   */
  estimateShade(sun) {
    if (!this.area || !this.shadeCasters.length) return null;
    if (!(sun?.daytime ?? sun?.altitude > 0)) return null;
    const mask = this.estimateMask();
    const { ctx, width, height, west, north, samples } = mask;
    const tangent = Math.tan(sun.altitude * RAD), az = sun.azimuth * RAD;
    const dx = -Math.sin(az) / tangent, dy = -Math.cos(az) / tangent, k = 1 / ESTIMATE_PX_M;
    // Every sub-polygon is wound the same way so a nonzero fill is their union.
    // One path per caster: a single city-wide path is ~100× slower to fill.
    const poly = pts => {
      let area = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
      const ordered = area < 0 ? pts.slice().reverse() : pts;
      ordered.forEach(([x, y], i) => { const px = (x - west) * k, py = (north - y) * k; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.closePath();
    };
    ctx.clearRect(0, 0, width, height);
    for (const b of this.shadeCasters) {
      const ring = b.ring, n = ring.length - 1;
      if (n < 3) continue;
      const lo = ring.map(([x, y]) => [x + dx * b.base, y + dy * b.base]), hi = ring.map(([x, y]) => [x + dx * b.height, y + dy * b.height]);
      ctx.beginPath();
      poly(lo.slice(0, n)); poly(hi.slice(0, n));
      for (let i = 0; i < n; i++) poly([lo[i], lo[i + 1], hi[i + 1], hi[i]]);
      ctx.fill('nonzero');
    }
    const data = ctx.getImageData(0, 0, width, height).data;
    let shaded = 0;
    for (let i = 0; i < samples.length; i++) if (data[samples[i] * 4 + 3] > 127) shaded++;
    return samples.length ? Math.round(1000 * shaded / samples.length) / 10 : null;
  }
  estimateMask() {
    if (this._estimateMask) return this._estimateMask;
    const [west, south] = this.project([this.area.west, this.area.south]), [east, north] = this.project([this.area.east, this.area.north]);
    const k = 1 / ESTIMATE_PX_M, width = Math.ceil((east - west) * k) + 1, height = Math.ceil((north - south) * k) + 1;
    const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000';
    for (const rings of this.excluders) {
      ctx.beginPath();
      for (const ring of rings) ring.forEach(([x, y], i) => { const px = (x - west) * k, py = (north - y) * k; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.fill('evenodd');
    }
    const blocked = ctx.getImageData(0, 0, width, height).data, samples = [];
    for (let x = west + SAMPLE_M / 2; x < east; x += SAMPLE_M) for (let y = south + SAMPLE_M / 2; y < north; y += SAMPLE_M) {
      const index = Math.floor((north - y) * k) * width + Math.floor((x - west) * k);
      if (blocked[index * 4 + 3] <= 127) samples.push(index);
    }
    this._estimateMask = { ctx, width, height, west, north, samples: Int32Array.from(samples) };
    return this._estimateMask;
  }
  /** Building under the pointer, with the facts the tooltip shows. */
  pick(clientX, clientY) {
    if (!this.buildings.visible || !this.shadeCasters.length) return this.setHover(null);
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this._pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.buildings.children, false)[0];
    if (!hit) return this.setHover(null);
    const x = hit.point.x, y = -hit.point.z, eps = 0.6;
    let best = null;
    for (const b of this.shadeCasters) {
      const [x0, y0, x1, y1] = b.box;
      if (x < x0 - eps || x > x1 + eps || y < y0 - eps || y > y1 + eps || hit.point.y > b.height + 2) continue;
      if (!insideRing(b.ring, [x, y]) && !nearRing(b.ring, [x, y], eps)) continue;
      if (!best || b.height < best.height) best = b;
    }
    return this.setHover(best);
  }
  setHover(caster) {
    if (caster === this.hoverId) return caster;
    this.hoverId = caster; this.clear(this.highlight);
    if (!caster) return null;
    const outline = (y) => new T.Line(new T.BufferGeometry().setFromPoints(caster.ring.map(([x, z]) => new T.Vector3(x, y, -z))), new T.LineBasicMaterial({ color: DATA_INK.hover, depthTest: false, transparent: true }));
    const roof = outline(caster.height + 1.2), base = outline(caster.base + 1);
    base.material.opacity = .45; roof.renderOrder = base.renderOrder = 5;
    this.highlight.add(roof, base);
    return caster;
  }
}

function insideRing(ring, [x, y]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
/** Wall hits land exactly on the outline, where the even-odd test is unstable. */
function nearRing(ring, [x, y], eps) {
  for (let i = 1; i < ring.length; i++) {
    const [ax, ay] = ring[i - 1], [bx, by] = ring[i], vx = bx - ax, vy = by - ay, len = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / len));
    if (Math.hypot(ax + vx * t - x, ay + vy * t - y) < eps) return true;
  }
  return false;
}
