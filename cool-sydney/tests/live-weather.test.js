'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createService } = require('../service');
const { createLiveWeather, TTL_MS } = require('../live-weather');

const sample = {
  latitude: -33.848858, longitude: 151.19551, utc_offset_seconds: 39600, timezone: 'Australia/Sydney',
  current: { time: '2026-10-27T17:45', interval: 900, temperature_2m: 19.6, apparent_temperature: 18,
    relative_humidity_2m: 65, precipitation: 0, cloud_cover: 16, weather_code: 0,
    wind_speed_10m: 17.1, wind_direction_10m: 50, is_day: 1 },
};

test('current weather API uses one fixed CBD coordinate, converts local time and caches concurrent requests', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cool-live-weather-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let calls = 0, requestUrl;
  let clock = Date.parse('2026-10-27T06:46:00Z');
  const now = () => clock;
  const service = createService({ directory: root, env: {}, weatherNow: now, transport: async url => {
    calls++; requestUrl = new URL(url); await new Promise(resolve => setTimeout(resolve, 5));
    return { ok: true, json: async () => sample };
  } });
  t.after(() => service.close());
  const weather = createLiveWeather({ now, transport: async url => {
    calls++; requestUrl = new URL(url); return { ok: true, json: async () => calls === 1 ? sample : { ...sample, current: { ...sample.current, time: '2026-10-27T18:00', temperature_2m: 19.4 } } };
  } });
  const [a, b] = await Promise.all([weather.get(), weather.get()]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.equal(a.data_kind, 'current-grid-weather-model');
  assert.equal(a.valid_at_utc, '2026-10-27T06:45:00.000Z');
  assert.equal(a.temperature_c, 19.6);
  assert.equal(a.precipitation_mm, 0);
  assert.equal(requestUrl.hostname, 'api.open-meteo.com');
  assert.equal(requestUrl.searchParams.get('latitude'), '-33.8665');
  assert.equal(requestUrl.searchParams.get('longitude'), '151.208');
  assert.equal((await weather.get()).fetched_at_utc, a.fetched_at_utc);
  assert.equal(calls, 1);
  assert.equal(TTL_MS, 600000);
  clock += TTL_MS + 1;
  assert.equal((await weather.get()).temperature_c, 19.4);
  assert.equal(calls, 2);
  assert.equal((await service.dispatch('GET', '/api/weather/current')).valid_at_utc, a.valid_at_utc);
});

test('bad or unavailable current weather is rejected rather than rendered as live', async () => {
  const now = () => Date.parse('2026-10-27T06:46:00Z');
  const bad = { ...sample, current: { ...sample.current, temperature_2m: null } };
  await assert.rejects(createLiveWeather({ now, transport: async () => ({ ok: true, json: async () => bad }) }).get(), /temperature_2m/);
  await assert.rejects(createLiveWeather({ now, transport: async () => { throw new Error('offline'); } }).get(), /offline/);
  await assert.rejects(createLiveWeather({ now, transport: async () => ({ ok: true, json: async () => ({ ...sample, current: { ...sample.current, time: '2026-10-26T17:45' } }) }) }).get(), /90분/);
});
