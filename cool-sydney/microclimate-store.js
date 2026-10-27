'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function createMicroclimateStore(root) {
  const directory = path.join(root, 'processed', 'microclimate');
  const pointer = path.join(directory, 'current.json');
  let cache = null;
  function currentVersion() {
    if (!fs.existsSync(pointer)) return null;
    const { version } = JSON.parse(fs.readFileSync(pointer, 'utf8'));
    if (typeof version !== 'string' || !/^micro-[0-9a-f]{16}$/.test(version)) throw new Error('잘못된 미기후 묶음 버전입니다.');
    return version;
  }
  function get() {
    const version = currentVersion();
    if (!version) return null;
    if (cache?.manifest.version === version) return cache;
    const folder = path.join(directory, version);
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
    if (manifest.version !== version) throw new Error('미기후 묶음 버전이 일치하지 않습니다.');
    const bytes = fs.readFileSync(path.join(folder, 'hourly.json'));
    if (createHash('sha256').update(bytes).digest('hex') !== manifest.processed_sha256) throw new Error('미기후 자료 해시가 일치하지 않습니다.');
    const data = JSON.parse(bytes);
    if (!Array.isArray(data.sites) || data.sites.length !== manifest.site_count || typeof data.series !== 'object') throw new Error('미기후 자료 형식이 올바르지 않습니다.');
    cache = { manifest, data };
    return cache;
  }
  function metadata() {
    const bundle = get();
    return bundle ? { ready: true, ...bundle.manifest } : { ready: false, source: 'https://research-data.westernsydney.edu.au/published/9bc62c10d22a11efab80570ec596f9e9/' };
  }
  function at(date, hour) {
    const bundle = get();
    if (!bundle) return { ready: false };
    const parsed = typeof date === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date || !Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new RangeError('유효한 미기후 관측 날짜와 0–23시를 지정하세요.');
    }
    const { manifest, data } = bundle;
    if (date < manifest.start_date || date > manifest.end_date) throw new RangeError('미기후 원자료 기간은 2023-12-09부터 2024-03-06까지입니다.');
    const values = new Map((data.series[date]?.[hour] || []).map(([id, temperature_c, samples]) => [id, { temperature_c, samples }]));
    const sites = data.sites.map(site => ({ ...site, ...(values.get(site.id) || { temperature_c: null, samples: 0 }) }));
    const valid = sites.filter(site => site.temperature_c != null);
    return {
      ready: true, version: manifest.version, source: manifest.source, license: manifest.license,
      reference_date: date, hour, time_zone: 'AEDT (UTC+11)',
      method: manifest.method, data_kind: 'historical-observed-point-air-temperature',
      sites, observed_sites: valid.length,
      minimum_c: valid.length ? Math.min(...valid.map(site => site.temperature_c)) : null,
      maximum_c: valid.length ? Math.max(...valid.map(site => site.temperature_c)) : null,
    };
  }
  return { metadata, at };
}

module.exports = { createMicroclimateStore };
