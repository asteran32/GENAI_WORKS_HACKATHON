'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGISStore, normalizeFeature, tilesForArea, tileAt } = require('../gis-store');
const { blocked, simulate, validateInput } = require('../gis-shadow');
const { AREA } = require('../city-data');
const { createService } = require('../service');
const { createZetarisGIS, plan } = require('../zetaris-gis');
async function fixturePbf() {
  const { Pbf } = await import('../vendor/scene-vendor.mjs');
  const pbf = new Pbf();
  pbf.writeMessage(3, (_, p) => {
    p.writeVarintField(15, 2); p.writeStringField(1, 'building'); p.writeVarintField(5, 4096);
    p.writeStringField(3, 'render_height'); p.writeMessage(4, (_, v) => v.writeDoubleField(3, 20));
    p.writeMessage(2, (_, f) => {
      f.writeVarintField(1, 123); f.writePackedVarint(2, [0, 0]); f.writeVarintField(3, 3);
      // Polygon: (1800,1800) -> (1900,1800) -> (1900,1900) -> (1800,1900).
      f.writePackedVarint(4, [9,3600,3600,26,200,0,0,200,199,0,15]);
    });
  });
  return Buffer.from(pbf.finish());
}
test('GIS normalization keeps missing heights null and labels render heights as derived', () => {
  const geometry = { type: 'Polygon', coordinates: [[[151,-33],[151.001,-33],[151.001,-33.001],[151,-33]]] }, source = { url: 'https://tiles.openfreemap.org/test', hash: 'abc' }, tile = tileAt(151.207,-33.8715);
  const unknown = normalizeFeature({ geometry, properties: {} }, 'building', tile, source);
  assert.equal(unknown.properties.height_m, null); assert.equal(unknown.properties.casts_shadow, false);
  const known = normalizeFeature({ geometry, properties: { render_height: 30 } }, 'building', tile, source);
  assert.equal(known.properties.height_m, 30); assert.match(known.properties.height_method, /derived-or-default/);
  assert.equal(normalizeFeature({ geometry, properties: { render_height: 30, hide_3d: true } }, 'building', tile, source).properties.casts_shadow, false);
  assert.ok(tilesForArea().length <= 16);
});
test('polygon rays preserve shadow direction, courtyards, elevated bases and tile bounds', () => {
  const square = [[0,0],[10,0],[10,10],[0,10],[0,0]], b = { rings: [square], box: [0,0,10,10], tile: [-100,-100,100,100], height: 10, base: 0, casts: true };
  assert.equal(blocked(b, [-5,5], [1,0], 1), true);
  assert.equal(blocked(b, [-15,5], [1,0], 1), false);
  assert.equal(blocked(b, [15,5], [1,0], 1), false);
  assert.equal(blocked({ ...b, base: 9 }, [5,5], [1,0], 1), false);
  assert.equal(blocked({ ...b, rings: [square, [[2,2],[8,2],[8,8],[2,8],[2,2]]] }, [5,5], [1,0], 100), false);
  assert.equal(blocked({ ...b, tile: [0,0,10,4] }, [-5,5], [1,0], 1), false);
  assert.throws(() => validateInput({ date: '2027-02-30', hour: 12 }));
  assert.equal(simulate({ area: AREA, features: [], version: 'fixture' }, { date: '2027-01-15', hour: 0 }).shadePercent, null);
});
test('PBF ingestion writes real Parquet, round-trips geometry, survives restart and detects corruption', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cool-gis-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bytes = await fixturePbf(); let requests = 0;
  const transport = async url => { requests++; const body = url.endsWith('/planet') ? Buffer.from(JSON.stringify({ maxzoom: 14, tiles: ['https://tiles.openfreemap.org/test/{z}/{x}/{y}.pbf'] })) : bytes; return { ok: true, arrayBuffer: async () => body }; };
  const store = createGISStore(root, { transport, env: {} });
  assert.equal(store.metadata().ready, false);
  const [snapshot, duplicate] = await Promise.all([store.load(), store.load()]);
  assert.equal(snapshot.version, duplicate.version); assert.equal(requests, 1 + tilesForArea().length);
  assert.equal(snapshot.readSource, 'local-parquet'); assert.equal(snapshot.manifest.roundTripVerified, true);
  const location = path.join(root, 'processed', snapshot.version, 'building.parquet');
  assert.equal(fs.readFileSync(location).subarray(0,4).toString(), 'PAR1');
  assert.equal(snapshot.features[0].properties.height_m, 20); assert.equal(snapshot.features[0].geometry.type, 'Polygon');
  const restarted = createGISStore(root, { transport: () => { throw Error('network must not run'); }, env: {} });
  assert.deepEqual((await restarted.get()).features, snapshot.features);
  const service = createService({ directory: root, env: {} }); t.after(() => service.close());
  const run = await service.dispatch('POST','/api/gis/shadow',{ date:'2027-01-15', hour:14 });
  assert.equal(run.datasetVersion,snapshot.version); assert.equal(run.source,'local-parquet'); assert.ok(run.samples > 0);
  assert.equal(run.shadePercent, Math.round(run.shadedSamples/run.samples*1000)/10);
  await service.dispatch('POST','/api/gis/memory',{ date:'2027-01-16',hour:10 });
  assert.equal((await service.dispatch('GET','/api/gis/memory')).constraints.hour,10);
  fs.appendFileSync(location, 'corrupt');
  await assert.rejects(createGISStore(root,{env:{}}).get(), /Parquet/);
});
test('Zetaris registration is resumable and verifies exact local row count and version', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'cool-zetaris-')), version = 'ofm-0123456789abcdef';
  fs.mkdirSync(path.join(root,'processed',version),{recursive:true}); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const info = { version, counts:{building:7} }, env = { ZETARIS_API_KEY:'secret', ZETARIS_REST_URL:'http://localhost:8888/api/v1.0', ZETARIS_ORG_ID:'1' }, calls=[];
  const transport = async (_,options)=>{ const sql=JSON.parse(options.body).sql; calls.push(sql); return {ok:true,json:async()=>({data:sql.startsWith('SELECT COUNT')?[[7,version,version]]:[]})}; };
  const adapter = createZetarisGIS(root,env,transport);
  assert.equal((await adapter.register(info)).verified,true); assert.equal(calls.length,8);
  await adapter.register(info); assert.equal(calls.length,9);
  assert.match(plan(info).statements[1],/FORMAT PARQUET/); assert.ok(!JSON.stringify(plan(info)).includes('secret'));
  const bad = createZetarisGIS(root,env,async()=>({ok:true,json:async()=>({data:[[8,version,version]]})}));
  await assert.rejects(bad.verify(info), /다릅니다/);
});

test('GIS metadata follows same-provider redirects and reports download failures with their stage', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cool-redirect-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [], store = createGISStore(root, { env: {}, transport: async (url, options) => {
    calls.push(url); assert.equal(options.redirect, 'manual');
    if (url.endsWith('/planet')) return { status: 302, headers: { get: () => '/planet/current.json' } };
    throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  } });
  await assert.rejects(store.load(), /ENOTFOUND/);
  assert.deepEqual(calls, ['https://tiles.openfreemap.org/planet','https://tiles.openfreemap.org/planet/current.json']);
  assert.equal(store.metadata().ready, false); assert.equal(store.metadata().progress.stage, 'error');
  assert.match(store.metadata().progress.error, /ENOTFOUND/);
  assert.equal(store.metadata().loading, false);
});

test('GIS downloader refuses a redirect away from the provider', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cool-redirect-denied-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); let calls = 0;
  const store = createGISStore(root, { env: {}, transport: async () => { calls++; return { status: 302, headers: { get: () => 'http://127.0.0.1/private' } }; } });
  await assert.rejects(store.load(), /허용되지 않은/); assert.equal(calls, 1);
});
