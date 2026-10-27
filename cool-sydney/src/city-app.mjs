import { CityScene } from './city-scene.mjs';
import { sunAt, localInstant } from './sun.mjs';
window.coolSydneyBooted = true;
const $ = id => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const STEP = 0.25, ZONE = 'Australia/Sydney';
/** Sydney is southern-hemisphere: the December solstice is the longest, hottest-sun day. */
const SCENARIOS = [
  { id: 'summer', name: '하지', note: '남반구 여름', date: '2026-12-21' },
  { id: 'equinox', name: '분점', note: '춘·추분', date: '2027-03-20' },
  { id: 'winter', name: '동지', note: '남반구 겨울', date: '2027-06-21' },
  { id: 'custom', name: '관찰일', note: '직접 지정', date: null },
];
let scene, snapshot, run, status, busy = false, shadeTimer = null, pendingShade = false;
let hour = 14, playing = false, speed = 1, lastFrame = 0;
let cbd = null, pickMode = null, startPoint = null, endPoint = null, routeRun = null;
const observationCache = new Map();
let shownObservationKey = null;
let microMetadata = null, shownMicroKey = null;
const microCache = new Map();
let liveMode = true, liveWeather = null, liveRequest = null;
const profiles = new Map(); // date → { values: (number|null)[], done }
const verified = new Map(); // date → Map(hour → shadePercent)
let profileJob = 0, chartHover = null;

function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
function tone(el, value, text) { el.dataset.tone = value; if (text != null) el.textContent = text; }
async function api(route, method = 'GET', body) {
  const response = await fetch(route, { method, headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('백엔드 API 대신 다른 페이지를 받았습니다. 기존 서버를 종료하고 scripts/start_cool_sydney.sh로 다시 실행하세요.');
  const value = await response.json(); if (!response.ok) throw Object.assign(new Error(value.error || `HTTP ${response.status}`), { status: response.status }); return value;
}
function buttons() {
  $('import').disabled = busy || !!snapshot;
  for (const id of ['simulate','save']) $(id).disabled = busy || !snapshot;
  $('cbd-import').disabled = busy || !snapshot;
  for (const id of ['pick-start','pick-end']) $(id).disabled = busy || !cbd;
  $('route').disabled = busy || !cbd || !startPoint || !endPoint || cbd.date !== dateValue();
  for (const id of ['register','verify']) $(id).disabled = busy || !snapshot || !status?.zetaris.configured;
  $('explain').disabled = busy || !run || !status?.nvidia.configured;
}
async function work(action) { if (busy) return; busy = true; buttons(); try { await action(); } catch (e) { message(e.message, true); tone($('verify-state'), 'crit', '오류'); } finally { busy = false; buttons(); if (pendingShade) { pendingShade = false; scheduleShade(); } } }

// ── Formatting ────────────────────────────────────────────
const hhmm = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round(h % 1 * 60)).padStart(2, '0')}`;
const pct = v => v == null ? '—' : v.toFixed(1);
const signed = v => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)}`;
const compassPoint = az => ['N','NE','E','SE','S','SW','W','NW'][Math.round(az / 45) % 8];
const tzName = (date, h) => new Intl.DateTimeFormat('en-AU', { timeZone: ZONE, timeZoneName: 'short' }).formatToParts(localInstant(date, h, ZONE)).find(p => p.type === 'timeZoneName')?.value || '';
const area = () => snapshot?.area || { latitude: -33.8665, longitude: 151.208, timezone: ZONE };
const dateValue = () => $('date').value;
const baselineDate = () => $('baseline').value;
const scenarioName = date => SCENARIOS.find(s => s.date === date)?.name || '관찰일';
const valueAt = (date, h) => profiles.get(date)?.values[Math.round(h / STEP)] ?? null;
/** Current instant ahead of the profile sweep: one ~60 ms raster, cached into the profile. */
function estimateNow(date, h) {
  const v = valueAt(date, h), entry = profiles.get(date), i = Math.round(h / STEP);
  if (v != null || !scene || !snapshot || playing || !entry || entry.done) return v;
  const sun = sunAt(date, Math.min(h, 23.99), area());
  return sun.daytime ? (entry.values[i] = scene.estimateShade(sun)) : null;
}
const verifiedAt = (date, h) => verified.get(date)?.get(h) ?? null;

const weatherText = code => code === 0 ? '맑음' : code <= 2 ? '약간 흐림' : code === 3 ? '흐림'
  : code <= 48 ? '안개' : code <= 57 ? '이슬비' : code <= 67 ? '비'
    : code <= 77 ? '눈' : code <= 82 ? '소나기' : code <= 86 ? '눈 소나기' : '뇌우';
function sydneyNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: +parts.hour + Math.floor(+parts.minute / 15) / 4 };
}
function paintLiveWeather() {
  const on = liveMode && $('live-layer').checked && !!liveWeather;
  scene?.setLiveWeather(liveWeather, on);
  $('live-now').setAttribute('aria-pressed', String(liveMode));
  $('live-map-weather').hidden = !on;
  if (!liveWeather) return;
  $('live-map-temperature').textContent = `${liveWeather.temperature_c.toFixed(1)}°`;
  $('live-map-condition').textContent = weatherText(liveWeather.weather_code);
  $('live-map-time').textContent = `${liveWeather.valid_at_local.replace('T', ' ')} · Open-Meteo`;
  $('live-temperature').textContent = `${liveWeather.temperature_c.toFixed(1)}°C`;
  $('live-detail').textContent = `${weatherText(liveWeather.weather_code)} · 체감 ${liveWeather.apparent_temperature_c.toFixed(1)}°C · 습도 ${liveWeather.humidity_pct}% · 구름 ${liveWeather.cloud_cover_pct}% · 비 ${liveWeather.precipitation_mm.toFixed(1)}mm/${Math.round(liveWeather.interval_seconds / 60)}분 · 바람 ${liveWeather.wind_speed_kmh.toFixed(1)}km/h / ${Math.round(liveWeather.wind_direction_deg)}°`;
  $('live-provenance').textContent = `${liveWeather.valid_at_local.replace('T', ' ')} 현지시각 · Open-Meteo 모델 현재값 · 거리별 실측 아님`;
  $('live-state').textContent = liveMode ? `현재 시각 연결 · ${liveWeather.valid_at_local.slice(11)} 모델값 · 10분마다 갱신` : '시나리오 시각 선택 중 · 현재 기상 표현 중지';
}
async function refreshLiveWeather() {
  if (liveRequest) return liveRequest;
  liveRequest = api('/api/weather/current');
  try { liveWeather = await liveRequest; paintLiveWeather(); }
  catch (error) {
    liveWeather = null; scene?.setLiveWeather(null, false);
    $('live-map-weather').hidden = true;
    $('live-temperature').textContent = '—';
    $('live-detail').textContent = `현재 기상 연결 오류 · ${error.message}`;
    $('live-provenance').textContent = 'API 연결 후 자동으로 다시 시도합니다.';
    $('live-state').textContent = '현재 기상 연결 오류 · 10분 뒤 다시 시도';
  } finally { liveRequest = null; }
}
function leaveLiveMode() {
  if (!liveMode) return;
  liveMode = false; paintLiveWeather();
}
function activateLiveMode() {
  pause(); liveMode = true;
  const now = sydneyNow(); $('date').value = now.date; hour = now.hour; $('hour').value = hour;
  $('micro-layer').checked = false; scene?.setLayer('temperatures', false); $('micro-map-date').hidden = true;
  paintScenarios(); requestProfiles(); scheduleShade(); paintLiveWeather();
  if (!liveWeather) refreshLiveWeather();
  buttons();
}

/** Numbers glide between states instead of jumping — reads as continuous time. */
const tweens = new WeakMap();
function tween(el, to, format, unit = '') {
  const from = tweens.get(el) ?? to; tweens.set(el, to);
  const paint = v => el.replaceChildren(document.createTextNode(format(v)), ...(unit ? [Object.assign(document.createElement('small'), { textContent: unit })] : []));
  if (to == null || from == null || matchMedia('(prefers-reduced-motion: reduce)').matches) return paint(to);
  const start = performance.now();
  const step = now => { const t = Math.min(1, Math.max(0, (now - start) / 280)), e = 1 - (1 - t) ** 3; paint(from + (to - from) * e); if (t < 1 && tweens.get(el) === to) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// ── Sun facts for a date ──────────────────────────────────
const sunDays = new Map();
function sunDay(date) {
  if (sunDays.has(date)) return sunDays.get(date);
  let rise = null, set = null, noon = -90, prev = null;
  for (let m = 0; m <= 1440; m += 5) {
    const alt = sunAt(date, Math.min(m / 60, 23.99), area()).altitude;
    if (prev != null && prev <= 0 && alt > 0) rise = (m - 5 * alt / (alt - prev)) / 60;
    if (prev != null && prev > 0 && alt <= 0) set = (m - 5 * alt / (alt - prev)) / 60;
    noon = Math.max(noon, alt); prev = alt;
  }
  const day = { rise, set, noon };
  sunDays.set(date, day); return day;
}

// ── Scenario + baseline controls ──────────────────────────
function buildScenarioControls() {
  $('scenarios').replaceChildren(...SCENARIOS.map(s => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'scenario'; b.setAttribute('role', 'radio'); b.dataset.id = s.id;
    b.innerHTML = `<b>${s.name}</b><span>${s.date ? s.date.slice(5) : '—'} · <em data-noon>—</em></span>`;
    b.addEventListener('click', () => { if (s.date) $('date').value = s.date; else $('date').focus(); onDateChange(); });
    return b;
  }));
  $('baseline').replaceChildren(...SCENARIOS.filter(s => s.date).map(s => new Option(`${s.name} · ${s.date}`, s.date)));
  $('baseline').value = SCENARIOS[0].date;
}
function paintScenarios() {
  const date = dateValue();
  for (const b of $('scenarios').children) {
    const s = SCENARIOS.find(x => x.id === b.dataset.id), d = s.date || date;
    b.setAttribute('aria-checked', String(s.date ? s.date === date : !SCENARIOS.some(x => x.date === date)));
    b.querySelector('span').innerHTML = `${d.slice(5)} · 남중 <em data-noon>${sunDay(d).noon.toFixed(0)}°</em>`;
  }
}

// ── Day profile (screen estimate), computed in slices ─────
function requestProfiles() {
  const job = ++profileJob, dates = [...new Set([dateValue(), baselineDate()])].filter(d => !profiles.get(d)?.done);
  if (!scene || !snapshot) return;
  (async () => {
    for (const date of dates) {
      const entry = profiles.get(date) || { values: new Array(24 / STEP + 1).fill(null), done: false };
      profiles.set(date, entry);
      let sliceStart = performance.now();
      for (let i = 0; i <= 24 / STEP; i++) {
        if (job !== profileJob) return;
        entry.values[i] = scene.estimateShade(sunAt(date, Math.min(i * STEP, 23.99), area()));
        if (performance.now() - sliceStart > 24) { drawChart(); paintComparison(); await new Promise(r => setTimeout(r)); sliceStart = performance.now(); }
      }
      entry.done = true; drawChart(); paintComparison();
    }
  })();
}

// ── Time state ────────────────────────────────────────────
function setHour(value, { schedule = true } = {}) {
  hour = ((Math.round(value / STEP) * STEP) % 24 + 24) % 24;
  $('hour').value = hour;
  if (schedule) scheduleShade(); else applySunPreview();
}
function time() { return { date: dateValue(), hour }; }
/** Sydney-local civil time → UTC ISO for CBD observation/route APIs. */
function instant() {
  const { date, hour: h } = time(), target = Date.parse(`${date}T00:00:00Z`) + h * 3600000;
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let stamp = target;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(stamp)).map(x => [x.type, x.value]));
    stamp += target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  }
  return new Date(stamp).toISOString();
}
function onDateChange() {
  leaveLiveMode();
  paintScenarios(); requestProfiles(); scheduleShade();
  if (cbd) loadObservations().catch(e => message(e.message, true));
  buttons();
}

