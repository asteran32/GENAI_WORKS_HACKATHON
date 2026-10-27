'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createService } = require('../service');
const { createMicroclimateStore } = require('../microclimate-store');

test('historical point temperatures retain their own date and reject missing hours or changed data', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cool-micro-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const version = 'micro-0123456789abcdef', folder = path.join(root, 'processed', 'microclimate', version);
  fs.mkdirSync(folder, { recursive: true });
  const data = { sites: [
    { id: '139', street: 'Kent Street', lat: -33.8731, lon: 151.2052 },
    { id: '140', street: 'Park Street', lat: -33.8732, lon: 151.2105 },
  ], series: { '2024-01-26': Array.from({ length: 24 }, (_, hour) => hour === 14 ? [['139', 34.25, 6]] : []) } };
  const content = JSON.stringify(data);
  const manifest = { version, site_count: 2, start_date: '2023-12-09', end_date: '2024-03-06', processed_sha256: createHash('sha256').update(content).digest('hex'), source: 'https://example.test/source', license: 'CC BY 4.0', method: 'hourly mean' };
  fs.writeFileSync(path.join(folder, 'hourly.json'), content);
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(root, 'processed', 'microclimate', 'current.json'), JSON.stringify({ version }));
  const service = createService({ directory: root });
  t.after(() => service.close());
  const result = await service.dispatch('GET', '/api/gis/microclimate', undefined, new URLSearchParams({ date: '2024-01-26', hour: '14' }));
  assert.equal(result.data_kind, 'historical-observed-point-air-temperature');
  assert.equal(result.reference_date, '2024-01-26');
  assert.equal(result.observed_sites, 1);
  assert.equal(result.sites[0].temperature_c, 34.25);
  assert.equal(result.sites[1].temperature_c, null);
  assert.equal((await service.dispatch('GET', '/api/gis/microclimate', undefined, new URLSearchParams({ date: '2024-01-26', hour: '15' }))).observed_sites, 0);
  await assert.rejects(service.dispatch('GET', '/api/gis/microclimate', undefined, new URLSearchParams({ date: '2025-01-15', hour: '14' })), /원자료 기간/);
  await assert.rejects(service.dispatch('GET', '/api/gis/microclimate', undefined, new URLSearchParams({ date: '2024-02-30', hour: '14' })), /유효한/);
  await assert.rejects(service.dispatch('GET', '/api/gis/microclimate', undefined, new URLSearchParams({ date: '2024-01-26' })), /유효한/);
  fs.appendFileSync(path.join(folder, 'hourly.json'), 'corrupt');
  assert.throws(() => createMicroclimateStore(root).metadata(), /해시/);
});
