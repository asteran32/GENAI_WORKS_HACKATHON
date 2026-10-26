'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { AREA } = require('./city-data');
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const LAYERS = ['building', 'transportation', 'water', 'landcover', 'landuse', 'poi'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function tileAt(lon, lat, z = 14) { const n = 2 ** z; return { x: Math.floor((lon + 180) / 360 * n), y: Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n), z }; }
function tilesForArea(area = AREA) {
  const marginLat = area.bufferM / 111195, marginLon = marginLat / Math.cos(area.latitude * Math.PI / 180);
  const a = tileAt(area.west - marginLon, area.north + marginLat), b = tileAt(area.east + marginLon, area.south - marginLat);
  const tiles = []; for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) tiles.push({ x, y, z: a.z });
  if (tiles.length > 16) throw new Error('이 프로토타입은 한 번에 최대 16개 타일만 가져옵니다.');
  return tiles;
}
function tileBounds({ x, y, z }) { const n = 2 ** z, lat = v => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) * 180 / Math.PI; return { west: x / n * 360 - 180, east: (x + 1) / n * 360 - 180, north: lat(y), south: lat(y + 1) }; }
function safeURL(value) { const u = new URL(value); if (u.protocol !== 'https:' || u.hostname !== 'tiles.openfreemap.org' || u.username || u.password) throw new Error('허용되지 않은 지도 타일 주소입니다.'); return u.href; }
function normalizeFeature(feature, layer, tile, source) {
  const geometry = feature.geometry, p = feature.properties || {};
  if (!geometry || !['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString', 'Point', 'MultiPoint'].includes(geometry.type)) return null;
  if (layer === 'poi' && !['library', 'community_centre', 'town_hall'].includes(p.subclass || p.class)) return null;
  const value = p.render_height == null ? null : Number(p.render_height), base = p.render_min_height == null ? 0 : Number(p.render_min_height);
  const known = Number.isFinite(value) && value > 0 && value <= 600 && Number.isFinite(base) && base >= 0 && base < value;
  const hidden = p.hide_3d === true || p.hide_3d === 1 || p.hide_3d === 'true';
  const id = hash(JSON.stringify([tile, layer, feature.id ?? null, geometry, p])).slice(0, 24);
  return { type: 'Feature', id, geometry, properties: { ...p, layer, source_url: source.url, source_tile: `${tile.z}/${tile.x}/${tile.y}`, source_hash: source.hash, tile_bounds: tileBounds(tile), osm_id: p.osm_id ?? feature.id ?? null, height_m: layer === 'building' && known ? value : null, min_height_m: layer === 'building' && known ? base : null, height_method: layer === 'building' ? (known ? 'openmaptiles-render-height-derived-or-default' : 'unknown') : null, casts_shadow: layer === 'building' && known && !hidden, cooling_verified: layer === 'poi' ? false : null } };
}
async function decode(bytes, tile, source) {
  const { VectorTile, Pbf } = await import('./vendor/scene-vendor.mjs');
  // Pbf 4 uses DataView(buffer) without byteOffset. Node pooled Buffers may
  // start inside an ArrayBuffer; copy to offset zero before reading doubles.
  const data = new VectorTile(new Pbf(new Uint8Array(bytes))), features = [];
  for (const name of LAYERS) { const layer = data.layers[name]; if (!layer) continue;
    for (let index = 0; index < layer.length; index++) { const f = layer.feature(index), normalized = normalizeFeature(f.toGeoJSON(tile.x, tile.y, tile.z), name, tile, source); if (normalized) features.push(normalized); }
  }
  return features;
}
async function parquet(action, args, env = process.env) {
  const python = env.COOL_SYDNEY_PYTHON || path.join(__dirname, '..', '.venv', 'bin', 'python');
  try { const r = await exec(python, [path.join(__dirname, 'parquet.py'), action, ...args], { maxBuffer: 48 * 1024 * 1024, timeout: 60000 }); return JSON.parse(r.stdout); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('Parquet: Python 실행 파일을 찾지 못했습니다. COOL_SYDNEY_PYTHON 설정을 확인하세요.');
    if (/No module named ['"]pyarrow/.test(error.stderr || '')) throw new Error('Parquet: PyArrow가 없습니다. .venv/bin/python -m pip install -r cool-sydney/requirements.txt 를 실행하세요.');
    if (/checksum mismatch/.test(error.stderr || '')) throw new Error('Parquet: 저장된 파일의 해시가 일치하지 않습니다. 원본 파일의 손상 여부를 확인하세요.');
    throw new Error(`Parquet ${action === 'write' ? '저장' : '읽기'}에 실패했습니다${error.killed ? ' (60초 시간 초과)' : ''}. Python 환경과 저장 폴더 권한을 확인하세요.`);
  }
}
function atomicJSON(location, value) { const temp = `${location}.${randomUUID()}.tmp`; fs.writeFileSync(temp, JSON.stringify(value)); fs.renameSync(temp, location); }
function createGISStore(root, { transport = fetch, env = process.env } = {}) {
  const rawDir = path.join(root, 'raw', 'openfreemap'), processed = path.join(root, 'processed'), pointer = path.join(processed, 'current.json');
  for (const folder of [rawDir, processed]) fs.mkdirSync(folder, { recursive: true });
  let snapshot = null, inFlight = null, lastAttempt = 0;
  let progress = { stage: 'idle', message: 'GIS 수집 대기', completedTiles: 0, totalTiles: tilesForArea().length, error: null };
  const advance = (stage, message, extra = {}) => { progress = { ...progress, stage, message, ...extra }; };
  const currentInfo = () => {
    if (!fs.existsSync(pointer)) return null;
    const info = JSON.parse(fs.readFileSync(pointer, 'utf8'));
    if (!/^ofm-[a-f0-9]{16}$/.test(info.version)) throw new Error('잘못된 GIS 버전입니다.');
    return info;
  };
  async function get() {
    if (snapshot) return snapshot;
    const info = currentInfo(); if (!info) throw new Error('실제 GIS 자료가 아직 없습니다. 지도 데이터 가져오기를 실행하세요.');
    const disk = await parquet('read', [path.join(processed, info.version)], env);
    snapshot = { ...info, features: disk.features, manifest: disk.manifest, readSource: 'local-parquet' }; return snapshot;
  }
  async function download(url, location, json = false) {
    if (fs.existsSync(location)) { const bytes = fs.readFileSync(location); return json ? JSON.parse(bytes) : bytes; }
    let response, current = safeURL(url);
    for (let redirects = 0; redirects <= 3; redirects++) {
      try { response = await transport(current, { headers: { 'User-Agent': 'CoolSydney/0.3 (local educational GIS; bounded cached area)' }, redirect: 'manual', signal: AbortSignal.timeout(45000) }); }
      catch (error) {
        const code = error.cause?.code || error.code;
        if (['ENOTFOUND','EAI_AGAIN'].includes(code)) throw new Error(`지도 다운로드: tiles.openfreemap.org 주소를 찾지 못했습니다 (${code}). 서버를 실행한 터미널의 DNS·인터넷 연결을 확인하세요.`);
        if (error.name === 'TimeoutError') throw new Error('지도 다운로드: OpenFreeMap 응답 대기 시간이 45초를 초과했습니다. 다시 시도하세요.');
        throw new Error('지도 다운로드: OpenFreeMap에 연결하지 못했습니다. 서버 터미널의 인터넷 접근·프록시 설정을 확인하세요.');
      }
      if (![301,302,303,307,308].includes(response.status)) break;
      const location = response.headers?.get('location');
      if (!location || redirects === 3) throw new Error('지도 다운로드: 리디렉션 주소가 없거나 횟수가 너무 많습니다.');
      // Follow provider CDN redirects, never arbitrary hosts or HTTP targets.
      current = safeURL(new URL(location, current).href);
    }
    if (!response.ok) throw new Error(`OpenFreeMap HTTP ${response.status}. 잠시 후 다시 시도하세요.`);
    const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length > 12 * 1024 * 1024) throw new Error('타일 파일 크기 제한을 초과했습니다.');
    const result = json ? JSON.parse(bytes) : bytes;
    const temporary = `${location}.tmp`; fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, location); return result;
  }
  return {
    metadata() { const info = currentInfo(); return { ready: !!info, loading: !!inFlight, progress, retryAfterSeconds: Math.max(0, Math.ceil((30000 - Date.now() + lastAttempt) / 1000)), area: AREA, ...(info || {}), readSource: 'local-parquet', zetarisVerified: false }; },
    get,
    async load() {
      if (currentInfo()) return get();
      if (inFlight) return inFlight;
      if (Date.now() - lastAttempt < 30000) throw new Error('재시도는 30초 뒤에 가능합니다.'); lastAttempt = Date.now();
      inFlight = (async () => {
        advance('metadata', '지도 타일 목록을 가져오고 있습니다.', { error: null, completedTiles: 0 });
        const metadata = await download(TILEJSON, path.join(rawDir, 'tilejson.json'), true);
        if (!Array.isArray(metadata.tiles) || !metadata.tiles.length || metadata.maxzoom < 14) throw new Error('지도 타일 메타데이터가 올바르지 않습니다.');
        const template = metadata.tiles[0], features = [], sources = [], seen = new Set();
        // Small bounded area, sequential requests and persistent raw cache.
        for (const tile of tilesForArea()) {
          advance('tiles', `지도 타일 ${sources.length + 1}/${progress.totalTiles} 수집 중`, { completedTiles: sources.length });
          const url = safeURL(template.replace('{z}', tile.z).replace('{x}', tile.x).replace('{y}', tile.y));
          const location = path.join(rawDir, `${hash(url).slice(0, 12)}-${tile.z}-${tile.x}-${tile.y}.pbf`);
          const bytes = await download(url, location), source = { url, hash: hash(bytes), tile };
          const decoded = await decode(bytes, tile, source); sources.push(source);
          advance('tiles', `지도 타일 ${sources.length}/${progress.totalTiles} 처리 완료`, { completedTiles: sources.length });
          for (const f of decoded) if (!seen.has(f.id)) { seen.add(f.id); features.push(f); }
        }
        if (!features.some(f => f.properties.layer === 'building')) throw new Error('건물 형상이 없는 응답입니다. GIS 자료를 게시하지 않았습니다.');
        const version = `ofm-${hash(JSON.stringify({ area: AREA, sources, schema: 1 })).slice(0, 16)}`;
        const info = { version, area: AREA, fetchedAt: new Date().toISOString(), source: TILEJSON, sources, dataKind: 'real-gis-vector-tiles', attribution: '© OpenFreeMap · OpenMapTiles · OpenStreetMap contributors (ODbL)', counts: Object.fromEntries(LAYERS.map(layer => [layer, features.filter(f => f.properties.layer === layer).length])), heightBasis: 'OpenMapTiles render_height: source-derived or default; not independently surveyed', limitations: ['타일 경계에서 건물이 여러 조각으로 나뉠 수 있으므로 개수는 건물 수가 아닌 형상 조각 수입니다.', '높이는 지도 렌더링용 파생값이며 실측 정확도를 보장하지 않습니다.', '수목 수관·지형·열환경·인구 자료는 아직 연결하지 않았습니다.'] };
        const staging = path.join(processed, `.staging-${randomUUID()}`), final = path.join(processed, version);
        fs.mkdirSync(staging); const input = path.join(staging, 'snapshot.json'); atomicJSON(input, { ...info, features });
        try {
          advance('parquet', 'GIS 형상을 Parquet로 저장하고 재조회 검증 중입니다.');
          const manifest = await parquet('write', [input, staging], env); fs.unlinkSync(input);
          if (!fs.existsSync(final)) fs.renameSync(staging, final); else fs.rmSync(staging, { recursive: true });
          atomicJSON(pointer, { ...info, parquet: manifest }); snapshot = null;
          advance('reading', '저장된 Parquet에서 지도 데이터를 읽고 있습니다.');
          const result = await get(); advance('ready', '실제 GIS 자료 저장·검증 완료'); return result;
        } catch (e) { fs.rmSync(staging, { recursive: true, force: true }); throw e; }
      })();
      try { return await inFlight; }
      catch (error) { advance('error', error.message, { error: error.message }); console.warn('[Cool Sydney GIS]', error.message); throw error; }
      finally { inFlight = null; }
    }
  };
}
module.exports = { TILEJSON, LAYERS, tileAt, tileBounds, tilesForArea, normalizeFeature, decode, parquet, createGISStore };