async function loadObservations() {
  if (!cbd || cbd.date !== dateValue()) {
    $('weather-result').textContent = '이 날짜의 CBD 자료를 가져오세요.';
    $('counts-result').textContent = '관측일과 선택 날짜가 다릅니다.';
    $('count-list').replaceChildren();
    scene?.setObservations(null);
    shownObservationKey = `unavailable:${dateValue()}`;
    return;
  }
  const key = `${cbd.bundle_version}:${cbd.date}:${Math.floor(hour)}`;
  if (key === shownObservationKey) return;
  shownObservationKey = key;
  $('counts-result').textContent = '선택 시각의 센서 관측값을 읽는 중…';
  if (!observationCache.has(key)) observationCache.set(key, api(`/api/gis/observations?instant=${encodeURIComponent(instant())}`));
  let observed;
  try { observed = await observationCache.get(key); }
  catch (error) { observationCache.delete(key); if (shownObservationKey === key) shownObservationKey = null; throw error; }
  if (shownObservationKey !== key) return;
  const weather = observed.weather;
  $('weather-result').textContent = weather
    ? `ERA5 (${weather.grid_lat?.toFixed(2)}, ${weather.grid_lon?.toFixed(2)}) · ${weather.temperature_c?.toFixed(1) ?? '—'}°C · 습도 ${weather.humidity_pct ?? '—'}% · 풍속 ${weather.wind_m_s ?? '—'}m/s · 일사 ${weather.shortwave_w_m2 ?? '—'}W/m²`
    : '해당 시각의 재분석 기상 값 없음';
  const available = observed.counts.filter(c => c.passages != null);
  $('counts-result').textContent = available.length
    ? `${hhmm(Math.floor(hour))} 현지시각 · ${available.length}개 센서 · 시간당 통과수`
    : '해당 시각의 유효 자동 계수 없음 · 미관측 구간은 채우지 않음';
  const counts = new Map(observed.counts.map(row => [row.site_id, row]));
  $('count-list').replaceChildren(...observed.sites.map(site => {
    const row = counts.get(site.id), value = row?.passages;
    const item = document.createElement('div'), label = document.createElement('span'), meter = document.createElement('i'), number = document.createElement('strong');
    item.className = 'count-row';
    label.textContent = site.name || site.id;
    meter.style.setProperty('--level', `${value == null ? 0 : Math.min(100, value / 5000 * 100)}%`);
    number.textContent = value == null ? '—' : value.toLocaleString('ko-KR');
    item.append(label, meter, number);
    return item;
  }));
  scene?.setObservations(observed, hhmm(Math.floor(hour)));
}
async function loadCBD() {
  const state = await api('/api/gis/datasets'); if (!state.ready) return;
  const layers = await api('/api/gis/layers'); cbd = state; shownObservationKey = null; observationCache.clear();
  if (scene) scene.setCBDLayers(layers);
  $('walk-layer').checked = true; $('tree-layer').checked = true; $('site-layer').checked = true;
  $('cbd-state').textContent = `${state.date} · 보행 ${layers.walk_edges.length.toLocaleString()}구간 · 나무 ${layers.trees.length.toLocaleString()}그루 · 센서 ${layers.pedestrian_sites.length}곳`;
  $('bundle-version').textContent = state.bundle_version;
  $('cbd-sources').replaceChildren(...Object.entries(state.sources).map(([name, source]) => {
    const li = document.createElement('li'), a = document.createElement('a');
    a.href = source.source_url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = name;
    li.append(a, document.createTextNode(` · ${source.evidence_type} · ${source.license}`));
    return li;
  }));
  if (dateValue() !== state.date) { $('date').value = state.date; onDateChange(); }
  else { buttons(); await loadObservations(); }
}
async function importCBD() {
  const selected = dateValue();
  message('CBD 원천을 수집하고 Parquet로 검증합니다. 첫 수집에는 몇 분이 걸릴 수 있습니다.');
  const timer = setInterval(async () => {
    try { const state = await api('/api/gis/datasets'); if (state.progress?.message) $('cbd-state').textContent = state.progress.message; }
    catch { /* import request reports errors */ }
  }, 1500);
  try {
    await api('/api/gis/cbd/import', 'POST', { date: selected });
    await loadCBD();
    message('CBD 자료를 검증된 로컬 Parquet에서 읽었습니다. 출발·도착점을 지도에서 선택하세요.');
  } finally { clearInterval(timer); }
}

async function loadMicroclimate() {
  if (!microMetadata?.ready || !scene) return;
  const date = $('micro-date').value, selectedHour = Math.floor(hour);
  const key = `${microMetadata.version}:${date}:${selectedHour}`;
  if (key === shownMicroKey) return;
  shownMicroKey = key;
  if (!microCache.has(key)) microCache.set(key, api(`/api/gis/microclimate?date=${encodeURIComponent(date)}&hour=${selectedHour}`));
  let observed;
  try { observed = await microCache.get(key); }
  catch (error) { microCache.delete(key); if (shownMicroKey === key) shownMicroKey = null; throw error; }
  if (shownMicroKey !== key) return;
  scene.setTemperatureLayer(observed);
  scene.setLayer('temperatures', $('micro-layer').checked);
  const timeLabel = `${date} ${String(selectedHour).padStart(2, '0')}:00 AEDT`;
  $('micro-map-date').textContent = `기온 실측 · ${timeLabel}`;
  $('micro-map-date').hidden = !$('micro-layer').checked;
  $('micro-summary').textContent = observed.observed_sites
    ? `${timeLabel} · ${observed.observed_sites}곳 · ${observed.minimum_c.toFixed(1)}–${observed.maximum_c.toFixed(1)}°C`
    : `${timeLabel} · 유효 관측 없음`;
  const valid = observed.sites.filter(site => site.temperature_c != null).sort((a, b) => b.temperature_c - a.temperature_c);
  const examples = [valid[0], valid[Math.floor(valid.length / 2)], valid.at(-1)].filter(Boolean);
  $('micro-sites').replaceChildren(...examples.map(site => {
    const line = document.createElement('div'), name = document.createElement('span'), value = document.createElement('strong');
    name.textContent = `${site.street} · ${site.suburb}`;
    value.textContent = `${site.temperature_c.toFixed(1)}°C`;
    line.append(name, value); return line;
  }));
}
async function initMicroclimate() {
  microMetadata = await api('/api/gis/microclimate/metadata');
  if (!microMetadata.ready) {
    $('micro-state').textContent = '기온 CSV가 없습니다. README의 가져오기 명령을 실행하세요.';
    $('micro-summary').textContent = '거리 기온 원자료 대기';
    return;
  }
  $('micro-date').min = microMetadata.start_date; $('micro-date').max = microMetadata.end_date;
  if ($('micro-date').value < microMetadata.start_date || $('micro-date').value > microMetadata.end_date) $('micro-date').value = microMetadata.start_date;
  $('micro-state').textContent = `WSU 실측 ${microMetadata.site_count}곳 · ${microMetadata.start_date}–${microMetadata.end_date} · 10분 관측의 시간평균`;
  await loadMicroclimate();
}

