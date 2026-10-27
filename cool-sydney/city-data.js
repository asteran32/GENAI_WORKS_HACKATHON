'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
// Bounded CBD fetch (≤16 z14 tiles). Wider than Town Hall so the city reads as continuous.
const AREA = Object.freeze({
  id: 'sydney-cbd-harbour',
  name: 'Sydney CBD · Harbour',
  west: 151.188,
  south: -33.885,
  east: 151.228,
  north: -33.848,
  longitude: 151.208,
  latitude: -33.8665,
  bufferM: 100,
  timezone: 'Australia/Sydney',
});
const EARTH = 6371008.8, RAD = Math.PI / 180;
function project(lon, lat, area = AREA) { return [(lon - area.longitude) * RAD * EARTH * Math.cos(area.latitude * RAD), (lat - area.latitude) * RAD * EARTH]; }
function unproject(x, y, area = AREA) { return [area.longitude + x / (RAD * EARTH * Math.cos(area.latitude * RAD)), area.latitude + y / (RAD * EARTH)]; }
function meters(raw) {
  if (raw == null) return null;
  const text = String(raw).trim(), metric = text.match(/^(\d+(?:\.\d+)?)\s*(?:m|metres|meters)?$/i), feet = text.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet)$/i), imperial = text.match(/^(\d+)'\s*(?:(\d+(?:\.\d+)?)")?$/);
  const value = metric ? +metric[1] : feet ? +feet[1] * .3048 : imperial ? +imperial[1] * .3048 + +(imperial[2] || 0) * .0254 : NaN;
  return Number.isFinite(value) && value >= 0 && value <= 600 ? value : null;
}
const samePoint = (a, b) => Math.abs(a[0] - b[0]) < 1e-8 && Math.abs(a[1] - b[1]) < 1e-8;
function ringFromGeometry(geometry) {
  if (!Array.isArray(geometry) || geometry.length < 4 || geometry.some(p => !p || !Number.isFinite(p.lon) || !Number.isFinite(p.lat))) return null;
  const points = geometry.map(p => [p.lon, p.lat]);
  return samePoint(points[0], points.at(-1)) && points.length <= 3000 ? points : null;
}
function stitchMembers(members) {
  const remaining = members.filter(m => m.type === 'way' && Array.isArray(m.geometry) && m.geometry.every(p => p && Number.isFinite(p.lon) && Number.isFinite(p.lat))).map(m => m.geometry.map(p => [p.lon, p.lat]));
  const rings = [];
  while (remaining.length) {
    let chain = remaining.pop();
    for (let tries = 0; tries < 2000 && !samePoint(chain[0], chain.at(-1)); tries++) {
      const index = remaining.findIndex(r => samePoint(chain.at(-1), r[0]) || samePoint(chain.at(-1), r.at(-1)) || samePoint(chain[0], r[0]) || samePoint(chain[0], r.at(-1)));
      if (index < 0) break;
      const ring = remaining.splice(index, 1)[0];
      if (samePoint(chain.at(-1), ring[0])) chain = chain.concat(ring.slice(1));
      else if (samePoint(chain.at(-1), ring.at(-1))) chain = chain.concat(ring.slice().reverse().slice(1));
      else if (samePoint(chain[0], ring.at(-1))) chain = ring.slice(0, -1).concat(chain);
      else chain = ring.slice().reverse().slice(0, -1).concat(chain);
    }
    if (chain.length >= 4 && chain.length <= 3000 && samePoint(chain[0], chain.at(-1))) rings.push(chain);
  }
  return rings;
}
function insideRing(ring, p) { let hit = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit; } return hit; }
function centroid(ring) { return [ring.slice(0, -1).reduce((s, p) => s + p[0], 0) / (ring.length - 1), ring.slice(0, -1).reduce((s, p) => s + p[1], 0) / (ring.length - 1)]; }
function normalize(raw, { area = AREA, fetchedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(raw?.elements) || raw.remark) throw new Error('Overpass 응답이 완전하지 않습니다. 부분 자료는 분석에 사용하지 않습니다.');
  const features = [], buildings = [], trees = [], facilities = [], roads = [];
  const membersOfBuildingRelations = new Set(raw.elements.filter(e => e.type === 'relation' && e.tags?.building && e.tags?.type === 'multipolygon').flatMap(e => (e.members || []).filter(m => m.type === 'way').map(m => m.ref)));
  let rejected = 0;
  for (const element of raw.elements) {
    const t = element.tags || {}, isBuilding = t.building && t.building !== 'no' || t['building:part'] && t['building:part'] !== 'no';
    if (isBuilding && ['way', 'relation'].includes(element.type)) {
      if (element.type === 'way' && membersOfBuildingRelations.has(element.id)) continue;
      let polygons = [];
      if (element.type === 'way') { const ring = ringFromGeometry(element.geometry); if (ring) polygons = [[ring]]; }
      else if (t.type === 'multipolygon') {
        const outer = stitchMembers((element.members || []).filter(m => m.role === 'outer' || !m.role)), inner = stitchMembers((element.members || []).filter(m => m.role === 'inner'));
        polygons = outer.map(ring => [ring, ...inner.filter(hole => insideRing(ring, hole[0]))]);
      }
      if (!polygons.length) { rejected++; continue; }
      const height = meters(t.height), minHeight = t.min_height === undefined ? 0 : meters(t.min_height);
      const usable = height !== null && height > 0 && minHeight !== null && minHeight < height;
      for (let index = 0; index < polygons.length; index++) {
        const id = `${element.type}/${element.id}/${index}`, geo = polygons[index], local = geo.map(ring => ring.map(p => project(...p, area)));
        const b = { id, osmId: element.id, osmType: element.type, rings: local, geoRings: geo, height: usable ? height : null, minHeight: usable ? minHeight : null, isPart: !!t['building:part'], name: t.name || t['addr:street'] || `OSM ${element.type} ${element.id}`, heightTag: t.height || null, heightSource: t['source:height'] || t.source || 'OSM contributor / source not stated', sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`, heightStatus: usable ? 'osm-height-tag' : 'unknown', footprintOnly: !usable };
        buildings.push(b);
      }
    }
    if (t.natural === 'tree' && element.type === 'node' && Number.isFinite(element.lon) && Number.isFinite(element.lat)) {
      const h = meters(t.height), diameter = meters(t['diameter_crown'] || t['crown_diameter']);
      trees.push({ id: `node/${element.id}`, longitude: element.lon, latitude: element.lat, position: project(element.lon, element.lat, area), height: h, crownDiameter: diameter, usable: h !== null && h > 0 && diameter !== null && diameter > 0, sourceUrl: `https://www.openstreetmap.org/node/${element.id}` });
    }
    if (['library', 'community_centre', 'social_centre'].includes(t.amenity)) {
      const c = element.center || element;
      if (Number.isFinite(c.lon) && Number.isFinite(c.lat)) facilities.push({ id: `${element.type}/${element.id}`, name: t.name || t.amenity, longitude: c.lon, latitude: c.lat, openingHours: t.opening_hours || null, wheelchair: t.wheelchair || null, coolingVerified: false, capacity: null, cost: null, sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}` });
      else if (Array.isArray(element.geometry)) { const ring = ringFromGeometry(element.geometry); if (ring) { const c = centroid(ring); facilities.push({ id: `${element.type}/${element.id}`, name: t.name || t.amenity, longitude: c[0], latitude: c[1], openingHours: t.opening_hours || null, wheelchair: t.wheelchair || null, coolingVerified: false, capacity: null, cost: null, sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}` }); } }
    }
    if (t.highway && element.type === 'way' && Array.isArray(element.geometry) && element.geometry.every(p => p && Number.isFinite(p.lon) && Number.isFinite(p.lat))) roads.push({ id: `way/${element.id}`, type: t.highway, foot: t.foot || null, access: t.access || null, geometry: element.geometry.map(p => [p.lon, p.lat]) });
  }
  // In Simple 3D Buildings, parts replace their parent envelope. Keep the parent's
  // outline, but never cast an additional uniform-height parent shadow on top.
  const parts = buildings.filter(b => b.isPart);
  for (const b of buildings) if (!b.isPart && parts.some(p => { const c = centroid(p.rings[0]); return insideRing(b.rings[0], c) && !b.rings.slice(1).some(h => insideRing(h, c)); })) { b.footprintOnly = true; b.heightStatus = 'parts-replace-envelope'; }
  for (const b of buildings) features.push({ type: 'Feature', id: b.id, geometry: { type: 'Polygon', coordinates: b.geoRings }, properties: Object.fromEntries(Object.entries(b).filter(([key]) => !['rings', 'geoRings'].includes(key))) });
  const hash = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
  return { area, version: `osm-${hash.slice(0, 12)}`, sourceHash: hash, fetchedAt, osmTimestamp: raw.osm3s?.timestamp_osm_base || null, dataKind: 'openstreetmap-real-features', buildings, trees, facilities, roads, geojson: { type: 'FeatureCollection', features }, counts: { buildings: buildings.length, heightKnown: buildings.filter(b => !b.footprintOnly).length, heightMissing: buildings.filter(b => b.heightStatus === 'unknown').length, partEnvelopes: buildings.filter(b => b.heightStatus === 'parts-replace-envelope').length, rejected, trees: trees.length, treesWithDimensions: trees.filter(t => t.usable).length, facilities: facilities.length }, attribution: '© OpenStreetMap contributors · ODbL', license: 'https://www.openstreetmap.org/copyright', limitations: ['OSM 등록 높이는 독립 실측으로 검증되지 않았습니다.', '높이 누락 건물은 평면 윤곽만 표시하며 그림자 계산에서 제외합니다.', '지형·경사·지붕 세부 형상은 제외한 LoD1 높이 압출입니다.', '형상을 받은 범위 밖 건물과 누락 객체의 그림자는 반영되지 않습니다.', '도로·시설 위치가 있다고 냉방 쉼터 운영·수용량이 확인된 것은 아닙니다.'] };
}
function query(area = AREA) {
  const southwest = project(area.west, area.south, area), northeast = project(area.east, area.north, area);
  const [west, south] = unproject(southwest[0] - area.bufferM, southwest[1] - area.bufferM, area), [east, north] = unproject(northeast[0] + area.bufferM, northeast[1] + area.bufferM, area);
  const bbox = `${south},${west},${north},${east}`;
  return `[out:json][timeout:45];(way["building"](${bbox});relation["building"]["type"="multipolygon"](${bbox});way["building:part"](${bbox});node["natural"="tree"](${bbox});nwr["amenity"~"^(library|community_centre|social_centre)$"](${bbox});way["highway"~"^(footway|pedestrian|path|steps)$"](${bbox}););out body geom;`;
}
function createCityStore(directory, transport = fetch) {
  const rawDir = path.join(directory, 'raw'), processed = path.join(directory, 'processed');
  fs.mkdirSync(rawDir, { recursive: true }); fs.mkdirSync(processed, { recursive: true });
  const rawFile = path.join(rawDir, 'sydney-town-hall-osm.json'), normalized = path.join(processed, 'sydney-town-hall.json');
  let snapshot = fs.existsSync(rawFile) ? normalize(JSON.parse(fs.readFileSync(rawFile, 'utf8')), { fetchedAt: fs.statSync(rawFile).mtime.toISOString() }) : null;
  let inFlight = null, lastAttempt = 0;
  const write = (location, data) => { fs.writeFileSync(`${location}.tmp`, JSON.stringify(data), { mode: 0o600 }); fs.renameSync(`${location}.tmp`, location); };
  return {
    metadata() { return snapshot ? { ...Object.fromEntries(Object.entries(snapshot).filter(([key]) => !['buildings', 'trees', 'facilities', 'roads', 'geojson'].includes(key))), ready: true } : { ready: false, area: AREA, message: '실제 건물 자료가 아직 저장되지 않았습니다.' }; },
    get() { if (!snapshot) throw new Error('실제 건물 자료를 먼저 가져와야 합니다.'); return snapshot; },
    async load() {
      if (snapshot) return snapshot;
      if (inFlight) return inFlight;
      if (Date.now() - lastAttempt < 30000) throw new Error('공개 데이터 서버 재시도는 30초 뒤에 가능합니다.');
      lastAttempt = Date.now();
      inFlight = (async () => {
        let response;
        try { response = await transport('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'CoolSydneyLocalPrototype/0.2 (single-area educational GIS demo)' }, body: new URLSearchParams({ data: query() }).toString(), signal: AbortSignal.timeout(55000), redirect: 'error' }); }
        catch { throw new Error('실제 건물 데이터 다운로드에 실패했습니다. 서버 터미널의 인터넷 권한과 Overpass 상태를 확인하세요.'); }
        if (!response.ok) throw new Error(`공개 데이터 서버 HTTP ${response.status}. 잠시 후 다시 시도하세요.`);
        const raw = await response.json(), candidate = normalize(raw);
        if (!candidate.buildings.length) throw new Error('요청 구역에서 건물 형상을 받지 못했습니다.');
        write(rawFile, raw); write(normalized, candidate); snapshot = candidate; return snapshot;
      })();
      try { return await inFlight; } finally { inFlight = null; }
    }
  };
}
module.exports = { AREA, project, unproject, meters, insideRing, normalize, query, createCityStore };
