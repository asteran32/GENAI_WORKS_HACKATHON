import * as T from '/vendor/scene-vendor.mjs';
import { mistField, mistHeatRgb } from './mist-model.mjs';
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
const LAYER_Y = { base: -8, water: 2.2, shade: 3.4, cells: 4.2, bounds: 14, roadBase: 0.35, walk: 5.5, route: 8 };
const CANVAS = '#f8fafc';
const DATA_INK = { shade: '#1d4ed8', cells: '#1e40af', bounds: '#1d4ed8', hover: '#1d4ed8' };
const COOL = new T.Color('#256c9a'), WARM = new T.Color('#e6aa54'), HOT = new T.Color('#bb4035');
function temperatureColor(celsius) {
  const t = Math.max(0, Math.min(1, (celsius - 20) / 20));
  return new T.Color().lerpColors(t < .5 ? COOL : WARM, t < .5 ? WARM : HOT, t < .5 ? t * 2 : (t - .5) * 2);
}
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
    this.renderer.domElement.setAttribute('aria-label', '시드니 건물, 시간별 그림자, 나무, 보행 계수, 과거 기온 관측 지점과 현재 기상 표현을 표시하는 3차원 지도'); element.append(this.renderer.domElement);
    this.labelsRoot = document.createElement('div'); this.labelsRoot.className = 'place-labels'; this.labelsRoot.setAttribute('aria-hidden', 'true'); element.append(this.labelsRoot);
    this.countLabelsRoot = document.createElement('div'); this.countLabelsRoot.className = 'count-labels'; this.countLabelsRoot.setAttribute('aria-hidden', 'true'); element.append(this.countLabelsRoot);
    this.temperatureLabelsRoot = document.createElement('div'); this.temperatureLabelsRoot.className = 'temperature-labels'; this.temperatureLabelsRoot.setAttribute('aria-hidden', 'true'); element.append(this.temperatureLabelsRoot);
    this.mistLabelsRoot = document.createElement('div'); this.mistLabelsRoot.className = 'mist-labels'; this.mistLabelsRoot.setAttribute('aria-hidden', 'true'); element.append(this.mistLabelsRoot); this.mistLabels = [];
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
    this.walk = new T.Group(); this.trees = new T.Group(); this.sites = new T.Group(); this.temperatures = new T.Group(); this.routes = new T.Group();
    this.mist = new T.Group(); this.scene.add(this.mist); this.mistEnabled = false;
    this.fogActors = []; this.fogPreview = new T.Group(); this.fogPreview.visible = false; this.scene.add(this.fogPreview);
    this.weather = new T.Group(); this.weatherData = null; this.weatherEnabled = false; this.weatherClouds = []; this.weatherRain = null; this.weatherRainBase = null; this.weatherWind = null;
    this.scene.add(this.ground, this.shades, this.cells, this.buildings, this.edges, this.walk, this.trees, this.sites, this.temperatures, this.routes, this.weather, this.highlight);
    this.shadeCasters = []; this.excluders = []; this.landmarks = []; this.focusId = null; this._ndc = new T.Vector3(); this._sun = null;
    this.treeCanopies = []; this.countSites = []; this._shadePending = null; this._shadePaintedAt = 0;
    this.temperatureSites = [];
    this.layers = { shade: true, cells: true };
    this.raycaster = new T.Raycaster(); this._pointer = new T.Vector2(); this.hoverId = null; this.onMapClick = null;
    let down = null;
    this.renderer.domElement.addEventListener('pointerdown', event => { down = [event.clientX, event.clientY]; });
    this.renderer.domElement.addEventListener('pointerup', event => {
      if (event.button !== 0 || !down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5 || !this.onMapClick || !this.area) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      const mouse = new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
      const ray = new T.Raycaster(); ray.setFromCamera(mouse, this.camera); const hit = new T.Vector3();
      if (this.mistEnabled && this.onMistObjectClick) {
        const objectHit = ray.intersectObjects(this.mist.children,true).find(item => Number.isInteger(item.object.parent?.userData.fogIndex));
        if (objectHit && this.onMistObjectClick(objectHit.object.parent.userData.fogIndex)) return;
      }
      // Mist cells are displayed on an analysis plane at y=10. Probe that same
      // plane so a click matches the colored cell rather than a point behind it.
      if (!ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), this.useMistPickPlane?.() ? -10 : 0), hit)) return;
      const lon = this.area.longitude + hit.x / (RAD * R * Math.cos(this.area.latitude * RAD)), lat = this.area.latitude - hit.z / (RAD * R);
      if (lon >= this.area.west && lon <= this.area.east && lat >= this.area.south && lat <= this.area.north) this.onMapClick([lon, lat]);
    });
    this.observer = new ResizeObserver(() => { const w = element.clientWidth, h = element.clientHeight; if (!w || !h) return; this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }); this.observer.observe(element);
    this.renderer.setAnimationLoop(() => {
      if (this._shadePending && performance.now() - this._shadePaintedAt > 130) {
        const next = this._shadePending; this._shadePending = null;
        this.updateShadeAreas(next); this._shadePaintedAt = performance.now();
      }
      this.scaleControlsToZoom();
      this.controls.update();
      this.animateWeather();
      this.animateFog();
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
  clear(group) { for (const child of [...group.children]) { if (child.children.length) this.clear(child); child.geometry?.dispose(); const materials = Array.isArray(child.material) ? child.material : [child.material]; for (const material of materials) { material?.map?.dispose(); material?.dispose(); } group.remove(child); } }
  mistGround(x, y) {
    if (!this._mistMask) this._mistMask = this.excluders.map(rings => {
      const xs = rings[0].map(p => p[0]), ys = rings[0].map(p => p[1]);
      return { rings, west: Math.min(...xs), east: Math.max(...xs), south: Math.min(...ys), north: Math.max(...ys) };
    });
    const [west, south] = this.project([this.area.west, this.area.south]), [east, north] = this.project([this.area.east, this.area.north]);
    if (!this._mistMaskIndex) {
      this._mistMaskIndex = new Map();
      for (const b of this._mistMask) {
        for(let i=Math.floor(Math.max(west,b.west)/100);i<=Math.floor(Math.min(east,b.east)/100);i++) {
          for(let j=Math.floor(Math.max(south,b.south)/100);j<=Math.floor(Math.min(north,b.north)/100);j++) {
            const key=`${i}:${j}`; if(!this._mistMaskIndex.has(key))this._mistMaskIndex.set(key,[]); this._mistMaskIndex.get(key).push(b);
          }
        }
      }
    }
    const candidates=this._mistMaskIndex.get(`${Math.floor(x/100)}:${Math.floor(y/100)}`)||[];
    return x >= west && x <= east && y >= south && y <= north && !candidates.some(b =>
      x >= b.west && x <= b.east && y >= b.south && y <= b.north && insideRing(b.rings[0], [x,y]) && !b.rings.slice(1).some(r => insideRing(r, [x,y])));
  }
  setMistBackdrop(visible) {
    if (!this.mistBackdrop) { this.mistBackdrop=new T.Group(); this.scene?.add(this.mistBackdrop); }
    this.mistBackdrop.visible=visible;
    if(!visible || this.mistBackdrop.children.length || !this.area)return;
    const [west,south]=this.project([this.area.west,this.area.south]),[east,north]=this.project([this.area.east,this.area.north]);
    // Cached 10 m ground mask, independent of the 2 m local cooling samples.
    const positions=[];
    for(let x=west+5;x<east;x+=10)for(let y=south+5;y<north;y+=10)if(this.mistGround(x,y))positions.push([x,y]);
    const geometry=new T.PlaneGeometry(10,10);geometry.rotateX(-Math.PI/2);
    const mesh=new T.InstancedMesh(geometry,new T.MeshBasicMaterial({color:'#e85d4a',transparent:true,opacity:.65,side:T.DoubleSide,depthWrite:false,depthTest:false}),positions.length);
    const matrix=new T.Matrix4();positions.forEach(([x,y],i)=>mesh.setMatrixAt(i,matrix.makeTranslation(x,9.9,-y)));
    mesh.instanceMatrix.needsUpdate=true;mesh.renderOrder=17;this.mistBackdrop.add(mesh);
  }
  focusMist(point) {
    const [x,y] = this.project(point);
    this.controls.target.set(x,0,-y);
    this.camera.position.set(x + 30, 80, -y + 45);
    this.controls.update();
  }
  groundPoint(clientX, clientY) {
    if (!this.area) return null;
    const rect = this.renderer.domElement.getBoundingClientRect(), ray = new T.Raycaster(), hit = new T.Vector3();
    ray.setFromCamera(new T.Vector2((clientX-rect.left)/rect.width*2-1,1-(clientY-rect.top)/rect.height*2),this.camera);
    if (!ray.ray.intersectPlane(new T.Plane(new T.Vector3(0,1,0),-10),hit)) return null;
    const lon=this.area.longitude+hit.x/(RAD*R*Math.cos(this.area.latitude*RAD)),lat=this.area.latitude-hit.z/(RAD*R);
    return lon>=this.area.west && lon<=this.area.east && lat>=this.area.south && lat<=this.area.north ? [lon,lat] : null;
  }
  setFogPreview(point) {
    if (!this.fogPreview) return;
    this.fogPreview.visible = !!point && this.mistEnabled;
    if (!point) return;
    if (!this.fogPreview.children.length) {
      const ring=new T.Mesh(new T.RingGeometry(2.4,2.8,32),new T.MeshBasicMaterial({color:'#16a34a',side:T.DoubleSide,depthTest:false,depthWrite:false}));
      ring.rotation.x=-Math.PI/2; ring.renderOrder=30; this.fogPreview.add(ring);
    }
    const [x,y]=this.project(point),valid=this.mistGround(x,y);
    this.fogPreview.position.set(x,10.2,-y); this.fogPreview.children[0].material.color.set(valid?'#16a34a':'#dc2626');
  }
  animateFog() {
    if (!this.fogActors?.length) return;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const time = reduced ? 1200 : performance.now();
    for (const actor of this.fogActors) {
      const p=actor.geometry.attributes.position;
      for(let i=0;i<p.count;i++) {
        const phase=(time/2800+i*.618033)%1, nozzle=i%10;
        p.setXYZ(i,.5+nozzle*.75+Math.sin(i*2.4)*phase*3,9.3-phase*8,Math.cos(i*1.9)*phase*4);
      }
      p.needsUpdate=true;
    }
  }
  setMistScenario({ sites = [], model = null, radiusM = 12, heatSpanC = 2, view = 'delta', enabled = false, probe = null, reading = null, selected = -1, spraying = true }) {
    if (this.mistEnabled && !enabled && this._sun) this._shadePending = this._sun;
    this.mistEnabled = enabled;
    this.setMistBackdrop(enabled && !!model && view !== 'delta');
    this.shades.visible = !enabled && !!this._sun?.daytime;
    this.cells.visible = !enabled && this.layers.cells && !this.cellsStale;
    this.clear(this.mist);
    this.fogActors = [];
    this.mistLabelsRoot?.replaceChildren(); this.mistLabels = [];
    if (!enabled || !this.area) return;
    const addLabel = (x,y,title,detail,selected=false) => {
      if (!this.mistLabelsRoot) return;
      const el = document.createElement('div'), heading = document.createElement('span'), text = document.createElement('strong');
      el.className = `mist-label${selected ? ' mist-label-selected' : ''}`;
      heading.textContent = title; text.textContent = detail; el.append(heading,text); this.mistLabelsRoot.append(el);
      this.mistLabels.push({ el, world:new T.Vector3(x,12,-y) });
    };
    const points = sites.map(point => { const [x,y] = this.project(point); return { x,y }; });
    for (const [index, { x,y }] of points.entries()) {
      // Enlarged schematic of the catalog's L-shaped, LED-equipped 10-nozzle pole.
      // Dimensions and particle motion are illustrative, not product CAD/CFD.
      const pole=new T.Group(); pole.position.set(x,10,-y); pole.userData.fogIndex=index;
      const part=(geometry,color,position)=>{const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({color,depthTest:false,depthWrite:false}));mesh.position.set(...position);mesh.renderOrder=24;pole.add(mesh);};
      part(new T.CylinderGeometry(1,1.3,.5,12),index===selected?'#f59e0b':'#475569',[0,.25,0]);
      part(new T.BoxGeometry(.8,10,.8),'#64748b',[0,5,0]);
      part(new T.BoxGeometry(8,.65,.8),'#334155',[4,10,0]);
      part(new T.BoxGeometry(7,.15,.85),'#fef3c7',[4,9.6,0]);
      for(let n=0;n<10;n++) part(new T.SphereGeometry(.2,6,4),'#38bdf8',[.5+n*.75,9.3,0]);
      if (spraying && view !== 'before') {
        const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(150*3),3));
        const spray=new T.Points(geometry,new T.PointsMaterial({color:'#bae6fd',size:.8,transparent:true,opacity:.55,depthWrite:false,depthTest:false}));
        spray.renderOrder=23; spray.frustumCulled=false; pole.add(spray); this.fogActors.push(spray);
      }
      this.mist.add(pole);
      const outline = new T.Mesh(new T.RingGeometry(radiusM - .35, radiusM, 64), new T.MeshBasicMaterial({ color: '#0284c7', side: T.DoubleSide, depthTest: false, depthWrite: false }));
      outline.rotation.x = -Math.PI / 2; outline.position.set(x, 10, -y); outline.renderOrder = 20; this.mist.add(outline);
      if (!probe || Math.hypot(x-this.project(probe)[0], y-this.project(probe)[1]) > 3) {
        addLabel(x,y,`미스트 분사기 ${index + 1} · 근처 공기`,model ? `${model.beforeC.toFixed(1)} → ${model.afterC.toFixed(1)}°C` : '기상 입력 대기');
      }
    }
    if (probe) {
      const [x,y] = this.project(probe);
      const marker = new T.Mesh(new T.RingGeometry(1,1.7,32),new T.MeshBasicMaterial({color:'#0f172a',side:T.DoubleSide,depthTest:false,depthWrite:false}));
      marker.rotation.x=-Math.PI/2; marker.position.set(x,10.5,-y); marker.renderOrder=22; this.mist.add(marker);
      addLabel(x,y,'선택 위치 · 공기온도 추정',reading ? `${reading.beforeC.toFixed(1)} → ${reading.afterC.toFixed(1)}°C · −${reading.dropC.toFixed(1)}°C` : '계산값 없음',true);
    }
    this.animateFog();
    if (!model || view === 'before' || model.dropC < .005) return;
    // Use identical footprints in before/after views, including zero-effect cases.
    const referenceDrop = Math.max(.1, model.dropC);
    const samples = mistField(points, referenceDrop, radiusM).filter(p => this.mistGround(p.x, p.y));
    if (!samples.length) return;
    const geometry = new T.PlaneGeometry(2, 2); geometry.rotateX(-Math.PI / 2);
    const mesh = new T.InstancedMesh(geometry, new T.MeshBasicMaterial({ transparent: true, opacity: .8, depthWrite: false, depthTest: false, side: T.DoubleSide }), samples.length);
    const matrix = new T.Matrix4(), pale = new T.Color('#e0f2fe'), blue = new T.Color('#0369a1');
    samples.forEach((p, i) => {
      const drop = p.dropC * model.dropC / referenceDrop;
      const color = view === 'delta' ? pale.clone().lerp(blue, Math.min(1, drop / 5)) : new T.Color(`rgb(${mistHeatRgb(view === 'after' ? drop : 0,heatSpanC).join(',')})`);
      mesh.setMatrixAt(i, matrix.makeTranslation(p.x, 10, -p.y)); mesh.setColorAt(i, color);
    });
    mesh.renderOrder = 19; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    this.mist.add(mesh);
  }
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
    const w = this.element.clientWidth, h = this.element.clientHeight;
    for (const label of this.mistLabels || []) {
      this._ndc.copy(label.world).project(this.camera);
      const visible = this.mistEnabled && this._ndc.z > -1 && this._ndc.z < 1 && Math.abs(this._ndc.x) < .95 && Math.abs(this._ndc.y) < .9;
      label.el.hidden = !visible;
      if (visible) label.el.style.transform = `translate(${(this._ndc.x*.5+.5)*w}px,${(-this._ndc.y*.5+.5)*h}px) translate(-50%,-150%)`;
    }
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
    for (const site of this.countSites) {
      this._ndc.copy(site.world).project(this.camera);
      const visible = this.sites.visible && this._ndc.z > -1 && this._ndc.z < 1 && Math.abs(this._ndc.x) <= .96 && Math.abs(this._ndc.y) <= .88;
      site.el.hidden = !visible;
      if (visible) site.el.style.transform = `translate(${(this._ndc.x * .5 + .5) * w}px, ${(-this._ndc.y * .5 + .5) * h}px) translate(-50%, -120%)`;
    }
    const centre = this.controls.target;
    const closest = new Set(this.temperatureSites.slice().sort((a, b) =>
      (a.x - centre.x) ** 2 + (a.y + centre.z) ** 2 - (b.x - centre.x) ** 2 - (b.y + centre.z) ** 2,
    ).slice(0, 8));
    for (const site of this.temperatureSites) {
      this._ndc.copy(site.world).project(this.camera);
      const visible = this.temperatures.visible && closest.has(site) && this._ndc.z > -1 && this._ndc.z < 1 && Math.abs(this._ndc.x) <= .94 && Math.abs(this._ndc.y) <= .87;
      site.el.hidden = !visible;
      if (visible) site.el.style.transform = `translate(${(this._ndc.x * .5 + .5) * w}px, ${(-this._ndc.y * .5 + .5) * h}px) translate(-50%, -125%)`;
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
    this._mistMask = null;
    this._mistMaskIndex = null;
    if(this.mistBackdrop)this.clear(this.mistBackdrop);
    this.area = snapshot.area; for (const g of [this.buildings, this.ground, this.edges, this.shades, this.cells, this.highlight, this.temperatures]) this.clear(g);
    this.temperatureSites = []; this.temperatureLabelsRoot.replaceChildren();
    this.shadeCasters = []; this.excluders = []; this.hoverId = null; this._estimateMask = null; this._shadeRaster = null;
    this.tuneAtmosphere();
    this.setLiveWeather(this.weatherData, this.weatherEnabled);
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
        if (building) {
          addGroup(`${p.source_tile}:b-unknown`, { p, building: true, known: false, kind: 'building-unknown', color: '#eef1f3' }, this.extrudeBuilding(shape, .4, 0));
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
    if (this._sun) { this._shadePending = null; this.updateShadeAreas(this._sun); }
  }
  /** Rasterise the union of projected roofs and wall strips before a small blur.
   * The soft edge is presentation only; server ray intersections remain authoritative. */
  updateShadeAreas(sun) {
    const daylight = sun?.daytime ?? (sun && sun.altitude > 0);
    if (this.mistEnabled || !daylight || !this.shadeCasters.length) { this.shades.visible = false; return; }
    this.shades.visible = true;
    const [west, south] = this.project([this.area.west, this.area.south]);
    const [east, north] = this.project([this.area.east, this.area.north]);
    const spanX = east - west, spanY = north - south;
    const metresPerPixel = Math.max(2.5, spanX / 1400, spanY / 1400);
    const width = Math.ceil(spanX / metresPerPixel), height = Math.ceil(spanY / metresPerPixel);
    if (!this._shadeRaster || this._shadeRaster.width !== width || this._shadeRaster.height !== height) {
      this.clear(this.shades);
      const mask = document.createElement('canvas'); mask.width = width; mask.height = height;
      const softened = document.createElement('canvas'); softened.width = width; softened.height = height;
      const texture = new T.CanvasTexture(softened); texture.colorSpace = T.SRGBColorSpace;
      const material = new T.MeshBasicMaterial({
        color: DATA_INK.shade, map: texture, transparent: true, opacity: .33,
        depthWrite: false, depthTest: true, side: T.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const mesh = new T.Mesh(new T.PlaneGeometry(spanX, spanY), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((west + east) / 2, LAYER_Y.shade, -(south + north) / 2);
      mesh.renderOrder = 1;
      this.shades.add(mesh);
      this._shadeRaster = { width, height, mask, softened, texture, mesh, ctx: mask.getContext('2d'), soft: softened.getContext('2d') };
    }
    const { mask, texture, mesh, ctx, soft } = this._shadeRaster;
    ctx.clearRect(0, 0, width, height);
    const px = x => (x - west) / metresPerPixel, py = y => (north - y) / metresPerPixel;
    const draw = ring => {
      ctx.beginPath();
      ring.forEach(([x, y], i) => i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y)));
      ctx.closePath(); ctx.fill();
    };
    const azimuth = sun.azimuth * RAD;
    const scale = 1 / Math.tan(Math.max(sun.altitude, 2) * RAD);
    ctx.fillStyle = '#fff';
    for (const b of this.shadeCasters) {
      const ring = b.ring.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      if (ring.length < 3) continue;
      if (Math.hypot(ring[0][0] - ring.at(-1)[0], ring[0][1] - ring.at(-1)[1]) < 1e-6) ring.pop();
      const shift = height => Math.min(height * scale, MAX_SHADE_M);
      const lo = shift(b.base), hi = shift(b.height);
      const from = ring.map(([x, y]) => [x - Math.sin(azimuth) * lo, y - Math.cos(azimuth) * lo]);
      const tip = ring.map(([x, y]) => [x - Math.sin(azimuth) * hi, y - Math.cos(azimuth) * hi]);
      draw(tip);
      for (let i = 0; i < ring.length; i++) draw([from[i], from[(i + 1) % ring.length], tip[(i + 1) % ring.length], tip[i]]);
    }
    // Modelled crowns read as softer, lighter ground shade than solid buildings.
    ctx.fillStyle = 'rgba(255,255,255,.50)';
    for (const tree of this.treeCanopies) {
      const drop = Math.min(tree.height * .7 * scale, MAX_SHADE_M);
      const x = px(tree.x - Math.sin(azimuth) * drop), y = py(tree.y - Math.cos(azimuth) * drop);
      ctx.beginPath(); ctx.ellipse(x, y, tree.radius / metresPerPixel, tree.radius / metresPerPixel * .82, 0, 0, Math.PI * 2); ctx.fill();
    }
    soft.clearRect(0, 0, width, height);
    soft.filter = `blur(${Math.max(1.2, 3.2 / metresPerPixel).toFixed(1)}px)`;
    soft.drawImage(mask, 0, 0);
    texture.needsUpdate = true;
    mesh.visible = this.layers.shade;
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
    const cloudFactor = this.weatherEnabled && this.weatherData ? 1 - this.weatherData.cloud_cover_pct / 100 * .24 : 1;
    this.sun.intensity = daylight ? (1.2 + day * 0.3) * cloudFactor : 0.15;
    this.hemi.intensity = daylight ? 1.45 : 1.15;
    this.ambient.intensity = daylight ? 0.85 : 0.75;
    this._shadePending = sun;
  }
  /** One CBD model point controls a uniform ambient tint and illustrative weather particles. */
  setLiveWeather(weather, enabled = true) {
    this.weatherData = weather;
    this.weatherEnabled = !!enabled && !!weather;
    this.clear(this.weather); this.weatherClouds = []; this.weatherRain = null; this.weatherRainBase = null; this.weatherWind = null;
    this.scene.background = new T.Color(CANVAS);
    this.scene.fog.color.set(CANVAS);
    if (!this.weatherEnabled || !this.area) { if (this._sun) this.setSunLight(this._sun); return; }
    const span = this.areaSpan(), cloud = weather.cloud_cover_pct / 100;
    const tint = temperatureColor(weather.temperature_c);
    const backdrop = new T.Color(CANVAS).lerp(tint, .07);
    this.scene.background = backdrop; this.scene.fog.color.copy(backdrop);
    const plane = new T.Mesh(new T.PlaneGeometry(span * 1.1, span * 1.1), new T.MeshBasicMaterial({ color: tint, transparent: true, opacity: .11, depthWrite: false, side: T.DoubleSide }));
    plane.rotation.x = -Math.PI / 2; plane.position.y = LAYER_Y.base + .4; plane.renderOrder = 0; this.weather.add(plane);
    const cloudCount = Math.round(cloud * 7);
    for (let i = 0; i < cloudCount; i++) {
      const cluster = new T.Group(), width = 85 + (i % 3) * 24;
      for (let j = 0; j < 3; j++) {
        const puff = new T.Mesh(new T.SphereGeometry(1, 12, 8), new T.MeshBasicMaterial({ color: '#dbe6ed', transparent: true, opacity: .16 + cloud * .11, depthWrite: false }));
        puff.scale.set(width * (j === 1 ? .75 : .56), 8 + j * 3, width * .25);
        puff.position.set((j - 1) * width * .48, j * 2, (j % 2) * 12);
        cluster.add(puff);
      }
      cluster.position.set((i * 0.618 % 1 - .5) * span, 155 + (i % 3) * 35, (i * .381 % 1 - .5) * span);
      this.weather.add(cluster); this.weatherClouds.push(cluster);
    }
    if (weather.wind_speed_kmh >= 5) {
      const angle = weather.wind_direction_deg * RAD, vx = -Math.sin(angle), vz = Math.cos(angle);
      const positions = new Float32Array(28 * 6);
      for (let i = 0; i < 28; i++) {
        const x = (Math.random() - .5) * span, z = (Math.random() - .5) * span, y = 18 + (i % 4) * 8;
        positions.set([x, y, z, x + vx * 34, y, z + vz * 34], i * 6);
      }
      const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
      this.weatherWind = new T.LineSegments(geometry, new T.LineBasicMaterial({ color: '#548fb5', transparent: true, opacity: .27, depthWrite: false }));
      this.weather.add(this.weatherWind);
    }
    if (weather.precipitation_mm > 0) {
      const count = Math.min(650, Math.max(140, Math.round(180 + weather.precipitation_mm * 95)));
      const positions = new Float32Array(count * 6), base = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        const x = (Math.random() - .5) * span, z = (Math.random() - .5) * span, y = 10 + Math.random() * 190;
        base.set([x, z], i * 2); positions.set([x, y, z, x + 4, y - 17, z + 2], i * 6);
      }
      const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
      this.weatherRain = new T.LineSegments(geometry, new T.LineBasicMaterial({ color: '#458bb5', transparent: true, opacity: .37, depthWrite: false }));
      this.weatherRainBase = base; this.weather.add(this.weatherRain);
    }
    this._weatherFrame = performance.now();
    if (this._sun) this.setSunLight(this._sun);
  }
  animateWeather() {
    if (!this.weatherEnabled || !this.area || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const now = performance.now(), dt = Math.min(.05, Math.max(0, (now - (this._weatherFrame || now)) / 1000));
    this._weatherFrame = now;
    const wind = (this.weatherData.wind_direction_deg || 0) * RAD, speed = this.weatherData.wind_speed_kmh / 3.6;
    const dx = -Math.sin(wind) * speed * dt * 1.5, dz = Math.cos(wind) * speed * dt * 1.5, span = this.areaSpan();
    for (const cloud of this.weatherClouds) {
      cloud.position.x += dx; cloud.position.z += dz;
      if (cloud.position.x > span * .6) cloud.position.x -= span * 1.2;
      if (cloud.position.x < -span * .6) cloud.position.x += span * 1.2;
      if (cloud.position.z > span * .6) cloud.position.z -= span * 1.2;
      if (cloud.position.z < -span * .6) cloud.position.z += span * 1.2;
    }
    if (this.weatherWind) {
      const attr = this.weatherWind.geometry.attributes.position, positions = attr.array;
      for (let i = 0; i < positions.length; i += 6) {
        positions[i] += dx * 3; positions[i + 3] += dx * 3;
        positions[i + 2] += dz * 3; positions[i + 5] += dz * 3;
        if (positions[i] > span * .5) { positions[i] -= span; positions[i + 3] -= span; }
        if (positions[i] < -span * .5) { positions[i] += span; positions[i + 3] += span; }
        if (positions[i + 2] > span * .5) { positions[i + 2] -= span; positions[i + 5] -= span; }
        if (positions[i + 2] < -span * .5) { positions[i + 2] += span; positions[i + 5] += span; }
      }
      attr.needsUpdate = true;
    }
    if (!this.weatherRain) return;
    const attr = this.weatherRain.geometry.attributes.position, positions = attr.array;
    for (let i = 0; i < this.weatherRainBase.length / 2; i++) {
      const k = i * 6, y = positions[k + 1] - dt * 145;
      positions[k + 1] = y < 5 ? 190 : y; positions[k + 4] = positions[k + 1] - 17;
      positions[k] += dx * 2; positions[k + 3] += dx * 2;
      positions[k + 2] += dz * 2; positions[k + 5] += dz * 2;
      if (positions[k] > span * .5) { positions[k] -= span; positions[k + 3] -= span; }
      if (positions[k] < -span * .5) { positions[k] += span; positions[k + 3] += span; }
      if (positions[k + 2] > span * .5) { positions[k + 2] -= span; positions[k + 5] -= span; }
      if (positions[k + 2] < -span * .5) { positions[k + 2] += span; positions[k + 5] += span; }
    }
    attr.needsUpdate = true;
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
    this.cells.visible = this.layers.cells && !this.mistEnabled;
  }
  /** Verified samples describe one instant; hide them once the clock moves away. */
  setCellsStale(stale) { this.cellsStale = stale; this.cells.visible = this.layers.cells && !stale && !this.mistEnabled; }
  setLayer(name, on) {
    if (name === 'buildings') { this.buildings.visible = on; this.edges.visible = on; return; }
    if (name === 'ground') { this.ground.visible = on; return; }
    if (name === 'walk' || name === 'trees' || name === 'sites' || name === 'temperatures') { this[name].visible = on; return; }
    this.layers[name] = on;
    if (name === 'shade') this.shades.children.forEach(m => { m.visible = on; });
    if (name === 'cells') this.cells.visible = on && !this.cellsStale && !this.mistEnabled;
  }
  /** CBD walk network, street trees, and pedestrian count sites. */
  setCBDLayers(data) {
    for (const group of [this.walk, this.trees, this.sites, this.routes]) this.clear(group);
    this.treeCanopies = []; this.countSites = []; this.countLabelsRoot.replaceChildren();
    const vertices = [];
    for (const edge of data.walk_edges || []) for (const point of edge.geometry.coordinates) {
      const [x, y] = this.project(point); vertices.push(x, LAYER_Y.walk, -y);
    }
    if (vertices.length) {
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
      this.walk.add(new T.LineSegments(geometry, new T.LineBasicMaterial({ color: '#0ea5e9', transparent: true, opacity: .7, depthWrite: false })));
    }
    const trees = (data.trees || []).filter(row => Number.isFinite(row.lon) && Number.isFinite(row.lat));
    if (trees.length) {
      const crowns = new T.InstancedMesh(new T.IcosahedronGeometry(1, 1), new T.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true, side: T.DoubleSide }), trees.length);
      const trunks = new T.InstancedMesh(new T.CylinderGeometry(.16, .22, 1, 5), new T.MeshStandardMaterial({ color: '#827f71', roughness: 1 }), trees.length);
      const matrix = new T.Matrix4(), color = new T.Color();
      trees.forEach((row, i) => {
        const [x, y] = this.project([row.lon, row.lat]);
        const h = Math.max(3, Math.min(40, row.height_m || 8));
        const radius = row.canopy_diameter_m != null ? Math.max(.6, row.canopy_diameter_m / 2) : 1.15;
        const crownY = h * .71, crownH = Math.max(1.6, h * .29);
        matrix.makeScale(radius, crownH, radius); matrix.setPosition(x, crownY, -y); crowns.setMatrixAt(i, matrix);
        matrix.makeScale(1, h * .51, 1); matrix.setPosition(x, h * .255, -y); trunks.setMatrixAt(i, matrix);
        color.set(['#3e765e', '#4c8467', '#5d906c', '#3d8068'][i % 4]); crowns.setColorAt(i, color);
        if (row.canopy_diameter_m != null) this.treeCanopies.push({ x, y, height: h, radius });
      });
      crowns.instanceMatrix.needsUpdate = trunks.instanceMatrix.needsUpdate = true;
      crowns.instanceColor.needsUpdate = true;
      crowns.frustumCulled = trunks.frustumCulled = false;
      this.trees.add(trunks, crowns);
    }
    this.siteValues = new T.Group(); this.sites.add(this.siteValues);
    for (const row of data.pedestrian_sites || []) {
      const [x, y] = this.project([row.lon, row.lat]);
      const ring = new T.Mesh(new T.RingGeometry(4.3, 6.1, 32), new T.MeshBasicMaterial({ color: '#b45309', side: T.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(x, LAYER_Y.walk + .5, -y); this.sites.add(ring);
      const el = document.createElement('div'); el.className = 'count-label'; el.textContent = `${row.name || row.id} · —`;
      this.countLabelsRoot.append(el);
      this.countSites.push({ ...row, x, y, el, world: new T.Vector3(x, 11, -y) });
    }
    if (this._sun) { this._shadePending = this._sun; this._shadePaintedAt = 0; }
  }
  /** Each disc belongs to a measured site; size uses one fixed square-root scale. */
  setObservations(observed, hourLabel = '') {
    if (!this.siteValues) return;
    this.clear(this.siteValues);
    const counts = new Map((observed?.counts || []).map(row => [row.site_id, row]));
    for (const site of this.countSites) {
      const row = counts.get(site.id), value = row?.passages;
      site.el.replaceChildren();
      const name = document.createElement('span'), count = document.createElement('strong');
      name.textContent = site.name || site.id;
      count.textContent = value == null ? '미관측' : `${value.toLocaleString('ko-KR')}회/시간`;
      site.el.append(name, count);
      site.el.dataset.empty = String(value == null);
      site.el.title = `${site.id} · ${site.name || ''} · ${hourLabel} · ${value == null ? '유효 관측 없음' : `시간당 통과 ${value.toLocaleString('ko-KR')}회`} · 센서 위치`;
      if (value == null) continue;
      const radius = 3 + 13 * Math.sqrt(Math.min(value, 5000) / 5000);
      const disc = new T.Mesh(new T.CircleGeometry(radius, 40), new T.MeshBasicMaterial({ color: '#d97706', transparent: true, opacity: .72, side: T.DoubleSide, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2; disc.position.set(site.x, LAYER_Y.walk + .7, -site.y);
      this.siteValues.add(disc);
    }
  }
  /** Historical near-surface air temperature is drawn only at measured logger points. */
  setTemperatureLayer(observed) {
    this.clear(this.temperatures);
    this.temperatureSites = []; this.temperatureLabelsRoot.replaceChildren();
    if (!observed?.ready || !this.area) return;
    const ringGeometry = new T.RingGeometry(5.7, 8.2, 24);
    const capGeometry = new T.CylinderGeometry(5, 5, 1.4, 16);
    const stemGeometry = new T.CylinderGeometry(.55, .55, 7, 6);
    for (const row of observed.sites) {
      if (row.temperature_c == null) continue;
      const [x, y] = this.project([row.lon, row.lat]), color = temperatureColor(row.temperature_c);
      const ring = new T.Mesh(ringGeometry.clone(), new T.MeshBasicMaterial({ color, transparent: true, opacity: .48, side: T.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(x, LAYER_Y.walk + 1.1, -y);
      const stem = new T.Mesh(stemGeometry.clone(), new T.MeshBasicMaterial({ color: '#365064' }));
      stem.position.set(x, 10.5, -y);
      const cap = new T.Mesh(capGeometry.clone(), new T.MeshBasicMaterial({ color, side: T.DoubleSide }));
      cap.position.set(x, 14.5, -y);
      this.temperatures.add(ring, stem, cap);
      const el = document.createElement('div'); el.className = 'temperature-label';
      el.style.setProperty('--temp-color', color.getStyle());
      const value = document.createElement('strong'), street = document.createElement('span');
      value.textContent = `${row.temperature_c.toFixed(1)}°`; street.textContent = row.street;
      el.append(value, street); el.title = `${row.street}, ${row.suburb} · ${observed.reference_date} ${String(observed.hour).padStart(2, '0')}:00 AEDT · ${row.temperature_c.toFixed(1)}°C · ${row.samples}개 10분 관측 평균`;
      this.temperatureLabelsRoot.append(el);
      this.temperatureSites.push({ x, y, el, world: new T.Vector3(x, 17, -y) });
    }
    ringGeometry.dispose(); capGeometry.dispose(); stemGeometry.dispose();
  }
  /** Fastest (amber) vs lower-exposure (cyan) walk routes as raised ribbons. */
  setRoutes(result) {
    this.clear(this.routes);
    if (!result) return;
    for (const [route, color, height, width] of [[result.fastest, '#f59e0b', LAYER_Y.route, 6], [result.lower_exposure, '#14b8a6', LAYER_Y.route + 1, 3]]) {
      if (!route?.coordinates?.length) continue;
      const positions = [];
      for (let i = 1; i < route.coordinates.length; i++) {
        const a = this.project(route.coordinates[i - 1]), b = this.project(route.coordinates[i]);
        const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy); if (!length) continue;
        const nx = -dy / length * width / 2, ny = dx / length * width / 2;
        const p = [a[0] + nx, height, -a[1] - ny], q = [a[0] - nx, height, -a[1] + ny];
        const r = [b[0] + nx, height, -b[1] - ny], s = [b[0] - nx, height, -b[1] + ny];
        positions.push(...p, ...q, ...r, ...q, ...s, ...r);
      }
      if (!positions.length) continue;
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial({ color, side: T.DoubleSide, depthTest: false, depthWrite: false, transparent: true, opacity: .95 }));
      mesh.renderOrder = 10; this.routes.add(mesh);
    }
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