/** Live map shadows follow the clock immediately; the server value refreshes after debounce. */
function applySunPreview() {
  const { date } = time(), sun = sunAt(date, hour, area()), day = sunDay(date);
  $('clock').textContent = hhmm(hour); $('tz').textContent = tzName(date, hour);
  $('scenario-date').textContent = `${date} ${hhmm(hour)} ${tzName(date, hour)}`;
  $('sunrise').textContent = day.rise == null ? '—' : hhmm(day.rise);
  $('sunset').textContent = day.set == null ? '—' : hhmm(day.set);
  $('noon-alt').textContent = `${day.noon.toFixed(1)}°`;
  $('daylength').replaceChildren(document.createTextNode(day.rise == null ? '—' : `${Math.floor(day.set - day.rise)}h ${String(Math.round((day.set - day.rise) % 1 * 60)).padStart(2, '0')}`), Object.assign(document.createElement('small'), { textContent: 'm' }));
  tween($('sun-alt'), sun.altitude, v => v.toFixed(1), '°');
  $('sun-az').replaceChildren(document.createTextNode(sun.azimuth.toFixed(1)), Object.assign(document.createElement('small'), { textContent: `° ${compassPoint(sun.azimuth)}` }));
  if (sun.daytime) tween($('shadow-len'), 10 / Math.tan(sun.altitude * Math.PI / 180), v => v >= 100 ? v.toFixed(0) : v.toFixed(1), ' m');
  else { tweens.delete($('shadow-len')); $('shadow-len').textContent = '야간'; }
  paintCompass(sun);
  if (scene && snapshot) { scene.setSunLight(sun); scene.setCellsStale(!isVerifiedNow()); }
  paintVerification(); paintComparison(); drawChart();
  if (cbd && shownObservationKey !== `${cbd.bundle_version}:${cbd.date}:${Math.floor(hour)}` && shownObservationKey !== `unavailable:${dateValue()}`) loadObservations().catch(e => message(e.message, true));
  if (microMetadata?.ready && shownMicroKey !== `${microMetadata.version}:${$('micro-date').value}:${Math.floor(hour)}`) loadMicroclimate().catch(e => message(e.message, true));
}
function scheduleShade() {
  applySunPreview();
  clearTimeout(shadeTimer);
  if (playing || !snapshot || isVerifiedNow()) return;
  shadeTimer = setTimeout(() => { if (busy) pendingShade = true; else work(calculate); }, 600);
}
const isVerifiedNow = () => !!run && run.date === dateValue() && run.hour === hour;

function paintCompass(sun) {
  const r = Math.max(0, 90 - Math.max(sun.altitude, 0)) / 90 * 44, a = sun.azimuth * Math.PI / 180;
  const x = (sun.daytime ? r : 44) * Math.sin(a), y = -(sun.daytime ? r : 44) * Math.cos(a);
  $('sun-dot').setAttribute('cx', x.toFixed(1)); $('sun-dot').setAttribute('cy', y.toFixed(1));
  $('sun-dot').classList.toggle('night', !sun.daytime);
  $('sun-ray').setAttribute('x2', sun.daytime ? x.toFixed(1) : 0); $('sun-ray').setAttribute('y2', sun.daytime ? y.toFixed(1) : 0);
  $('compass-label').textContent = sun.daytime ? `${sun.altitude.toFixed(0)}° / ${sun.azimuth.toFixed(0)}°` : '야간';
}

// ── Right panel: verified KPI, estimate calibration, comparison ──
function paintVerification() {
  const date = dateValue(), est = estimateNow(date, hour), sun = sunAt(date, hour, area()), now = isVerifiedNow();
  const shown = now ? run.shadePercent : est;
  tween($('shade-percent'), shown, pct, '%');
  $('shade-percent').style.color = now ? 'var(--ink)' : 'var(--ink-3)';
  $('shade-bar').style.width = `${now ? run.shadePercent || 0 : 0}%`;
  $('estimate-tick').classList.toggle('on', est != null); $('estimate-tick').style.left = `${est || 0}%`;
  if (!sun.daytime) tone($('verify-state'), 'idle', '야간');
  else if (now) tone($('verify-state'), 'verified', `검증 · ${hhmm(run.hour)}`);
  else if (busy) tone($('verify-state'), 'busy', '서버 계산 중');
  else tone($('verify-state'), 'estimate', '추정 · 검증 대기');
  $('sample-count').textContent = !sun.daytime ? '야간 · 직접 일사가 없어 그늘 비율을 계산하지 않습니다.'
    : now ? `20 m 지면 표본 ${run.samples.toLocaleString()}개 중 ${run.shadedSamples.toLocaleString()}개 그늘`
    : '화면 추정치입니다. 시각을 멈추면 서버가 같은 표본으로 검증합니다.';
  const calib = $('calibration'); calib.replaceChildren();
  calib.append(Object.assign(document.createElement('i')), `추정 ${pct(est)}%`);
  if (now && est != null && run.shadePercent != null) calib.append(` · 서버 대비 ${signed(est - run.shadePercent)}%p`);
}
function paintComparison() {
  const date = dateValue(), base = baselineDate(), scn = valueAt(date, hour), ref = valueAt(base, hour);
  $('compare-scn-label').textContent = `${scenarioName(date)} · ${date.slice(5)}`;
  $('compare-base-label').textContent = `기준 ${scenarioName(base)} · ${base.slice(5)}`;
  tween($('compare-scn'), scn, v => `${pct(v)}%`); tween($('compare-base'), ref, v => `${pct(v)}%`);
  $('compare-scn-bar').style.width = `${scn || 0}%`; $('compare-base-bar').style.width = `${ref || 0}%`;
  if (scn == null || ref == null) { tone($('delta-badge'), 'idle', 'Δ —'); $('compare-note').textContent = profiles.get(date)?.done && profiles.get(base)?.done ? `${hhmm(hour)} · 한쪽 또는 양쪽이 야간` : '추정 곡선 계산 중…'; }
  else {
    const d = scn - ref;
    tone($('delta-badge'), d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'idle', `${d > 0.05 ? '▲' : d < -0.05 ? '▼' : '='} ${signed(d)}%p vs ${scenarioName(base)}`);
    $('compare-note').textContent = `같은 시각 ${hhmm(hour)} · 화면 추정 모델 · 그늘이 많을수록 ▲`;
  }
  const p = profiles.get(date);
  if (p?.done) {
    const day = p.values.map((v, i) => [v, i * STEP]).filter(([v]) => v != null);
    // Shade peaks trivially at sunrise/sunset; the least-shaded moment is the exposure that matters.
    const mean = day.reduce((s, [v]) => s + v, 0) / (day.length || 1), least = day.reduce((a, b) => b[0] < a[0] ? b : a, [Infinity, 0]);
    tween($('day-mean'), day.length ? mean : null, v => v.toFixed(1), '%');
    $('day-min').replaceChildren(document.createTextNode(day.length ? hhmm(least[1]) : '—'), Object.assign(document.createElement('small'), { textContent: day.length ? ` ${least[0].toFixed(1)}%` : '' }));
  }
}

