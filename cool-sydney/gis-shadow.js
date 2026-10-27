'use strict';
const { project, insideRing } = require('./city-data');
const E = require('./src/engine');
const polygons = geometry => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
function inPolygon(rings, point) { return insideRing(rings[0], point) && !rings.slice(1).some(ring => insideRing(ring, point)); }
function inBox(b, p) { return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]; }
function box(rings) { const points = rings[0]; return [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]; }
function prepare(snapshot) {
  const buildings = [], water = [];
  for (const f of snapshot.features) {
    if (!['building', 'water'].includes(f.properties.layer)) continue;
    const p = f.properties, t = p.tile_bounds;
    const tile = t ? [...project(t.west, t.south, snapshot.area), ...project(t.east, t.north, snapshot.area)] : [-Infinity, -Infinity, Infinity, Infinity];
    for (const coords of polygons(f.geometry)) {
      const rings = coords.map(ring => ring.map(point => project(...point, snapshot.area)));
      const item = { rings, box: box(rings), tile, height: p.height_m, base: p.min_height_m || 0, casts: p.casts_shadow };
      (p.layer === 'building' ? buildings : water).push(item);
    }
  }
  return { buildings, water };
}
// Intersect the sunlight ray with the extruded polygon, preserving courtyards,
// elevated bases, concave outlines and tile boundaries. A sample is counted once.
function blocked(building, point, direction, tangent) {
  if (!building.casts || !Number.isFinite(building.height) || tangent <= 0) return false;
  let lo = building.base / tangent, hi = building.height / tangent;
  const bounds = building.box.map((v, i) => i < 2 ? Math.max(v, building.tile[i]) : Math.min(v, building.tile[i]));
  for (let axis = 0; axis < 2; axis++) {
    if (Math.abs(direction[axis]) < 1e-10) { if (point[axis] < bounds[axis] || point[axis] > bounds[axis + 2]) return false; }
    else { let a = (bounds[axis] - point[axis]) / direction[axis], b = (bounds[axis + 2] - point[axis]) / direction[axis]; if (a > b) [a, b] = [b, a]; lo = Math.max(lo, a); hi = Math.min(hi, b); }
  }
  if (lo >= hi) return false;
  const cuts = [lo, hi];
  for (const ring of building.rings) for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i], vx = b[0] - a[0], vy = b[1] - a[1], qx = a[0] - point[0], qy = a[1] - point[1];
    const cross = direction[0] * vy - direction[1] * vx; if (Math.abs(cross) < 1e-10) continue;
    const t = (qx * vy - qy * vx) / cross, u = (qx * direction[1] - qy * direction[0]) / cross;
    if (t > lo && t < hi && u >= 0 && u <= 1) cuts.push(t);
  }
  cuts.sort((a, b) => a - b);
  for (let i = 1; i < cuts.length; i++) { const t = (cuts[i - 1] + cuts[i]) / 2; if (inPolygon(building.rings, [point[0] + direction[0] * t, point[1] + direction[1] * t])) return true; }
  return false;
}
function validateInput(input) {
  const date = input?.date, hour = Number(input?.hour);
  if (!/^20\d\d-\d\d-\d\d$/.test(date || '') || !Number.isFinite(hour) || hour < 0 || hour >= 24) throw new Error('날짜와 시간(0–24 미만)을 확인하세요.');
  const check = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(+check) || check.toISOString().slice(0, 10) !== date) throw new Error('올바른 날짜가 아닙니다.');
  return { date, hour };
}
// Conservative broad phase: index clipped footprint/shadow envelopes into
// 100m cells. Exact polygon/ray tests below still decide every result.
function spatialIndex(items, bounds, envelope, cellM = 100) {
  const [west, south, east, north] = bounds;
  const width = Math.max(1, Math.ceil((east - west) / cellM)), height = Math.max(1, Math.ceil((north - south) / cellM));
  const buckets = new Map();
  for (const item of items) {
    const b = envelope(item);
    if (!b || b[0] > b[2] || b[1] > b[3] || b[2] < west || b[0] > east || b[3] < south || b[1] > north) continue;
    const x0 = Math.max(0, Math.min(width - 1, Math.floor((b[0] - west) / cellM))), x1 = Math.max(0, Math.min(width - 1, Math.floor((b[2] - west) / cellM)));
    const y0 = Math.max(0, Math.min(height - 1, Math.floor((b[1] - south) / cellM))), y1 = Math.max(0, Math.min(height - 1, Math.floor((b[3] - south) / cellM)));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const key = y * width + x;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    }
  }
  const empty = [];
  return point => {
    if (point[0] < west || point[0] > east || point[1] < south || point[1] > north) return empty;
    const x = Math.min(width - 1, Math.floor((point[0] - west) / cellM)), y = Math.min(height - 1, Math.floor((point[1] - south) / cellM));
    return buckets.get(y * width + x) || empty;
  };
}
function clippedBox(item) { return [Math.max(item.box[0], item.tile[0]), Math.max(item.box[1], item.tile[1]), Math.min(item.box[2], item.tile[2]), Math.min(item.box[3], item.tile[3])]; }
function shadowBox(item, direction, tangent) {
  if (!item.casts || !Number.isFinite(item.height)) return null;
  const b = clippedBox(item); if (b[0] > b[2] || b[1] > b[3]) return null;
  const dx = -direction[0] * item.height / tangent, dy = -direction[1] * item.height / tangent;
  return [b[0] + Math.min(0, dx), b[1] + Math.min(0, dy), b[2] + Math.max(0, dx), b[3] + Math.max(0, dy)];
}
function simulate(snapshot, input) {
  const { date, hour } = validateInput(input);
  const instant = E.localInstant(date, hour, snapshot.area.timezone);
  if (!Number.isFinite(+new Date(instant))) throw new Error('올바른 날짜가 아닙니다.');
  const sun = E.sunPosition(new Date(instant), snapshot.area.latitude, snapshot.area.longitude);
  const base = { datasetVersion: snapshot.version, date, hour, timezone: snapshot.area.timezone, instant, sun, model: 'LoD1 polygon ray intersection / flat terrain / 20m grid', resolutionM: 20, validationStatus: 'passed', createdAt: new Date().toISOString() };
  if (sun.altitude <= 0) return { ...base, daylight: false, shadePercent: null, cells: [], samples: 0, shadedSamples: 0 };
  const { buildings, water } = prepare(snapshot), direction = [Math.sin(sun.azimuth * Math.PI / 180), Math.cos(sun.azimuth * Math.PI / 180)], tangent = Math.tan(sun.altitude * Math.PI / 180);
  const sw = project(snapshot.area.west, snapshot.area.south, snapshot.area), ne = project(snapshot.area.east, snapshot.area.north, snapshot.area);
  const extent = [...sw, ...ne], footprints = spatialIndex([...buildings, ...water], extent, clippedBox);
  const shadows = spatialIndex(buildings, extent, b => shadowBox(b, direction, tangent));
  let samples = 0, shadedSamples = 0; const cells = [];
  for (let x = sw[0] + 10; x < ne[0]; x += 20) for (let y = sw[1] + 10; y < ne[1]; y += 20) {
    const point = [x, y];
    const covers = object => inBox(object.box, point) && inBox(object.tile, point) && inPolygon(object.rings, point);
    if (footprints(point).some(covers)) continue;
    samples++; if (shadows(point).some(b => blocked(b, point, direction, tangent))) { shadedSamples++; cells.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100]); }
  }
  return { ...base, daylight: true, samples, shadedSamples, shadePercent: samples ? Math.round(1000 * shadedSamples / samples) / 10 : null, cells, assumptions: ['지도 렌더링 높이 사용: 실측으로 검증되지 않은 시나리오', '건물·수면을 제외한 지면 표본이며 보행 가능 공간 비율이 아닙니다.', '수목·경사·기온·습도·복사열은 미반영; 그늘 비율을 냉방 수요로 환산하지 않습니다.', '자료 범위 밖의 그림자는 누락될 수 있습니다. 낮은 태양 고도에서 영향이 커집니다.'] };
}
module.exports = { polygons, inPolygon, prepare, blocked, simulate, validateInput, spatialIndex, clippedBox, shadowBox };
