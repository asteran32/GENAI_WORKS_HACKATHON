'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { AREA, project, unproject } = require('./city-data');
const { localInstant } = require('./src/engine');
const exec = promisify(execFile);
const sha = value => createHash('sha256').update(value).digest('hex');
const BASE = 'https://services1.arcgis.com/cNVyNtjGVZybOQWZ/ArcGIS/rest/services';
const SOURCES = Object.freeze({
  trees: `${BASE}/Trees/FeatureServer/0`,
  sites: `${BASE}/Automatic_Walking_Count_Sites/FeatureServer/0`,
  counts: `${BASE}/Automatic_Hourly_Pedestrian_Count/FeatureServer/0`,
  walk: 'https://overpass-api.de/api/interpreter',
  weather: 'https://archive-api.open-meteo.com/v1/archive'
});
const LICENSES = { trees: 'City of Sydney open data; portal licence must be checked for redistribution', sites: 'CC BY 4.0 (ArcGIS item)', counts: 'City of Sydney open data; portal licence must be checked for redistribution', walk: 'ODbL © OpenStreetMap contributors', weather: 'CC BY 4.0 data; free API non-commercial use' };
const allowedHosts = new Set(['services1.arcgis.com', 'overpass-api.de', 'archive-api.open-meteo.com']);
const COUNT_COVERAGE_SOURCE = 'https://data.nsw.gov.au/data/en/dataset/5-cityofsydney--automatic-hourly-pedestrian-count';
function unavailableCounts(date) {
  // The publisher states collection ended in June 2025. Do not invent rows,
  // copy January demand, or present a synthetic empty response as a downloaded raw file.
  if (date <= '2025-06-30') return null;
  const status = 'unavailable-source-ended';
  return { data:{features:[]}, hash:sha(JSON.stringify({date,status})), collected_at_utc:null,
    availability:status, coverage_source_url:COUNT_COVERAGE_SOURCE };
}
function atomicJSON(location, value) { const temp = `${location}.${randomUUID()}.tmp`; fs.writeFileSync(temp, JSON.stringify(value)); fs.renameSync(temp, location); }
function bounds(area = AREA, bufferM = 650) {
  const sw = project(area.west, area.south, area), ne = project(area.east, area.north, area);
  const [west, south] = unproject(sw[0] - bufferM, sw[1] - bufferM, area), [east, north] = unproject(ne[0] + bufferM, ne[1] + bufferM, area);
  return { west, south, east, north };
}
function dateWindow(date) {
  if (!/^20\d\d-\d\d-\d\d$/.test(date || '') || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('유효한 날짜를 입력하세요.');
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const start = localInstant(date, 0, AREA.timezone).toISOString(), end = localInstant(next, 0, AREA.timezone).toISOString();
  if (+new Date(start) >= +new Date(end)) throw new Error('현지 날짜 구간이 유효하지 않습니다.');
  if (+new Date(end) - +new Date(start) !== 86400000) throw new Error('서머타임 전환일의 중복·누락 현지 시각은 자동 계수 원본에서 구별할 수 없어 수집하지 않습니다.');
  return { start, end, next };
}
function walkQuery(b = bounds()) {
  return `[out:json][timeout:60];way["highway"](${b.south},${b.west},${b.north},${b.east});(._;>;);out body;`;
}
function walkingAccess(tags) {
  const type = tags.highway;
  if (['motorway','motorway_link','trunk','trunk_link','raceway','construction','proposed','cycleway'].includes(type)) return null;
  if (['no','private'].includes(tags.foot) || (['no','private'].includes(tags.access) && tags.foot !== 'yes')) return null;
  const dedicated = ['footway','pedestrian','path','steps','living_street','track'].includes(type);
  const inferred = ['residential','service','unclassified','tertiary','secondary','primary', 'road'].includes(type);
  if (!dedicated && !inferred) return null;
  const steps = type === 'steps' || tags.incline === 'steps';
  return { quality: inferred ? 'road-centreline-unverified-sidewalk' : 'osm-pedestrian-way', steps, stepFreeCandidate: dedicated && !steps && type !== 'track' && tags.wheelchair !== 'no' && tags.surface !== 'cobblestone', direction: tags['oneway:foot'] === 'yes' ? 'forward' : tags['oneway:foot'] === '-1' ? 'backward' : 'both' };
}
function normalizeWalk(raw) {
  if (!Array.isArray(raw?.elements) || raw.remark) throw new Error('OSM 보행망 응답이 불완전합니다.');
  const rawNodes = new Map(raw.elements.filter(e => e.type === 'node' && Number.isFinite(e.lon) && Number.isFinite(e.lat)).map(e => [e.id, e]));
  const nodes = new Map(), edges = [], degree = new Map();
  for (const way of raw.elements) {
    if (way.type !== 'way' || !Array.isArray(way.nodes)) continue;
    const tags = way.tags || {}, access = walkingAccess(tags); if (!access) continue;
    const level = `${tags.layer || '0'}:${tags.bridge === 'yes' ? 'bridge' : tags.tunnel === 'yes' ? 'tunnel' : 'ground'}`;
    for (let i = 1; i < way.nodes.length; i++) {
      const a = rawNodes.get(way.nodes[i - 1]), b = rawNodes.get(way.nodes[i]); if (!a || !b) continue;
      const from = `${a.id}:${level}`, to = `${b.id}:${level}`;
      const pa = project(a.lon, a.lat), pb = project(b.lon, b.lat), length = Math.hypot(pa[0]-pb[0], pa[1]-pb[1]);
      if (length < .1 || length > 1000) continue;
      if (!nodes.has(from)) nodes.set(from, { id: from, lon: a.lon, lat: a.lat, level, degree: 0, geometry: { type: 'Point', coordinates: [a.lon,a.lat] } });
      if (!nodes.has(to)) nodes.set(to, { id: to, lon: b.lon, lat: b.lat, level, degree: 0, geometry: { type: 'Point', coordinates: [b.lon,b.lat] } });
      degree.set(from, (degree.get(from) || 0) + 1); degree.set(to, (degree.get(to) || 0) + 1);
      edges.push({ id: `${way.id}/${i}`, from_id: from, to_id: to, length_m: +length.toFixed(3), quality: access.quality, steps: access.steps, step_free_candidate: access.stepFreeCandidate, level, way_id: String(way.id), direction: access.direction, geometry: { type: 'LineString', coordinates: [[a.lon,a.lat],[b.lon,b.lat]] } });
    }
  }
  if (edges.length < 20) throw new Error('보행망에 충분한 연결 구간이 없습니다.');
  return { nodes: [...nodes.values()].map(n => ({ ...n, degree: degree.get(n.id) || 0 })), edges };
}
function normalizeTrees(raw) {
  if (!Array.isArray(raw?.features) || raw.error || raw.properties?.exceededTransferLimit) throw new Error('수목 API 응답이 불완전합니다.');
  const seen = new Set(), result = [];
  for (const f of raw.features) {
    const p = f.properties || {}, coordinates = f.geometry?.coordinates;
    if (!Array.isArray(coordinates) || !coordinates.every(Number.isFinite)) continue;
    const id = String(p.asset_id || p.OBJECTID || ''); if (!id || seen.has(id)) continue; seen.add(id);
    const height = Number(p.TreeHeight), canopy = Number(p.TreeCanopyNS);
    const usable = height > 1 && height <= 80 && canopy > .5 && canopy <= 60 && String(p.Tree_Status || '').trim().toLowerCase() === 'tree';
    result.push({ id, lon: coordinates[0], lat: coordinates[1], height_m: Number.isFinite(height) && height > 0 ? height : null, canopy_raw: Number.isFinite(canopy) && canopy > 0 ? canopy : null, canopy_diameter_m: usable ? canopy : null, canopy_method: usable ? 'assumed-TreeCanopyNS-metres-as-circular-diameter' : 'unknown', status: p.Tree_Status || null, geometry: { type: 'Point', coordinates } });
  }
  return result;
}
function segmentDistance(point, coords) {
  const p = project(...point), a = project(...coords[0]), b = project(...coords[1]);
  const dx = b[0]-a[0], dy = b[1]-a[1], t = Math.max(0, Math.min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy || 1)));
  return Math.hypot(p[0]-a[0]-dx*t, p[1]-a[1]-dy*t);
}
function normalizeSites(raw, edges) {
  if (!Array.isArray(raw?.features) || raw.error) throw new Error('계수 지점 API 응답이 불완전합니다.');
  return raw.features.filter(f => Array.isArray(f.geometry?.coordinates)).map(f => {
    const p = f.properties || {}, coordinates = f.geometry.coordinates;
    const nearest = edges.map(e => ({ id: e.id, distance: segmentDistance(coordinates, e.geometry.coordinates) })).sort((a,b) => a.distance-b.distance).slice(0,2);
    const match = nearest[0], ambiguous = nearest[1] && nearest[1].distance - match.distance < 3 && nearest[1].distance > 5;
    return { id: String(p.SiteID), name: p.Location || null, description: p.SiteDescription || null, lon: coordinates[0], lat: coordinates[1], matched_edge_id: match && match.distance <= 20 && !ambiguous ? match.id : null, match_distance_m: match ? +match.distance.toFixed(2) : null, match_quality: !match || match.distance > 20 ? 'unmatched' : ambiguous ? 'ambiguous' : 'nearest-unverified', geometry: { type: 'Point', coordinates } };
  });
}
function normalizeCounts(raw, window, date) {
  if (!Array.isArray(raw?.features) || raw.error) throw new Error('계수 API 응답이 불완전합니다.');
  const seen = new Set(), start = +new Date(window.start), end = +new Date(window.end), rows = [];
  for (const f of raw.features) {
    const a = f.attributes || {}, sourceDate = Number(a.Date), value = Number(a.TotalCount), id = Number(a.ObjectId);
    if (!Number.isFinite(sourceDate) || !Number.isInteger(value) || value < 0 || !Number.isInteger(id) || seen.has(id)) continue;
    const wall = new Date(sourceDate), sourceDay = wall.toISOString().slice(0,10), hour = wall.getUTCHours();
    if (sourceDay !== date || hour !== Number(a.Hour)) continue;
    // ArcGIS stores local wall-clock hours as epoch milliseconds without a zone.
    // The Hour field and the diurnal count curve corroborate this interpretation.
    const instant = +localInstant(date, hour, AREA.timezone);
    if (instant < start || instant >= end) continue;
    seen.add(id);
    const quality = a.Location_code === 'A004' && date >= '2022-07-03' && date <= '2022-11-11' ? 'known-undercount' : 'reported';
    rows.push({ site_id: String(a.Location_code), instant_utc: new Date(instant).toISOString(), passages: value, source_object_id: id, quality, evidence_type: 'observed' });
  }
  return rows.sort((a,b) => a.instant_utc.localeCompare(b.instant_utc) || a.site_id.localeCompare(b.site_id));
}
function normalizeWeather(raw, window) {
  const h = raw?.hourly, times = h?.time;
  if (!Array.isArray(times) || !Array.isArray(h.temperature_2m) || raw.error) throw new Error('과거 기상 API 응답이 불완전합니다.');
  const start = +new Date(window.start), end = +new Date(window.end), rows = [];
  for (let i = 0; i < times.length; i++) {
    const time = Date.parse(`${times[i]}Z`); if (!Number.isFinite(time) || time < start || time >= end) continue;
    const value = key => h[key]?.[i] == null ? null : Number(h[key][i]);
    rows.push({ instant_utc: new Date(time).toISOString(), temperature_c: value('temperature_2m'), humidity_pct: value('relative_humidity_2m'), wind_m_s: value('wind_speed_10m'), shortwave_w_m2: value('shortwave_radiation'), grid_lat: raw.latitude ?? null, grid_lon: raw.longitude ?? null, evidence_type: 'reanalysis' });
  }
  return rows;
}
async function parquet(action, args, env) {
  const python = env.COOL_SYDNEY_PYTHON || path.join(__dirname, '..', '.venv', 'bin', 'python');
  try { const result = await exec(python, [path.join(__dirname,'cbd-parquet.py'), action, ...args], { timeout: 120000, maxBuffer: 64*1024*1024 }); return JSON.parse(result.stdout); }
  catch (error) { throw new Error(`CBD Parquet ${action} 실패: ${(error.stderr || error.message).trim().slice(0, 400)}`); }
}
function createCBDStore(root, { transport = fetch, env = process.env, gis } = {}) {
  const rawRoot = path.join(root,'raw','cbd'), bundles = path.join(root,'processed','bundles'), pointer = path.join(bundles,'current.json');
  fs.mkdirSync(rawRoot,{recursive:true}); fs.mkdirSync(bundles,{recursive:true});
  let snapshot = null, inFlight = null, progress = { stage:'idle', message:'CBD 자료 수집 대기', error:null };
  function current() { if (!fs.existsSync(pointer)) return null; const p = JSON.parse(fs.readFileSync(pointer,'utf8')); if (!/^cbd-[a-f0-9]{16}$/.test(p.bundle_version)) throw new Error('잘못된 CBD 묶음 버전입니다.'); return p; }
  async function fetchRaw(source, url, filename, options = {}) {
    const u = new URL(url); if (u.protocol !== 'https:' || !allowedHosts.has(u.hostname) || u.username || u.password) throw new Error('허용되지 않은 원천 URL입니다.');
    const dir = path.join(rawRoot, source); fs.mkdirSync(dir,{recursive:true}); const location = path.join(dir,filename);
    if (fs.existsSync(location)) { const bytes = fs.readFileSync(location); return { data:JSON.parse(bytes), hash:sha(bytes), url, cached:true, collected_at_utc:fs.statSync(location).mtime.toISOString() }; }
    const response = await transport(url, { ...options, redirect:'error', signal:AbortSignal.timeout(90000), headers:{ 'User-Agent':'CoolSydney/0.4 (bounded educational area)', ...(options.headers || {}) } });
    if (!response.ok) throw new Error(`${source} 원천 HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length > 32*1024*1024) throw new Error(`${source} 응답 크기가 제한을 넘었습니다.`);
    const data = JSON.parse(bytes); if (data.error || data.remark) throw new Error(`${source} 원천이 오류를 반환했습니다: ${JSON.stringify(data.error || data.remark).slice(0,150)}`);
    const temp = `${location}.${randomUUID()}.tmp`; fs.writeFileSync(temp,bytes); fs.renameSync(temp,location);
    return { data, hash:sha(bytes), url, cached:false, collected_at_utc:new Date().toISOString() };
  }
  async function arcgis(source, base, filename, params, limit = 20) {
    const all = [], hashes = [], urls = [];
    for (let page = 0; page < limit; page++) {
      const u = new URL(`${base}/query`); for (const [k,v] of Object.entries({ ...params, resultOffset:page*2000, resultRecordCount:2000 })) u.searchParams.set(k,String(v));
      const r = await fetchRaw(source,u.href,`${filename}-${page}.json`); hashes.push(r.hash); urls.push(r.url);
      const records = r.data.features; if (!Array.isArray(records)) throw new Error(`${source} 페이지 자료 형식이 올바르지 않습니다.`);
      all.push(...records); if (!r.data.exceededTransferLimit && records.length < 2000) return { data:{features:all}, hash:sha(hashes.join('')), urls, collected_at_utc:r.collected_at_utc };
    }
    throw new Error(`${source} 페이지 제한에 도달했습니다. 부분 자료는 게시하지 않습니다.`);
  }
  async function get() {
    if (snapshot) return snapshot;
    const info = current(); if (!info) throw new Error('CBD 자료가 아직 없습니다. 날짜를 선택해 수집하세요.');
    const disk = await parquet('read',[path.join(bundles,info.bundle_version)],env);
    snapshot = { ...disk, readSource:'local-parquet' }; return snapshot;
  }
  async function load(date) {
    const window = dateWindow(date);
    if (inFlight) return inFlight;
    inFlight = (async () => {
      progress = { stage:'download', message:'보행망·수목·계수·기상을 수집합니다.', error:null };
      const b = bounds(), osmBody = new URLSearchParams({ data:walkQuery(b) }).toString();
      const walk = await fetchRaw('walk',SOURCES.walk,'walk.json',{ method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:osmBody });
      const graph = normalizeWalk(walk.data);
      const envelope = `${b.west},${b.south},${b.east},${b.north}`;
      const trees = await arcgis('trees',SOURCES.trees,'trees',{ where:'1=1', outFields:'OBJECTID,asset_id,TreeHeight,TreeCanopyNS,Tree_Status', geometry:envelope, geometryType:'esriGeometryEnvelope', inSR:4326, outSR:4326, spatialRel:'esriSpatialRelIntersects', f:'geojson' });
      const sites = await arcgis('sites',SOURCES.sites,'sites',{ where:'1=1', outFields:'OBJECTID,SiteID,Location,SiteDescription', outSR:4326, f:'geojson' });
      const counts = unavailableCounts(date) || await arcgis('counts',SOURCES.counts,`counts-local-${date}`,{ where:`Date >= TIMESTAMP '${date} 00:00:00' AND Date < TIMESTAMP '${window.next} 00:00:00'`, outFields:'ObjectId,Location_code,Date,Hour,TotalCount', orderByFields:'ObjectId', f:'json' },10);
      const weatherURL = new URL(SOURCES.weather);
      for (const [k,v] of Object.entries({ latitude:AREA.latitude, longitude:AREA.longitude, start_date:window.start.slice(0,10), end_date:window.end.slice(0,10), hourly:'temperature_2m,relative_humidity_2m,wind_speed_10m,shortwave_radiation', wind_speed_unit:'ms', timezone:'UTC', models:'era5' })) weatherURL.searchParams.set(k,String(v));
      const weather = await fetchRaw('weather',weatherURL.href,`weather-${date}.json`);
      progress = { stage:'normalize', message:'자료를 정규화하고 품질을 확인합니다.', error:null };
      const tables = { walk_nodes:graph.nodes, walk_edges:graph.edges, trees:normalizeTrees(trees.data), pedestrian_sites:normalizeSites(sites.data,graph.edges), pedestrian_counts:normalizeCounts(counts.data,window,date), weather:normalizeWeather(weather.data,window) };
      if (!tables.trees.length || tables.pedestrian_sites.length !== 4 || (!counts.availability && !tables.pedestrian_counts.length) || tables.weather.length !== 24) throw new Error('필수 자료의 유효 행이 부족합니다. 다른 날짜나 원천 상태를 확인하세요.');
      const sources = Object.fromEntries([['walk',walk],['trees',trees],['sites',sites],['counts',counts],['weather',weather]].map(([key,value]) => [key,{ source_id:key, source_url:key==='walk'||key==='weather' ? value.url : SOURCES[key], source_hash:value.hash, source_revision:null, license:LICENSES[key], collected_at_utc:value.collected_at_utc, evidence_type:key==='weather'?'reanalysis':key==='counts'?'observed':key==='walk'?'derived':'observed' }]));
      if (counts.availability) Object.assign(sources.counts, {evidence_type:'unavailable', availability:counts.availability, coverage_source_url:counts.coverage_source_url, source_hash:null});
      const buildingVersion = gis?.metadata().version || null;
      const components = { buildings:buildingVersion, walk_graph:`walk-${walk.hash.slice(0,16)}`, trees:`trees-${trees.hash.slice(0,16)}`, pedestrian_counts:`counts-${counts.hash.slice(0,16)}`, weather:`weather-${weather.hash.slice(0,16)}` };
      const bundle_version = `cbd-${sha(JSON.stringify({ date,components,sites:sites.hash,schema:4 })).slice(0,16)}`;
      const quality = { tree_height_missing:tables.trees.filter(t=>t.height_m==null).length, tree_canopy_modelled:tables.trees.filter(t=>t.canopy_diameter_m!=null).length, site_match_ambiguous_or_missing:tables.pedestrian_sites.filter(s=>s.match_quality!=='nearest-unverified').length, counts_known_undercount:tables.pedestrian_counts.filter(c=>c.quality==='known-undercount').length, notes:['OSM 차도 중심선은 보도 위치가 검증되지 않았습니다.','TreeCanopyNS는 단위 미확인 원본값입니다. 모형 직경은 m 가정이며 수관 하단 높이도 가정입니다.','ArcGIS 계수 Date는 현지 벽시계를 UTC epoch에 담은 것으로 해석해 Australia/Sydney로 변환했습니다. 시간 구간 시작/끝 의미는 원천에서 확인되지 않았습니다.','Open-Meteo 일사는 표시 시각 직전 한 시간의 평균입니다.','과거 계수·기상과 최신 도시 형상을 결합한 시나리오입니다.'] };
      quality.pedestrian_counts_status = counts.availability || 'observed';
      if (counts.availability) quality.notes.push('자동 보행 계수는 2025년 6월 수집 종료. 이 날짜의 보행량은 미관측이며 0명이나 과거 날짜의 수요로 대체하지 않습니다.');
      const payload = { area_id:AREA.id, bundle_version, date, created_at_utc:new Date().toISOString(), components, sources, quality, tables };
      const staging = path.join(bundles,`.staging-${randomUUID()}`), final = path.join(bundles,bundle_version); fs.mkdirSync(staging); const input = path.join(staging,'input.json'); atomicJSON(input,payload);
      try {
        progress = { stage:'parquet', message:'GeoParquet·Parquet를 쓰고 다시 읽어 검증합니다.', error:null };
        await parquet('write',[input,staging],env); fs.unlinkSync(input);
        await parquet('read',[staging],env);
        if (!fs.existsSync(final)) fs.renameSync(staging,final); else fs.rmSync(staging,{recursive:true});
        atomicJSON(pointer,{bundle_version,date}); snapshot=null; const result=await get();
        progress={stage:'ready',message:'CBD 자료 검증 완료',error:null}; return result;
      } catch (error) { fs.rmSync(staging,{recursive:true,force:true}); throw error; }
    })();
    try { return await inFlight; } catch (error) { progress={stage:'error',message:error.message,error:error.message}; throw error; } finally { inFlight=null; }
  }
  return { get, load, metadata() { const info=current(); return { ready:!!info, loading:!!inFlight, progress, ...(info||{}), area:AREA, readSource:'local-parquet' }; } };
}
module.exports = { SOURCES, bounds, dateWindow, walkQuery, walkingAccess, normalizeWalk, normalizeTrees, normalizeSites, normalizeCounts, normalizeWeather, unavailableCounts, createCBDStore };