// ── Day chart: estimate (dashed), baseline (dotted), verified (solid + dots), Δ hatch ──
const M = { l: 34, r: 14, t: 18, b: 18 };
let chartGeom = null;
function el(name, attrs, parent) { const n = document.createElementNS(SVG, name); for (const k in attrs) n.setAttribute(k, attrs[k]); parent?.append(n); return n; }
function drawChart(hoverHour = chartHover) {
  const svg = $('day-svg'), w = svg.clientWidth, h = svg.clientHeight;
  if (!w || !h) return;
  const date = dateValue(), base = baselineDate(), est = profiles.get(date)?.values || [], ref = profiles.get(base)?.values || [];
  const ver = [...(verified.get(date) || new Map())].filter(([, v]) => v != null).sort((a, b) => a[0] - b[0]);
  const max = Math.max(10, ...est.filter(v => v != null), ...ref.filter(v => v != null), ...ver.map(v => v[1]));
  const top = Math.ceil(max / 10) * 10;
  const X = t => M.l + t / 24 * (w - M.l - M.r), Y = v => M.t + (1 - v / top) * (h - M.t - M.b);
  chartGeom = { X, w, h };
  svg.replaceChildren();
  const defs = el('defs', {}, svg);
  const hatch = (id, color, width, gap) => { const p = el('pattern', { id, width: gap, height: gap, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs); el('line', { x1: 0, y1: 0, x2: 0, y2: gap, stroke: color, 'stroke-width': width }, p); };
  hatch('hatch-night', '#CBD5E1', 1, 5); hatch('hatch-delta', 'rgba(13,148,136,.45)', 1, 4);
  // night zones
  const day = sunDay(date);
  if (day.rise != null) {
    for (const [a, b] of [[0, day.rise], [day.set, 24]]) { el('rect', { x: X(a), y: M.t, width: Math.max(0, X(b) - X(a)), height: h - M.t - M.b, class: 'night' }, svg); }
    el('text', { x: X(day.rise / 2), y: M.t + 12, class: 'night-label', 'text-anchor': 'middle' }, svg).textContent = '야간';
    el('text', { x: X((day.set + 24) / 2), y: M.t + 12, class: 'night-label', 'text-anchor': 'middle' }, svg).textContent = '야간';
  }
  // axes
  const ax = el('g', { class: 'ax' }, svg);
  for (const v of [0, top / 2, top]) { el('line', { x1: M.l, x2: w - M.r, y1: Y(v), y2: Y(v), class: v === 0 ? 'base' : '' }, ax); el('text', { x: M.l - 6, y: Y(v) + 3, 'text-anchor': 'end' }, ax).textContent = `${v}%`; }
  for (let t = 0; t <= 24; t += 3) { el('line', { x1: X(t), x2: X(t), y1: h - M.b, y2: h - M.b + 3 }, ax); el('text', { x: X(t), y: h - 4, 'text-anchor': t === 0 ? 'start' : t === 24 ? 'end' : 'middle' }, ax).textContent = String(t).padStart(2, '0'); }
  // Δ zone between scenario and baseline
  const both = est.map((v, i) => v != null && ref[i] != null ? i : -1).filter(i => i >= 0);
  if (both.length > 1 && date !== base) {
    const upper = both.map(i => `${X(i * STEP)},${Y(est[i])}`), lower = both.slice().reverse().map(i => `${X(i * STEP)},${Y(ref[i])}`);
    el('polygon', { points: [...upper, ...lower].join(' '), class: 's-delta' }, svg);
  }
  const path = values => { let d = '', pen = false; values.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(i * STEP).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; }); return d; };
  if (date !== base) el('path', { d: path(ref), class: 's-baseline' }, svg);
  el('path', { d: path(est), class: 's-estimate' }, svg);
  if (ver.length > 1) el('path', { d: ver.map(([t, v], i) => `${i ? 'L' : 'M'}${X(t)},${Y(v)}`).join(''), class: 's-verified' }, svg);
  for (const [t, v] of ver) el('circle', { cx: X(t), cy: Y(v), r: 4, class: 'pt-verified' }, svg);
  // Direct labels go where the two curves are farthest apart, each on its outer side.
  let at = -1, gap = -1;
  for (let i = Math.round(8 / STEP); i <= Math.round(17 / STEP); i++) {
    if (est[i] == null) continue;
    const g = date === base || ref[i] == null ? 0 : Math.abs(Y(est[i]) - Y(ref[i]));
    if (g > gap || (g === gap && Math.abs(i * STEP - 12) < Math.abs(at * STEP - 12))) { gap = g; at = i; }
  }
  if (at >= 0) {
    const t = at * STEP, estAbove = date === base || ref[at] == null || est[at] >= ref[at];
    const label = (v, text, color, up) => el('text', { x: X(t), y: Y(v) + (up ? -8 : 15), class: 'direct-label', fill: color, 'text-anchor': 'middle' }, svg).textContent = text;
    label(est[at], scenarioName(date), '#0F766E', estAbove);
    if (date !== base && ref[at] != null) label(ref[at], `기준 ${scenarioName(base)}`, '#475569', !estAbove);
  }
  if (!profiles.get(date)?.done && snapshot) el('text', { x: w - M.r, y: M.t - 6, 'text-anchor': 'end', class: 'night-label' }, svg).textContent = '추정 곡선 계산 중…';
  // hover crosshair
  if (hoverHour != null) el('line', { x1: X(hoverHour), x2: X(hoverHour), y1: M.t, y2: h - M.b, class: 'hover-line' }, svg);
  // present cursor
  const cx = X(hour);
  el('line', { x1: cx, x2: cx, y1: M.t - 2, y2: h - M.b, class: 'cursor-line' }, svg);
  const lw = 40, lx = Math.min(Math.max(cx - lw / 2, M.l), w - M.r - lw);
  el('rect', { x: lx, y: 0, width: lw, height: 14, class: 'cursor-head' }, svg);
  el('text', { x: lx + lw / 2, y: 10.5, 'text-anchor': 'middle', class: 'cursor-label' }, svg).textContent = hhmm(hour);
  const cv = isVerifiedNow() ? run.shadePercent : valueAt(date, hour);
  if (cv != null) el('circle', { cx, cy: Y(cv), r: 3.5, fill: '#fff', stroke: isVerifiedNow() ? 'var(--data-verified)' : 'var(--data-estimate)', 'stroke-width': 2 }, svg);
}
let dragging = false;
const chartHour = e => { const r = $('day-svg').getBoundingClientRect(), t = (e.clientX - r.left - M.l) / (r.width - M.l - M.r) * 24; return Math.min(23.75, Math.max(0, Math.round(t / STEP) * STEP)); };
function chartTip(e) {
  const tip = $('chart-tip'), date = dateValue(), base = baselineDate(), t = chartHour(e);
  chartHover = t; drawChart();
  const row = (cls, name, v) => `<div class="tip-row"><span><i class="ln ${cls}"></i>${name}</span><b>${v == null ? '—' : `${v.toFixed(1)}%`}</b></div>`;
  tip.innerHTML = `<h4>${date} ${hhmm(t)}</h4>${row('ln-estimate', `추정 · ${scenarioName(date)}`, valueAt(date, t))}${date !== base ? row('ln-baseline', `기준 · ${scenarioName(base)}`, valueAt(base, t)) : ''}${row('ln-verified', '검증 · 서버', verifiedAt(date, t))}`;
  tip.hidden = false;
  const box = $('day-chart').getBoundingClientRect(), x = e.clientX - box.left;
  tip.style.left = `${x + 12 + 180 > box.width ? x - 12 - tip.offsetWidth : x + 12}px`; tip.style.top = '4px';
}
$('day-svg').addEventListener('pointerdown', e => { dragging = true; $('day-svg').setPointerCapture(e.pointerId); pause(); leaveLiveMode(); setHour(chartHour(e)); });
$('day-svg').addEventListener('pointermove', e => { chartTip(e); if (dragging) { leaveLiveMode(); setHour(chartHour(e)); } });
$('day-svg').addEventListener('pointerup', () => { dragging = false; });
$('day-svg').addEventListener('pointerleave', () => { chartHover = null; $('chart-tip').hidden = true; drawChart(); });
new ResizeObserver(() => drawChart()).observe($('day-chart'));

