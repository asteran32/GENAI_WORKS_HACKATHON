import { CityScene } from './city-scene.mjs';
window.coolSydneyBooted = true;
const $ = id => document.getElementById(id);
let scene, snapshot, run, status, busy = false;
function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
async function api(route, method = 'GET', body) {
  const response = await fetch(route, { method, headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('백엔드 API 대신 다른 페이지를 받았습니다. 기존 서버를 종료하고 scripts/start_cool_sydney.sh로 다시 실행하세요.');
  const value = await response.json(); if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`); return value;
}
function buttons() {
  $('import').disabled = busy || !!snapshot;
  for (const id of ['simulate','save']) $(id).disabled = busy || !snapshot;
  for (const id of ['register','verify']) $(id).disabled = busy || !snapshot || !status?.zetaris.configured;
  $('explain').disabled = busy || !run || !status?.nvidia.configured;
}
async function work(action) { if (busy) return; busy = true; buttons(); try { await action(); } catch (e) { message(e.message, true); } finally { busy = false; buttons(); } }
function time() { const hour = Number($('hour').value); $('clock').textContent = `${String(Math.floor(hour)).padStart(2,'0')}:${String(Math.round(hour % 1 * 60)).padStart(2,'0')}`; return { date: $('date').value, hour }; }
async function load() {
  const data = await api('/api/gis/data');
  if (!scene) scene = new CityScene($('map'));
  scene.setData(data); snapshot = data; $('map-empty').hidden = true;
  $('building-count').textContent = snapshot.counts.building.toLocaleString(); $('height-count').textContent = snapshot.features.filter(f => f.properties.casts_shadow).length.toLocaleString();
  $('storage').textContent = 'GeoParquet · 검증 완료'; $('read-source').textContent = '로컬 Parquet'; $('version').textContent = snapshot.version;
  $('import-hint').textContent = `저장 완료 · ${new Date(snapshot.fetchedAt).toLocaleString('ko-KR', { timeZone: 'Australia/Sydney' })}`; $('import').textContent = 'GIS 데이터 저장됨 ✓';
  $('parquet-files').replaceChildren(...snapshot.manifest.files.map(f => { const li = document.createElement('li'); li.textContent = `${f.name} · ${f.rows.toLocaleString()}행`; return li; }));
  const plan = await api('/api/gis/zetaris/plan'); $('sql-plan').textContent = plan.statements.map(sql => sql + ';').join('\n\n');
  const memory = await api('/api/gis/memory'); if (memory) { $('date').value = memory.constraints.date; $('hour').value = memory.constraints.hour; time(); $('memory-state').textContent = '같은 구역·자료 버전의 관찰 조건을 복원했습니다. 전체 H-MEM 엔진 통합 전입니다.'; }
  await calculate();
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
  const input = time(); message('서버에서 실제 건물 형상과 높이로 그림자를 계산하고 있습니다.');
  run = await api('/api/gis/shadow', 'POST', input); scene.setRun(run);
  $('shade-percent').replaceChildren(document.createTextNode(run.shadePercent == null ? '—' : run.shadePercent.toFixed(1)), Object.assign(document.createElement('small'), { textContent: '%' }));
  $('shade-bar').style.width = `${run.shadePercent || 0}%`; $('sample-count').textContent = run.daylight ? `${run.samples.toLocaleString()}개 지면 표본 중 ${run.shadedSamples.toLocaleString()}개 그늘` : '야간 · 직접 일사가 없어 그늘 비율을 계산하지 않습니다.';
  $('sun-alt').textContent = `${run.sun.altitude.toFixed(1)}°`; $('sun-az').textContent = `${run.sun.azimuth.toFixed(1)}°`;
  $('result-state').textContent = '20m 표본 · 지도 파생 높이 기반'; $('scenario-date').textContent = `${input.date} · ${$('clock').textContent}`;
  $('explanation').textContent = ''; message('계산 완료. 민트색은 지면의 그늘 표본입니다. 수목·지형·열환경은 아직 계산에 포함되지 않았습니다.');
}
$('hour').addEventListener('input', () => { time(); if (run) $('result-state').textContent = '시간 변경됨 · 계산을 다시 실행하세요.'; });
$('date').addEventListener('change', () => { if (run) $('result-state').textContent = '날짜 변경됨 · 계산을 다시 실행하세요.'; });
$('import').addEventListener('click', () => work(importData));
$('simulate').addEventListener('click', () => work(calculate));
$('save').addEventListener('click', () => work(async () => { await api('/api/gis/memory','POST',time()); $('memory-state').textContent = '현재 날짜·시각을 자료 버전 및 입력 출처와 함께 저장했습니다.'; message('관찰 조건을 로컬 기억 저장소에 저장했습니다.'); }));
$('register').addEventListener('click', () => work(async () => { message('Zetaris에 Parquet 테이블을 등록하고 행 수와 버전을 검증합니다.'); const r = await api('/api/gis/zetaris/register','POST',{}); $('zetaris-state').textContent = '등록·조회 확인'; message(`Zetaris 조회 확인: ${r.rows.toLocaleString()}행 · ${r.datasetVersion}`); }));
$('verify').addEventListener('click', () => work(async () => { const r = await api('/api/gis/zetaris/summary'); $('zetaris-state').textContent = '조회 확인'; $('sql-result').hidden = false; $('sql-result').textContent = JSON.stringify({ columns: r.columns, data: r.data },null,2); message(`Zetaris가 같은 버전의 ${r.rows.toLocaleString()}개 건물 형상 행을 조회했습니다.`); }));
$('explain').addEventListener('click', () => work(async () => { message('NVIDIA 모델에 계산 결과 설명을 요청했습니다.'); const answer = await api(`/api/gis/runs/${run.runId}/explain`,'POST',{}); $('explanation').textContent = answer.text; message('AI 설명을 받았습니다. 수치는 GIS 워커가 계산하며, 설명은 별도로 검증되지 않았습니다.'); }));
$('buildings').addEventListener('change', () => { if (scene) scene.buildings.visible = $('buildings').checked; }); $('samples').addEventListener('change', () => { if (scene) scene.samples.visible = $('samples').checked; });
$('perspective').addEventListener('click', () => scene?.reset()); $('top').addEventListener('click', () => scene?.reset(true)); $('reset').addEventListener('click', () => scene?.reset());
time();
await work(async () => {
  status = await api('/api/status');
  if (!status.gis) { status = null; $('server-state').textContent = '이전 서버 · 재시작 필요'; throw new Error('이전 버전 서버가 실행 중입니다. 터미널에서 Ctrl+C 후 bash scripts/start_cool_sydney.sh로 다시 실행하세요.'); }
  $('server-state').textContent = '● 로컬 백엔드 연결됨'; $('zetaris-state').textContent = status.zetaris.configured ? '키 설정 · 미검증' : '키 설정 필요'; $('nvidia-state').textContent = status.nvidia.configured ? '키 설정 · 미검증' : '키 설정 필요';
  if (status.gis.ready) await load(); else await importData();
});
