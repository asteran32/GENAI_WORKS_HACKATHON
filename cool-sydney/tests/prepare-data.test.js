'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepareData } = require('../prepare-data');
const map = { version: 'ofm-example', counts: { building: 100 } };
const bundle = { manifest: { date: '2025-01-15', components: { buildings: map.version }, bundle_version: 'cbd-example', files: [{ name: 'trees.parquet', rows: 12 }] } };
const log = () => {};
test('preparation requires successful GIS before attempting CBD downloads', async () => {
  let called = false;
  await assert.rejects(prepareData({ gis: { load: async () => { throw Error('network unavailable'); } }, cbd: { metadata: () => { called = true; } }, log }), /network unavailable/);
  assert.equal(called, false);
});
test('preparation reuses a matching verified CBD bundle', async () => {
  const result = await prepareData({ gis: { load: async () => map }, cbd: { metadata: () => ({ ready: true }), get: async () => bundle, load: async () => { throw Error('must reuse cache'); } }, log });
  assert.equal(result.cbd, 'cbd-example');
});
test('preparation refreshes CBD when the requested date changes', async () => {
  let requested;
  await prepareData({ date: '2025-01-16', gis: { load: async () => map }, cbd: { metadata: () => ({ ready: true }), get: async () => bundle, load: async date => { requested = date; return { manifest: { ...bundle.manifest, date } }; } }, log });
  assert.equal(requested, '2025-01-16');
});
test('map-only does not require CBD and invalid dates fail before any network call', async () => {
  assert.equal((await prepareData({ gis: { load: async () => map }, mapOnly: true, log })).cbd, null);
  await assert.rejects(prepareData({ gis: { load: async () => { throw Error('should not download'); } }, date: '2025-02-30', log }), /유효한 날짜/);
});