// ── Playback ──────────────────────────────────────────────
const HOURS_PER_SECOND = { 1: 0.1, 5: 0.5, 24: 2.4 };
function frame(now) {
  if (!playing) return;
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  hour = (hour + dt * HOURS_PER_SECOND[speed]) % 24;
  $('hour').value = hour; applySunPreview();
  requestAnimationFrame(frame);
}
function play() { if (!snapshot) return; leaveLiveMode(); playing = true; $('play').textContent = '❚❚'; $('play').setAttribute('aria-label', '일시정지'); lastFrame = performance.now(); requestAnimationFrame(frame); }
function pause() { if (!playing) return; playing = false; $('play').textContent = '▶'; $('play').setAttribute('aria-label', '재생'); setHour(hour); }
$('play').addEventListener('click', () => playing ? pause() : play());
for (const b of $('speeds').children) b.addEventListener('click', () => { speed = Number(b.dataset.speed); for (const o of $('speeds').children) o.setAttribute('aria-pressed', String(o === b)); });

// ── Map hover tooltip ─────────────────────────────────────
let pickQueued = null;
const METHOD_LABEL = { 'openmaptiles-render-height-derived-or-default': '렌더링 파생 / 기본값', unknown: '미상' };
$('map').addEventListener('pointermove', e => {
  if (!scene || e.buttons) { $('tooltip').hidden = true; return; }
  if (pickQueued) { pickQueued = e; return; }
  pickQueued = e;
  requestAnimationFrame(() => {
    const ev = pickQueued; pickQueued = null;
    const b = scene.pick(ev.clientX, ev.clientY), tip = $('tooltip');
    if (!b) { tip.hidden = true; return; }
    const sun = sunAt(dateValue(), hour, area()), rise = b.height - b.base;
    const row = (k, v) => `<div class="tip-row"><span>${k}</span><b>${v}</b></div>`;
    tip.innerHTML = `<h4>건물 · OSM ${b.info.id ?? '—'}</h4>${row('높이', `${b.height.toFixed(1)} m`)}${b.base ? row('하부 높이', `${b.base.toFixed(1)} m`) : ''}${row('이 시각 그림자 길이', sun.daytime ? `${(rise / Math.tan(sun.altitude * Math.PI / 180)).toFixed(0)} m → ${compassPoint((sun.azimuth + 180) % 360)}` : '야간')}${row('높이 출처', METHOD_LABEL[b.info.method] || b.info.method || '—')}${row('타일', b.info.tile || '—')}`;
    tip.hidden = false;
    const box = $('map').getBoundingClientRect(), x = ev.clientX - box.left, y = ev.clientY - box.top;
    tip.style.left = `${x + 16 + tip.offsetWidth > box.width ? x - 16 - tip.offsetWidth : x + 16}px`;
    tip.style.top = `${Math.max(8, Math.min(y + 16, box.height - tip.offsetHeight - 8))}px`;
  });
});
$('map').addEventListener('pointerleave', () => { $('tooltip').hidden = true; scene?.setHover(null); });

