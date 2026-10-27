'use strict';

const { AREA } = require('./city-data');
const SOURCE = 'https://open-meteo.com/en/docs';
const TTL_MS = 10 * 60 * 1000;
const FIELDS = 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,cloud_cover,weather_code,wind_speed_10m,wind_direction_10m,is_day';
const URL = `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({
  latitude: String(AREA.latitude), longitude: String(AREA.longitude), current: FIELDS,
  timezone: AREA.timezone, forecast_days: '1',
})}`;

function normalize(raw, fetchedAt) {
  const c = raw?.current, offset = raw?.utc_offset_seconds;
  if (raw?.timezone !== AREA.timezone || !Number.isInteger(offset) || Math.abs(offset) > 50400 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(c?.time || '')) throw new Error('현재 기상 응답의 시각·시간대가 올바르지 않습니다.');
  const observedMs = Date.parse(`${c.time}:00Z`) - offset * 1000;
  if (!Number.isFinite(observedMs) || Math.abs(Date.parse(fetchedAt) - observedMs) > 90 * 60 * 1000) throw new Error('현재 기상값의 시각이 90분 이상 벗어났습니다.');
  const numeric = (name, min, max) => {
    const value = c[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`현재 기상 응답의 ${name} 값이 올바르지 않습니다.`);
    return value;
  };
  return {
    data_kind: 'current-grid-weather-model', source: 'Open-Meteo', source_url: SOURCE,
    point: { latitude: AREA.latitude, longitude: AREA.longitude },
    grid_point: { latitude: raw.latitude, longitude: raw.longitude },
    timezone: AREA.timezone, valid_at_local: c.time, valid_at_utc: new Date(observedMs).toISOString(),
    fetched_at_utc: fetchedAt, interval_seconds: numeric('interval', 60, 3600),
    temperature_c: numeric('temperature_2m', -50, 60),
    apparent_temperature_c: numeric('apparent_temperature', -60, 70),
    humidity_pct: numeric('relative_humidity_2m', 0, 100),
    precipitation_mm: numeric('precipitation', 0, 100),
    cloud_cover_pct: numeric('cloud_cover', 0, 100),
    weather_code: numeric('weather_code', 0, 99),
    wind_speed_kmh: numeric('wind_speed_10m', 0, 300),
    wind_direction_deg: numeric('wind_direction_10m', 0, 360),
    is_day: numeric('is_day', 0, 1) === 1,
    limitation: 'CBD 중심 좌표의 기상 모델 현재값입니다. 거리별 실측 기온이나 미래 시나리오 예측이 아닙니다.',
  };
}

function createLiveWeather({ transport = fetch, now = () => Date.now() } = {}) {
  let cached = null, expiresAt = 0, inFlight = null;
  async function get() {
    if (cached && now() < expiresAt) return cached;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const response = await transport(URL, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'CoolSydney/0.4 (local weather view)' } });
      if (!response.ok) throw new Error(`현재 기상 API 응답 오류 (${response.status}).`);
      const fetchedAt = new Date(now()).toISOString();
      const value = normalize(await response.json(), fetchedAt);
      cached = value; expiresAt = now() + TTL_MS;
      return value;
    })();
    try { return await inFlight; } finally { inFlight = null; }
  }
  return { get };
}

module.exports = { createLiveWeather, normalize, URL, TTL_MS };
