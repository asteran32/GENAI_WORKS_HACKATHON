import { CityScene } from './city-scene.mjs';
window.coolSydneyBooted = true;
const $ = id => document.getElementById(id);
let scene, snapshot, run, status, busy = false, cbd = null, pickMode = null, startPoint = null, endPoint = null, routeRun = null;
function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
async function api(route, method = 'GET', body) {
  const response = await fetch(route, { method, headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('백엔드 API 대신 다른 페이지를 받았습니다. 기존 서버를 종료하고 scripts/start_cool_sydney.sh로 다시 실행하세요.');
  const value = await response.json(); if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`); return value;
}
function buttons() {
  $('import').disabled = busy || !!snapshot;
  for (const id of ['simulate','save']) $(id).disabled = busy || !snapshot;
  $('cbd-import').disabled = busy || !snapshot;
  for (const id of ['pick-start','pick-end']) $(id).disabled = busy || !cbd;
  $('route').disabled = busy || !cbd || !startPoint || !endPoint || cbd.date !== $('date').value;
  for (const id of ['register','verify']) $(id).disabled = busy || !snapshot || !status?.zetaris.configured;
  $('explain').disabled = busy || !run || !status?.nvidia.configured;
}
async function work(action) { if (busy) return; busy = true; buttons(); try { await action(); } catch (e) { message(e.message, true); } finally { busy = false; buttons(); } }
function time() { const hour = Number($('hour').value); $('clock').textContent = `${String(Math.floor(hour)).padStart(2,'0')}:${String(Math.round(hour % 1 * 60)).padStart(2,'0')}`; return { date: $('date').value, hour }; }
function instant() {
  const { date, hour } = time(), target = Date.parse(`${date}T00:00:00Z`) + hour * 3600000;
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone:'Australia/Sydney', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23' });
  let stamp=target;
  for(let i=0;i<3;i++) { const p=Object.fromEntries(fmt.formatToParts(new Date(stamp)).map(x=>[x.type,x.value]));stamp+=target-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second); }
  return new Date(stamp).toISOString();
}
async function loadObservations() {
  if (!cbd || cbd.date !== $('date').value) { $('weather-result').textContent='이 날짜의 자료를 가져오세요.';$('counts-result').textContent='관측일과 선택 날짜가 다릅니다.';return; }
  const observed=await api(`/api/gis/observations?instant=${encodeURIComponent(instant())}`), weather=observed.weather;
  $('weather-result').textContent=weather ? `ERA5 격자 재분석 (${weather.grid_lat?.toFixed(2)}, ${weather.grid_lon?.toFixed(2)}) · ${weather.temperature_c?.toFixed(1) ?? '—'}°C · 습도 ${weather.humidity_pct ?? '—'}% · 풍속 ${weather.wind_m_s ?? '—'}m/s · 일사 ${weather.shortwave_w_m2 ?? '—'}W/m²` : '해당 시각의 재분석 기상 값 없음';
  const available=observed.counts.filter(c=>c.passages!=null);
  $('counts-result').textContent=available.length ? `자동 계수 관측 ${available.length}곳 · ${available.map(c=>`${c.site_id} ${c.passages.toLocaleString()}회`).join(' / ')} (시간별 통행 횟수)` : '해당 시각의 유효 자동 계수 없음 · 미관측 구간은 채우지 않음';
}
async function loadCBD() {
  const state=await api('/api/gis/datasets');if(!state.ready)return;
  const layers=await api('/api/gis/layers');cbd=state;
  if (scene) scene.setCBDLayers(layers);
  $('walk-layer').checked=true;$('tree-layer').checked=true;$('site-layer').checked=true;
  $('cbd-state').textContent=`${state.date} · 보행 ${layers.walk_edges.length.toLocaleString()}구간 · 나무 ${layers.trees.length.toLocaleString()}그루 · 센서 ${layers.pedestrian_sites.length}곳`;
  $('bundle-version').textContent=state.bundle_version;
  $('cbd-sources').replaceChildren(...Object.entries(state.sources).map(([name,source])=>{
    const li=document.createElement('li'),a=document.createElement('a');a.href=source.source_url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=name;
    li.append(a,document.createTextNode(` · ${source.evidence_type} · ${source.license}`));return li;
  }));
  if ($('date').value!==state.date) $('date').value=state.date;
  buttons();await loadObservations();
}
async function importCBD() {
  const selected=$('date').value;
  message('CBD 원천을 수집하고 Parquet로 검증합니다. 첫 수집에는 몇 분이 걸릴 수 있습니다.');
  const timer=setInterval(async()=>{try{const state=await api('/api/gis/datasets');if(state.progress?.message)$('cbd-state').textContent=state.progress.message;}catch{/* import request reports errors */}},1500);
  try{await api('/api/gis/cbd/import','POST',{date:selected});await loadCBD();message('CBD 자료를 검증된 로컬 Parquet에서 읽었습니다. 출발·도착점을 지도에서 선택하세요.');}
  finally{clearInterval(timer);}
}
async function load() {
  const data = await api('/api/gis/data');
  if (!scene) scene = new CityScene($('map'));
  scene.setData(data); snapshot = data; $('map-empty').hidden = true;
  $('building-count').textContent = snapshot.counts.building.toLocaleString(); $('height-count').textContent = snapshot.features.filter(f => f.properties.casts_shadow).length.toLocaleString();
  $('storage').textContent = 'GeoParquet · 검증 완료'; $('read-source').textContent = '로컬 Parquet'; $('version').textContent = snapshot.version;
  $('import-hint').textContent = `저장 완료 · ${new Date(snapshot.fetchedAt).toLocaleString('ko-KR', { timeZone: 'Australia/Sydney' })}`; $('import').textContent = 'GIS 데이터 저장됨 ✓';
  $('parquet-files').replaceChildren(...snapshot.manifest.files.map(f => { const li = document.createElement('li'); li.textContent = `${f.name} · ${f.rows.toLocaleString()}행`; return li; }));
  const plan = await api('/api/gis/zetaris/plan'); $('sql-plan').textContent = plan.statements.map(sql => sql + ';').join('\n\n');
  const memory = await api('/api/gis/memory'); if (memory) { if (!status?.cbd?.ready) $('date').value = memory.constraints.date; $('hour').value = memory.constraints.hour; time(); $('memory-state').textContent = '같은 구역·자료 버전의 관찰 조건을 복원했습니다. 전체 H-MEM 엔진 통합 전입니다.'; }
  await calculate();
  await loadCBD();
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
  $('explanation').textContent = ''; message('계산 완료. 민트색은 20m 지면의 건물 그늘 표본입니다. 수목 그늘은 보행 경로 비교에만 포함됩니다.');
  if(cbd)await loadObservations();
}
$('hour').addEventListener('input', () => { time(); if (run) $('result-state').textContent = '시간 변경됨 · 계산을 다시 실행하세요.'; });
$('hour').addEventListener('change', () => { if(cbd)loadObservations().catch(e=>message(e.message,true)); });
$('date').addEventListener('change', () => { if (run) $('result-state').textContent = '날짜 변경됨 · 계산을 다시 실행하세요.';buttons();if(cbd)loadObservations().catch(e=>message(e.message,true)); });
$('import').addEventListener('click', () => work(importData));
$('cbd-import').addEventListener('click',()=>work(importCBD));
$('pick-start').addEventListener('click',()=>{pickMode='start';message('지도에서 출발점을 클릭하세요.');});
$('pick-end').addEventListener('click',()=>{pickMode='end';message('지도에서 도착점을 클릭하세요.');});
$('route').addEventListener('click',()=>work(async()=>{
  const payload={start:startPoint,end:endPoint,departure_utc:instant(),profile:$('profile').value,max_detour_minutes:Number($('detour').value)};
  message('보행망과 건물·나무 그늘을 따라 두 경로를 계산합니다.');routeRun=await api('/api/gis/routes','POST',payload);scene.setRoutes(routeRun);
  const a=routeRun.fastest,b=routeRun.lower_exposure;
  $('route-result').hidden=false;
  $('route-summary').textContent=`최단시간 ${a.travel_minutes}분 · 직사광 ${a.direct_sun_minutes}분 · 미상 ${a.unknown_minutes}분 / 저노출 후보 ${b.travel_minutes}분 · 직사광 ${b.direct_sun_minutes}분 · 미상 ${b.unknown_minutes}분`;
  $('route-quality').textContent=`후보 ${routeRun.candidates_considered}개 · 시작 연결 ${routeRun.snap.start.distance}m · 도착 연결 ${routeRun.snap.end.distance}m · 저노출 경로는 전역 최적 보증이 아닌 후보 탐색입니다. 수관 치수·하단 높이와 보행 속도는 가정입니다.`;
  $('route-run').textContent=`run ${routeRun.runId} · ${routeRun.bundle_version}`;message('경로 비교 완료. 노란색은 최단시간, 민트색은 저노출 후보입니다.');
}));
$('simulate').addEventListener('click', () => work(calculate));
$('save').addEventListener('click', () => work(async () => { await api('/api/gis/memory','POST',time()); $('memory-state').textContent = '현재 날짜·시각을 자료 버전 및 입력 출처와 함께 저장했습니다.'; message('관찰 조건을 로컬 기억 저장소에 저장했습니다.'); }));
$('register').addEventListener('click', () => work(async () => { message('Zetaris에 Parquet 테이블을 등록하고 행 수와 버전을 검증합니다.'); const r = await api('/api/gis/zetaris/register','POST',{}); $('zetaris-state').textContent = '등록·조회 확인'; message(`Zetaris 조회 확인: ${r.rows.toLocaleString()}행 · ${r.datasetVersion}`); }));
$('verify').addEventListener('click', () => work(async () => { const r = await api('/api/gis/zetaris/summary'); $('zetaris-state').textContent = '조회 확인'; $('sql-result').hidden = false; $('sql-result').textContent = JSON.stringify({ columns: r.columns, data: r.data },null,2); message(`Zetaris가 같은 버전의 ${r.rows.toLocaleString()}개 건물 형상 행을 조회했습니다.`); }));
$('explain').addEventListener('click', () => work(async () => { message('NVIDIA 모델에 계산 결과 설명을 요청했습니다.'); const answer = await api(`/api/gis/runs/${run.runId}/explain`,'POST',{}); $('explanation').textContent = answer.text; message('AI 설명을 받았습니다. 수치는 GIS 워커가 계산하며, 설명은 별도로 검증되지 않았습니다.'); }));
$('buildings').addEventListener('change', () => { if (scene) scene.buildings.visible = $('buildings').checked; }); $('samples').addEventListener('change', () => { if (scene) scene.samples.visible = $('samples').checked; });
for(const [id,layer] of [['walk-layer','walk'],['tree-layer','trees'],['site-layer','sites']]) $(id).addEventListener('change',()=>{if(scene)scene[layer].visible=$(id).checked;});
$('perspective').addEventListener('click', () => scene?.reset()); $('top').addEventListener('click', () => scene?.reset(true)); $('reset').addEventListener('click', () => scene?.reset());
time();
await work(async () => {
  status = await api('/api/status');
  if (!status.gis) { status = null; $('server-state').textContent = '이전 서버 · 재시작 필요'; throw new Error('이전 버전 서버가 실행 중입니다. 터미널에서 Ctrl+C 후 bash scripts/start_cool_sydney.sh로 다시 실행하세요.'); }
  $('server-state').textContent = '● 로컬 백엔드 연결됨'; $('zetaris-state').textContent = status.zetaris.configured ? '키 설정 · 미검증' : '키 설정 필요'; $('nvidia-state').textContent = status.nvidia.configured ? '키 설정 · 미검증' : '키 설정 필요';
  if (status.gis.ready) await load(); else await importData();
  if(scene)scene.onMapClick=point=>{if(!pickMode)return;if(pickMode==='start')startPoint=point;else endPoint=point;pickMode=null;$('route-points').textContent=`출발 ${startPoint?startPoint.map(x=>x.toFixed(5)).join(', '):'미선택'} / 도착 ${endPoint?endPoint.map(x=>x.toFixed(5)).join(', '):'미선택'}`;buttons();message('지점을 선택했습니다.');};
});