// ── Data loading & server calls ───────────────────────────
function wireMapPick() {
  if (!scene) return;
  scene.onMapClick = point => {
    if (!pickMode) return;
    if (pickMode === 'start') startPoint = point; else endPoint = point;
    pickMode = null;
    $('route-points').textContent = `출발 ${startPoint ? startPoint.map(x => x.toFixed(5)).join(', ') : '미선택'} / 도착 ${endPoint ? endPoint.map(x => x.toFixed(5)).join(', ') : '미선택'}`;
    buttons(); message('지점을 선택했습니다.');
  };
}
async function load() {
  const data = await api('/api/gis/data');
  if (!scene) scene = new CityScene($('map'), { onPlace: place => { $('place-focus').textContent = place.focused ? `포커스 · ${place.name}` : `보는 곳 · ${place.name}`; } });
  wireMapPick();
  scene.setData(data); snapshot = data; $('map-empty').hidden = true;
  paintLiveWeather();
  for (const [id, layer] of [['buildings', 'buildings'], ['layer-shade', 'shade'], ['layer-cells', 'cells'], ['layer-ground', 'ground']]) scene.setLayer(layer, $(id).checked);
  $('place-focus').textContent = '보는 곳 · CBD';
  const a = snapshot.area; $('area-coords').textContent = `${a.west.toFixed(3)}–${a.east.toFixed(3)}°E · ${Math.abs(a.north).toFixed(3)}–${Math.abs(a.south).toFixed(3)}°S`;
  $('building-count').textContent = snapshot.counts.building.toLocaleString(); $('height-count').textContent = snapshot.features.filter(f => f.properties.casts_shadow).length.toLocaleString();
  $('storage').textContent = 'GeoParquet · 검증 완료'; $('read-source').textContent = '로컬 Parquet'; $('version').textContent = snapshot.version;
  $('import-hint').textContent = `저장 완료 · ${new Date(snapshot.fetchedAt).toLocaleString('ko-KR', { timeZone: ZONE })}`; $('import').textContent = 'GIS 데이터 저장됨 ✓';
  $('parquet-files').replaceChildren(...snapshot.manifest.files.map(f => { const li = document.createElement('li'); li.textContent = `${f.name} · ${f.rows.toLocaleString()}행`; return li; }));
  const plan = await api('/api/gis/zetaris/plan'); $('sql-plan').textContent = plan.statements.map(sql => sql + ';').join('\n\n');
  const memory = await api('/api/gis/memory'); if (memory) { $('date').value = memory.constraints.date; hour = memory.constraints.hour; $('hour').value = hour; leaveLiveMode(); $('memory-state').textContent = '같은 구역·자료 버전의 관찰 조건을 복원했습니다. 전체 H-MEM 엔진 통합 전입니다.'; }
  sunDays.clear(); paintScenarios(); requestProfiles(); applySunPreview();
  await calculate();
  try { await loadCBD(); } catch { /* CBD optional until imported */ }
  try { await initMicroclimate(); } catch (error) { $('micro-state').textContent = `기온 자료 오류 · ${error.message}`; }
}
async function importData() {
  let polling = false;
  const poll = async () => {
    if (polling) return; polling = true;
    try { const state = await api('/api/gis/status'); if (state.progress?.message) { message(state.progress.message, state.progress.stage === 'error'); $('import-hint').textContent = state.progress.message; } }
    catch { /* The import request reports its own failure. */ }
    finally { polling = false; }
  };
  message('시드니 GIS를 자동으로 가져옵니다. 처음에는 다운로드와 Parquet 변환이 필요합니다.');
  $('import').textContent = '지도 데이터 수집 중…';
  const timer = setInterval(poll, 1000);
  try { await api('/api/gis/import','POST',{}); }
  catch (error) { $('import').textContent = '지도 데이터 다시 가져오기'; $('import-hint').textContent = error.message; throw error; }
  finally { clearInterval(timer); }
  await load();
}
async function calculate() {
  const input = time();
  paintVerification();
  message(`서버가 ${input.date} ${hhmm(input.hour)}의 그늘 비율을 실제 건물 높이로 검증 계산하고 있습니다.`);
  let result;
  try { result = await api('/api/gis/shadow', 'POST', input); }
  catch (error) {
    if (error.status !== 429) throw error;
    // Another tab or request holds the single GIS worker; retry instead of alarming.
    message('다른 그늘 계산이 진행 중입니다. 끝나면 이 시각을 이어서 검증합니다.');
    setTimeout(scheduleShade, 4000); return;
  }
  if (!verified.has(result.date)) verified.set(result.date, new Map());
  verified.get(result.date).set(result.hour, result.shadePercent);
  run = result; scene.setRun(run); $('explanation').textContent = '';
  $('run-model').textContent = `LoD1 광선 교차 · ${run.resolutionM} m`;
  applySunPreview();
  if (cbd) await loadObservations().catch(() => {});
  message(run.daylight
    ? `검증 완료 · ${run.date} ${hhmm(run.hour)} · 파란 점은 서버가 그늘로 판정한 20 m 표본, 옅은 파란 면은 화면 그림자 투영입니다.`
    : '해가 지평선 아래입니다. 그늘 영역이 꺼져 있습니다.');
}
$('hour').addEventListener('input', () => { pause(); leaveLiveMode(); setHour(Number($('hour').value)); });
$('hour').addEventListener('change', () => { if (cbd) loadObservations().catch(e => message(e.message, true)); });
$('date').addEventListener('change', onDateChange);
$('live-now').addEventListener('click', activateLiveMode);
$('live-layer').addEventListener('change', paintLiveWeather);
$('baseline').addEventListener('change', () => { requestProfiles(); paintComparison(); drawChart(); });
$('import').addEventListener('click', () => work(importData));
$('cbd-import').addEventListener('click', () => work(importCBD));
$('micro-date').addEventListener('change', () => { shownMicroKey = null; loadMicroclimate().catch(e => message(e.message, true)); });
$('micro-layer').addEventListener('change', () => { scene?.setLayer('temperatures', $('micro-layer').checked); $('micro-map-date').hidden = !$('micro-layer').checked || !microMetadata?.ready; });
$('pick-start').addEventListener('click', () => { pickMode = 'start'; message('지도에서 출발점을 클릭하세요.'); });
$('pick-end').addEventListener('click', () => { pickMode = 'end'; message('지도에서 도착점을 클릭하세요.'); });
$('route').addEventListener('click', () => work(async () => {
  const payload = { start: startPoint, end: endPoint, departure_utc: instant(), profile: $('profile').value, max_detour_minutes: Number($('detour').value) };
  message('보행망과 건물·나무 그늘을 따라 두 경로를 계산합니다.');
  routeRun = await api('/api/gis/routes', 'POST', payload); scene.setRoutes(routeRun);
  const a = routeRun.fastest, b = routeRun.lower_exposure;
  $('route-result').hidden = false;
  $('route-summary').textContent = `최단시간 ${a.travel_minutes}분 · 직사광 ${a.direct_sun_minutes}분 · 미상 ${a.unknown_minutes}분 / 저노출 후보 ${b.travel_minutes}분 · 직사광 ${b.direct_sun_minutes}분 · 미상 ${b.unknown_minutes}분`;
  $('route-quality').textContent = `후보 ${routeRun.candidates_considered}개 · 시작 연결 ${routeRun.snap.start.distance}m · 도착 연결 ${routeRun.snap.end.distance}m · 저노출 경로는 전역 최적 보증이 아닌 후보 탐색입니다.`;
  $('route-run').textContent = `run ${routeRun.runId} · ${routeRun.bundle_version}`;
  message('경로 비교 완료. 노랑은 최단시간, 민트는 저노출 후보입니다.');
}));
$('simulate').addEventListener('click', () => work(calculate));
$('save').addEventListener('click', () => work(async () => { await api('/api/gis/memory','POST',time()); $('memory-state').textContent = '현재 날짜·시각을 자료 버전 및 입력 출처와 함께 저장했습니다.'; message('관찰 조건을 로컬 기억 저장소에 저장했습니다.'); }));
$('register').addEventListener('click', () => work(async () => { message('Zetaris에 Parquet 테이블을 등록하고 행 수와 버전을 검증합니다.'); const r = await api('/api/gis/zetaris/register','POST',{}); tone($('zetaris-state'), 'ok', '등록·조회 확인'); message(`Zetaris 조회 확인: ${r.rows.toLocaleString()}행 · ${r.datasetVersion}`); }));
$('verify').addEventListener('click', () => work(async () => { const r = await api('/api/gis/zetaris/summary'); tone($('zetaris-state'), 'ok', '조회 확인'); $('sql-result').hidden = false; $('sql-result').textContent = JSON.stringify({ columns: r.columns, data: r.data },null,2); message(`Zetaris가 같은 버전의 ${r.rows.toLocaleString()}개 건물 형상 행을 조회했습니다.`); }));
$('explain').addEventListener('click', () => work(async () => { message('NVIDIA 모델에 계산 결과 설명을 요청했습니다.'); const answer = await api(`/api/gis/runs/${run.runId}/explain`,'POST',{}); $('explanation').textContent = answer.text; message('AI 설명을 받았습니다. 수치는 GIS 워커가 계산하며, 설명은 별도로 검증되지 않았습니다.'); }));
for (const [id, layer] of [['buildings', 'buildings'], ['layer-shade', 'shade'], ['layer-cells', 'cells'], ['layer-ground', 'ground']]) $(id).addEventListener('change', () => { scene?.setLayer(layer, $(id).checked); if (layer === 'cells') scene?.setCellsStale(!isVerifiedNow()); });
for (const [id, layer] of [['walk-layer', 'walk'], ['tree-layer', 'trees'], ['site-layer', 'sites']]) $(id).addEventListener('change', () => { scene?.setLayer(layer, $(id).checked); });
$('perspective').addEventListener('click', () => scene?.reset()); $('top').addEventListener('click', () => scene?.reset(true)); $('reset').addEventListener('click', () => scene?.reset());
buildScenarioControls();
const initialNow = sydneyNow(); $('date').value = initialNow.date; hour = initialNow.hour; $('hour').value = hour;
paintScenarios(); applySunPreview();
refreshLiveWeather();
setInterval(() => { if (liveMode && !playing) { const now = sydneyNow(); if (dateValue() !== now.date || hour !== now.hour) { $('date').value = now.date; hour = now.hour; $('hour').value = hour; paintScenarios(); requestProfiles(); scheduleShade(); } } }, 60000);
setInterval(refreshLiveWeather, 600000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshLiveWeather(); });
await work(async () => {
  status = await api('/api/status');
  if (!status.gis) { status = null; tone($('server-state'), 'crit', '이전 서버 · 재시작 필요'); throw new Error('이전 버전 서버가 실행 중입니다. 터미널에서 Ctrl+C 후 bash scripts/start_cool_sydney.sh로 다시 실행하세요.'); }
  tone($('server-state'), 'ok', '로컬 백엔드 연결됨');
  tone($('zetaris-state'), status.zetaris.configured ? 'warn' : 'idle', status.zetaris.configured ? '키 설정 · 미검증' : '키 설정 필요');
  tone($('nvidia-state'), status.nvidia.configured ? 'warn' : 'idle', status.nvidia.configured ? '키 설정 · 미검증' : '키 설정 필요');
  if (status.gis.ready) await load(); else await importData();
});
