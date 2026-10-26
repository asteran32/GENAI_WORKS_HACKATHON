(function () {
  'use strict';
  const E = CoolEngine, data = CoolData.createDataset(), $ = id => document.getElementById(id);
  const fmt = n => new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 }).format(n);
  const money = n => `A$${fmt(n)}`;
  const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const timeLabel = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round(h % 1 * 60)).padStart(2, '0')}`;
  const state = { result: null, selected: 0, input: E.validateInput(data, {}), snapshot: null, view: 'iso', zoom: 1, layers: { shadows: true, trees: true, demand: true }, route: null, routeLabel: null, stale: true, busy: false, server: false, config: null, scenarioId: null, memory: null, timer: null };
  const scope = { areaId: data.areaId, datasetVersion: data.version };
  let memoryStore, toastTimer;
  try { memoryStore = CoolMemory.createStore(JSON.parse(localStorage.getItem('cool-sydney-memory-v1') || 'null')); }
  catch { memoryStore = CoolMemory.createStore(); }
  function saveBrowserMemory() { try { localStorage.setItem('cool-sydney-memory-v1', JSON.stringify(memoryStore.state)); return true; } catch { return false; } }
  function notify(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 4500); }
  function error(message) { $('error').textContent = message; $('error').hidden = !message; }
  function selectedResult() { return state.result ? state.selected < 0 ? state.result.baseline : state.result.alternatives[state.selected] : null; }
  function readInput() {
    return E.validateInput(data, { date: $('date').value, hour: +$('hour').value, budget: +$('budget').value, maxFacilities: +$('max-facilities').value, walkMinutes: +$('walk-minutes').value, speed: +$('speed').value, accessibleOnly: $('accessible').checked, extendHours: $('extend').checked, candidateIds: [...document.querySelectorAll('[data-candidate]:checked')].map(el => el.dataset.candidate) });
  }
  function populateCandidates() {
    $('candidate-list').innerHTML = data.facilities.filter(f => !f.existing).map(f => `<label class="candidate" data-candidate-row="${f.id}"><input type="checkbox" data-candidate="${f.id}" checked><span>${esc(f.short)}${f.accessible ? '' : ' · 계단'}</span><small>${money(f.cost / 1000)}k</small></label>`).join('');
  }
  function applyInput(input) {
    const s = E.validateInput(data, input);
    for (const [id, key] of [['date', 'date'], ['hour', 'hour'], ['budget', 'budget'], ['max-facilities', 'maxFacilities'], ['walk-minutes', 'walkMinutes'], ['speed', 'speed']]) $(id).value = s[key];
    $('accessible').checked = s.accessibleOnly; $('extend').checked = s.extendHours;
    document.querySelectorAll('[data-candidate]').forEach(el => el.checked = s.candidateIds.includes(el.dataset.candidate));
    changed();
  }
  function changed() {
    state.stale = true; state.route = null; state.routeLabel = null;
    $('export').disabled = true; $('explain').disabled = true;
    $('result-status').textContent = '이전 결과'; $('result-status').className = 'status-pill stale';
    $('run-state').textContent = '설정 변경 · 시나리오 계산을 눌러 갱신하세요';
    $('map-mode').textContent = 'SHADE PREVIEW / 결과 갱신 필요';
    $('hour-value').textContent = timeLabel(+$('hour').value); $('budget-value').textContent = money(+$('budget').value);
    $('candidate-count').textContent = document.querySelectorAll('[data-candidate]:checked').length + '곳';
    $('map-detail').innerHTML = '<span class="detail-icon">⌖</span><div><strong>그늘 미리보기</strong><p>현재 시각의 그늘입니다. 오른쪽 지표는 재계산 전까지 이전 결과로 유지됩니다.</p></div>';
    document.querySelectorAll('[data-candidate-row]').forEach(el => el.classList.toggle('excluded', $('accessible').checked && !data.facilities.find(f => f.id === el.dataset.candidateRow).accessible));
    try { state.input = readInput(); error(''); } catch (e) { error(e.message); }
    // The shade preview depends only on a valid date and time, independently of budget validity.
    try { const previewInput = E.validateInput(data, { date: $('date').value, hour: +$('hour').value }); state.snapshot = E.shadeSnapshot(data, previewInput); renderSun(previewInput); renderMap(); } catch { /* Keep the last valid map; form error is visible. */ }
  }
  function project(x, y, z = 0) {
    return state.view === 'top' ? [50 + x * .86, 775 - y * .72] : [600 + (x - 640) * .58 + (y - 480) * .38, 475 + (x - 640) * .25 - (y - 480) * .36 - z * 1.15];
  }
  const points = polygon => polygon.map(p => project(...p).map(n => n.toFixed(2)).join(',')).join(' ');
  const poly = (p, attrs) => `<polygon points="${points(p)}" ${attrs}/>`;
  function renderSun(input) {
    const s = state.snapshot.sun;
    $('sun-info').textContent = s.daytime ? `태양 고도 ${s.altitude.toFixed(1)}° · 방위 ${s.azimuth.toFixed(0)}°` : '해가 지평선 아래 · 직사광 없음';
    const instant = E.localInstant(input.date, input.hour);
    $('map-time').textContent = new Intl.DateTimeFormat('en-AU', { timeZone: data.timezone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(instant).toUpperCase();
    const curve = [];
    for (let h = 8; h <= 18; h += .5) { const sun = E.sunPosition(E.localInstant(input.date, h), data.latitude, data.longitude); curve.push(`${(h - 8) * 25},${32 - Math.max(0, sun.altitude) / 3}`); }
    const x = (input.hour - 8) * 25, y = 32 - Math.max(0, s.altitude) / 3;
    $('sun-chart').innerHTML = `<svg viewBox="-5 0 260 36" preserveAspectRatio="none" aria-hidden="true"><path d="M0,33H250" stroke="#3b4b50"/><polyline points="${curve.join(' ')}" fill="none" stroke="#af9662" stroke-width="1.4"/><line x1="${x}" y1="${y}" x2="${x}" y2="34" stroke="#e9c779" stroke-dasharray="2 2"/><circle cx="${x}" cy="${y}" r="3" fill="#efc779"/></svg>`;
  }
  function renderMap() {
    if (!state.snapshot) return;
    const active = !state.stale ? selectedResult() : null;
    const district = [[0, 0], [data.width, 0], [data.width, data.height], [0, data.height]];
    $('district-clip-shape').setAttribute('points', points(district));
    const chunks = [poly(district, 'fill="#1f3038" stroke="#41545c" stroke-width="1.2"')];
    chunks.push('<g clip-path="url(#district-clip)">');
    for (const park of data.parks) chunks.push(poly(E.footprint(park), 'fill="#263e38" stroke="#35554a" stroke-width="1"'));
    for (const edge of data.edges) {
      const a = project(data.nodes[edge.a].x, data.nodes[edge.a].y), b = project(data.nodes[edge.b].x, data.nodes[edge.b].y);
      chunks.push(`<path d="M${a}L${b}" fill="none" stroke="#3a4a50" stroke-width="14"/><path d="M${a}L${b}" fill="none" stroke="${edge.accessible ? '#4c5b60' : '#a48a70'}" stroke-width=".8" stroke-dasharray="${edge.accessible ? '6 8' : '3 3'}"/>`);
    }
    if (state.layers.shadows) {
      if (!state.snapshot.sun.daytime) chunks.push(poly(district, 'fill="#071019" opacity=".7"'));
      else for (const shadow of state.snapshot.shadows) chunks.push(poly(shadow.polygon, `fill="${shadow.kind === 'tree' ? '#071d19' : '#050d14'}" opacity="${shadow.kind === 'tree' ? '.52' : '.6'}"`));
    }
    if (active && state.layers.demand) for (const d of active.clusters) {
      const node = data.nodes[d.node], p = project(node.x, node.y), unmet = 1 - d.served / d.population;
      chunks.push(`<circle cx="${p[0]}" cy="${p[1]}" r="${18 + unmet * 14}" fill="${unmet > .5 ? '#bb743f' : '#419e87'}" opacity=".11"/>`);
    }
    if (state.route) {
      const route = state.route.path.map(i => project(data.nodes[i].x, data.nodes[i].y).join(',')).join(' ');
      chunks.push(`<polyline points="${route}" fill="none" stroke="#0e2b28" stroke-width="11"/><polyline points="${route}" fill="none" stroke="#93f8db" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    // Painter ordering for the fixed oblique camera. Ground shadows precede all objects.
    const objects = data.buildings.filter(b => b.x >= 0 && b.y >= 0 && b.x < data.width && b.y < data.height).map(b => ({ kind: 'b', item: b, depth: project(b.x + b.w / 2, b.y + b.d / 2)[1] }));
    if (state.layers.trees) objects.push(...data.trees.map(t => ({ kind: 't', item: t, depth: project(t.x, t.y)[1] })));
    objects.sort((a, b) => a.depth - b.depth);
    for (const o of objects) {
      if (o.kind === 'b') {
        const b = o.item, base = E.footprint(b), top = base.map(p => [...p, state.view === 'top' ? 0 : b.height]);
        if (state.view === 'iso') {
          chunks.push(poly([base[0], base[1], top[1], top[0]], 'fill="#263942" stroke="#344b55" stroke-width=".6"'));
          chunks.push(poly([base[1], base[2], top[2], top[1]], 'fill="#1c2b34" stroke="#344b55" stroke-width=".6"'));
        }
        chunks.push(poly(top, `fill="${b.height > 32 ? '#50636c' : '#42565f'}" stroke="#6b8087" stroke-opacity=".55" stroke-width=".7"`));
        if (b.height > 30) {
          const roof = [[b.x + 8, b.y + 10, b.height + 1], [b.x + b.w - 8, b.y + 10, b.height + 1], [b.x + b.w - 8, b.y + 22, b.height + 1], [b.x + 8, b.y + 22, b.height + 1]];
          chunks.push(poly(roof, 'fill="#344b55" stroke="#607782" stroke-width=".5"'));
        }
      } else {
        const t = o.item, ground = project(t.x, t.y), p = project(t.x, t.y, t.height * .8);
        chunks.push(`<path d="M${ground}L${p}" stroke="#8a8061" stroke-width="1.7"/><ellipse cx="${p[0]}" cy="${p[1]}" rx="${t.radius * .8}" ry="${t.radius * (state.view === 'top' ? .75 : .7)}" fill="#3b6a55" stroke="#639a78" stroke-width=".7"/><ellipse cx="${p[0] - 1.5}" cy="${p[1] - 2}" rx="${t.radius * .4}" ry="${t.radius * .35}" fill="#518267"/>`);
      }
    }
    chunks.push('</g>');
    if (state.layers.demand) for (const d of data.demand) {
      const n = data.nodes[d.node], p = project(n.x, n.y), c = active?.clusters.find(x => x.id === d.id), unmet = c ? 1 - c.served / c.population : .5;
      chunks.push(`<g data-demand="${d.id}" tabindex="0" role="button" aria-label="수요 구역 ${d.id}: 합성 인구 ${d.population}명, 경로 보기"><circle cx="${p[0]}" cy="${p[1]}" r="${4 + d.population / 28}" fill="${unmet > .5 ? '#d5a071' : '#79c3aa'}" stroke="#172930" stroke-width="2"/><title>${d.id} · ${d.population}명${c ? ` / 미충족 ${d.population - c.served}명` : ''}</title></g>`);
    }
    for (const f of data.facilities) {
      const n = data.nodes[f.node], p = project(n.x, n.y), selected = active?.selectedIds.includes(f.id), included = state.input.candidateIds.includes(f.id), color = f.existing ? '#f0cc82' : selected ? '#86f0d3' : '#a9bec7';
      chunks.push(`<g data-facility="${f.id}" tabindex="0" role="button" aria-label="${esc(f.name)}${f.existing ? ', 기존 시설' : ', 검토 후보 포함 또는 제외'}" opacity="${f.existing || included ? 1 : .35}"><circle cx="${p[0]}" cy="${p[1]}" r="20" fill="${color}" opacity=".09"/><path d="M${p[0]},${p[1] - 2}L${p[0] - 12},${p[1] - 20}A17,17 0 1,1 ${p[0] + 12},${p[1] - 20}Z" fill="${color}" class="pin-fill" stroke="#102b2d" stroke-width="2"/><text x="${p[0]}" y="${p[1] - 23}" fill="#17332c" text-anchor="middle" font-size="12" font-family="sans-serif" font-weight="700" pointer-events="none">${f.existing ? 'H' : f.id.slice(1)}</text><title>${esc(f.name)} · 수용 ${f.capacity}명</title></g>`);
    }
    const parkLabel = project(660, 505);
    chunks.push(`<text x="${parkLabel[0]}" y="${parkLabel[1] + 20}" fill="#81a890" text-anchor="middle" font-size="8" letter-spacing="1.5" pointer-events="none">SYNTHETIC PARK</text>`);
    $('map-world').innerHTML = chunks.join('');
    $('map-world').setAttribute('transform', `translate(${600 * (1 - state.zoom)} ${425 * (1 - state.zoom)}) scale(${state.zoom})`);
    $('north-arrow').textContent = state.view === 'top' ? '↑' : '↗';
    // Scale bar follows the east-west projected axis, and therefore changes with view/zoom.
    const scaleWidth = state.view === 'top' ? 172 : Math.hypot(.58, .25) * 200;
    document.querySelector('.map-scale span').style.width = `${scaleWidth / 1200 * $('city-map').getBoundingClientRect().width * state.zoom}px`;
  }
  function showDemand(id) {
    const a = selectedResult();
    if (state.stale || !a) return notify('현재 조건으로 시나리오를 먼저 계산하세요.');
    const d = a.clusters.find(x => x.id === id), assigned = a.assignments.filter(x => x.demandId === id).sort((x, y) => y.count - x.count)[0];
    state.route = assigned || null;
    const f = assigned && data.facilities.find(f => f.id === assigned.facilityId);
    $('map-detail').innerHTML = `<span class="detail-icon">⌁</span><div><strong>${esc(id)} · ${d.population}명 중 ${d.served}명 수용</strong><p>${assigned ? `${esc(f.short)}까지 ${assigned.minutes.toFixed(1)}분 · 직사광 등가 ${assigned.sunMinutes.toFixed(1)}분<br>이 경로의 ${assigned.group === 'priority' ? '우선 집단' : '일반 집단'} 배정 ${assigned.count}명 / 경로 일부 예시` : '현재 조건의 시설·시간·수용량 안에서 배정되지 않은 수요입니다.'}</p></div>`;
    renderMap();
  }
  function renderResults() {
    const r = state.result, a = selectedResult(), base = r.baseline, additional = a.served - base.served;
    $('additional').textContent = `${additional >= 0 ? '+' : ''}${fmt(additional)}`;
    $('coverage-value').textContent = `${a.coverage}%`; $('coverage-bar').style.width = `${a.coverage}%`; $('baseline-marker').style.left = `${base.coverage}%`;
    $('baseline-coverage').textContent = `기준안 ${base.coverage}%`; $('unmet-value').textContent = `미충족 ${fmt(a.unmet)}명`;
    $('priority-value').textContent = `${a.priorityCoverage}%`; $('priority-change').textContent = `${fmt(a.priorityServed)} / ${fmt(a.priorityPopulation)}명 수용`;
    $('per-person').textContent = a.costPerAdditional == null ? '계산 불가' : money(Math.round(a.costPerAdditional));
    $('walk-value').textContent = a.meanWalkMinutes == null ? '—' : `${a.meanWalkMinutes.toFixed(1)}분`;
    $('exposure-value').textContent = a.meanSunMinutes == null ? '—' : `${a.meanSunMinutes.toFixed(1)}분`;
    $('shade-value').textContent = r.shadePercent == null ? '직사광 없음' : `${r.shadePercent}%`;
    $('selected-number').textContent = `${a.selectedIds.length}곳`;
    $('selected-facilities').innerHTML = a.selectedIds.length ? a.selectedIds.map(id => { const f = data.facilities.find(f => f.id === id); return `<div class="selected-item"><i>${id.slice(1)}</i>${esc(f.short)}<span>${f.capacity}명</span></div>`; }).join('') : '<div class="selected-item">추가 시설 없음</div>';
    if (state.selected >= 0 && r.input.extendHours) $('selected-facilities').innerHTML += '<div class="selected-item">＋ 기존 허브 운영 연장<span>20시까지</span></div>';
    $('total-cost').textContent = `${money(a.cost)} / ${money(r.input.budget)}`;
    $('insight').textContent = additional > 0 ? `이 배치는 기준안보다 ${fmt(additional)}명을 더 수용합니다. 그래도 ${fmt(a.unmet)}명은 미충족입니다. 그늘이 있어도 냉방 공간 수요는 사라지지 않습니다.` : '이 조건에서는 추가 수용 인원이 없습니다. 예산·운영시간·보행 한도·후보 시설을 확인하세요.';
    $('comparison-count').textContent = `${r.evaluated}개 유효 조합 비교`;
    const all = [{ ...base, label: '현재 기준안', index: -1 }, ...r.alternatives.map((item, i) => ({ ...item, label: i ? `대안 ${i + 1}` : '계산 추천안', index: i }))];
    $('alternatives').innerHTML = all.map(item => `<button class="alternative ${item.index === 0 ? 'best' : ''} ${item.index === state.selected ? 'current' : ''}" data-alternative="${item.index}" aria-pressed="${item.index === state.selected}"><div class="alt-top"><span>${item.label}</span><span>${item.index === 0 ? 'BEST IN SCENARIO' : item.index === -1 ? 'BASELINE' : 'ALTERNATIVE'}</span></div><div class="alt-value"><strong>${fmt(item.served)}</strong><span>명 수용</span><small>${item.coverage}%</small></div><div class="alt-bar"><i style="width:${item.coverage}%"></i></div><div class="alt-names">${item.index === -1 ? '기존 커뮤니티 허브' : item.selectedIds.map(id => esc(data.facilities.find(f => f.id === id).short)).join(' · ') || '추가 시설 없음'}${item.index >= 0 && r.input.extendHours ? ' · 운영 연장' : ''}</div><div class="alt-stats"><span>우선 집단 <strong>${fmt(item.priorityServed)}명</strong></span><strong>${money(item.cost)}</strong></div></button>`).join('');
    $('result-status').textContent = state.selected < 0 ? '기준안' : '검증 통과'; $('result-status').className = 'status-pill';
    $('map-mode').textContent = state.selected < 0 ? 'BASELINE / 기준안' : `ALTERNATIVE ${state.selected + 1} / 계산 결과`;
    $('run-id').textContent = r.runId || 'browser-local';
    $('trace').innerHTML = [`합성 자료 ${r.datasetVersion}`, `태양·그늘 / 옥외 ${r.shadeResolutionM}m 표본`, '보행망·이동 중 노출', `${r.evaluated}개 배치 조합`, '수요 중복·수용량·예산 검증', state.server ? '서버 결과 원장 저장' : '브라우저 계산 · JSON 내보내기 가능'].map(t => `<li>${esc(t)}</li>`).join('');
    $('export').disabled = false; $('explain').disabled = !(state.server && state.config?.nvidia.configured);
    renderMap();
  }
  async function api(path, body) {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(65000) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `API 오류 ${response.status}`);
    return payload;
  }
  async function browserSolve(input) {
    if (!globalThis.Worker || !globalThis.COOL_WORKER_SOURCE) { await new Promise(r => setTimeout(r, 25)); return E.solve(data, input); }
    return new Promise((resolve, reject) => {
      let worker, url, timer;
      const clean = () => { clearTimeout(timer); worker?.terminate(); if (url) URL.revokeObjectURL(url); };
      try {
        url = URL.createObjectURL(new Blob([globalThis.COOL_WORKER_SOURCE], { type: 'application/javascript' })); worker = new Worker(url);
        timer = setTimeout(() => { clean(); reject(new Error('계산 시간이 30초를 초과했습니다.')); }, 30000);
        worker.onmessage = event => { clean(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result); };
        worker.onerror = () => { clean(); setTimeout(() => { try { resolve(E.solve(data, input)); } catch (e) { reject(e); } }, 25); };
        worker.postMessage(input);
      } catch { clean(); setTimeout(() => { try { resolve(E.solve(data, input)); } catch (e) { reject(e); } }, 25); }
    });
  }
  async function run() {
    if (state.busy) return;
    stopPlay();
    let input; try { input = readInput(); } catch (e) { return error(e.message); }
    state.busy = true; $('run').disabled = true; $('run-state').textContent = '그늘 → 보행 → 배치 → 검증 계산 중…'; error('');
    const started = performance.now();
    try {
      let result;
      if (state.server) {
        const scenario = await api('/api/scenarios', input); state.scenarioId = scenario.id;
        const job = await api(`/api/scenarios/${scenario.id}/runs`, {});
        let status;
        for (let i = 0; i < 120; i++) {
          status = await api(`/api/jobs/${job.id}`);
          if (status.status === 'succeeded') break;
          if (status.status === 'failed') throw new Error(status.error || '계산 작업이 실패했습니다.');
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (status.status !== 'succeeded') throw new Error('작업 조회가 60초를 초과했습니다.');
        result = await api(`/api/runs/${status.runId}`);
      } else {
        result = await browserSolve(input);
        result.runId = `local-${Date.now().toString(36)}`; result.createdAt = new Date().toISOString();
        if (globalThis.crypto?.subtle) result.inputHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ version: data.version, solver: E.VERSION, input }))))].map(x => x.toString(16).padStart(2, '0')).join('');
      }
      // Never install a completed result over newer form inputs.
      if (JSON.stringify(readInput()) !== JSON.stringify(input)) { $('run-state').textContent = '계산 중 설정이 변경됐습니다. 다시 계산하세요.'; return; }
      state.result = result; state.input = input; state.selected = 0; state.stale = false; state.route = null;
      state.snapshot = E.shadeSnapshot(data, input); renderSun(input); renderResults();
      $('run-state').textContent = `${((performance.now() - started) / 1000).toFixed(2)}초 · ${result.evaluated}개 조합 · 입력·결과 검증 통과`;
      $('map-detail').innerHTML = '<span class="detail-icon">⌖</span><div><strong>결과를 탐색하세요</strong><p>밝은 시설은 선택된 배치입니다. 수요 점을 누르면 배정된 보행 경로를 볼 수 있습니다.</p></div>';
    } catch (e) { error(e.message); state.stale = true; $('result-status').textContent = '계산 실패'; $('result-status').className = 'status-pill stale'; $('export').disabled = true; $('explain').disabled = true; $('run-state').textContent = '실패 · 입력과 연결 상태를 확인하세요'; }
    finally { state.busy = false; $('run').disabled = false; }
  }
  function stopPlay() { if (state.timer) clearInterval(state.timer); state.timer = null; $('play').textContent = '▶ 시간 재생'; $('play').setAttribute('aria-pressed', 'false'); }
  function renderMemory(record) {
    state.memory = record; $('restore-memory').disabled = !record;
    if (!record) return;
    const s = record.constraints;
    $('memory-text').textContent = `예산 ${money(s.budget)} · 최대 ${s.maxFacilities}곳 · 보행 ${s.walkMinutes}분 · ${s.accessibleOnly ? '계단 제외' : '계단 포함'} · 후보 ${s.candidateIds.length}곳`;
    $('memory-meta').textContent = `${record.id} · ${record.datasetVersion} · 출처 ${record.source.type} · ${record.supersedes ? '이전 기억 대체' : '첫 기록'}`;
  }
  async function remember() {
    try {
      const input = readInput();
      if (state.server) renderMemory(await api('/api/memory', { constraints: input }));
      else {
        const record = memoryStore.save({ scope, constraints: input, source: { type: 'user-form', id: 'browser-ui' } }); renderMemory(record);
        if (!saveBrowserMemory()) return notify('이 탭에만 기억했습니다. 브라우저 저장소를 사용할 수 없습니다.');
      }
      notify('현재 제약을 출처·데이터 버전과 함께 기억했습니다.');
    } catch (e) { notify(e.message); }
  }
  async function restoreMemory() {
    try {
      const record = state.server ? await api('/api/memory/latest') : memoryStore.retrieve(scope);
      if (!state.server) saveBrowserMemory();
      if (!record) return notify('같은 지역·데이터 버전의 기억이 없습니다.');
      renderMemory(record); applyInput(record.constraints); notify('저장한 제약을 적용했습니다. 계산을 눌러 결과를 갱신하세요.');
    } catch (e) { notify(e.message); }
  }
  async function initStatus() {
    if (location.protocol === 'file:') { renderMemory(memoryStore.retrieve(scope)); saveBrowserMemory(); return; }
    try {
      const response = await fetch('/api/status', { signal: AbortSignal.timeout(2500) }); if (!response.ok) return;
      const config = await response.json(); if (config.app !== 'cool-sydney') return;
      state.server = true; state.config = config;
      $('runtime').innerHTML = '<i></i>로컬 API 연결';
      $('zetaris-status').textContent = config.zetaris.configured ? '설정됨 · 미검증' : '키 필요';
      $('nvidia-status').textContent = config.nvidia.configured ? '설정됨 · 미검증' : '키 필요';
      $('check-zetaris').disabled = !config.zetaris.configured;
      renderMemory(await api('/api/memory/latest'));
    } catch { $('runtime').innerHTML = '<i></i>브라우저 계산'; }
  }
  populateCandidates();
  $('scenario-form').addEventListener('submit', event => { event.preventDefault(); run(); });
  $('scenario-form').addEventListener('input', changed);
  $('reset').addEventListener('click', () => { stopPlay(); applyInput({}); run(); });
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { state.view = b.dataset.view; document.querySelectorAll('[data-view]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderMap(); }));
  document.querySelectorAll('[data-layer]').forEach(b => b.addEventListener('click', () => { state.layers[b.dataset.layer] = !state.layers[b.dataset.layer]; b.classList.toggle('active', state.layers[b.dataset.layer]); b.setAttribute('aria-pressed', String(state.layers[b.dataset.layer])); renderMap(); }));
  $('zoom-in').addEventListener('click', () => { state.zoom = Math.min(2, state.zoom + .2); renderMap(); });
  $('zoom-out').addEventListener('click', () => { state.zoom = Math.max(.8, state.zoom - .2); renderMap(); });
  $('zoom-reset').addEventListener('click', () => { state.zoom = 1; renderMap(); });
  const selectMap = event => {
    const demand = event.target.closest('[data-demand]'); if (demand) return showDemand(demand.dataset.demand);
    const pin = event.target.closest('[data-facility]'); if (!pin) return;
    const f = data.facilities.find(x => x.id === pin.dataset.facility);
    if (f.existing) return notify(`기존 허브: ${f.open}–${f.close}시 · 동시 수용 ${f.capacity}명 (합성 가정)`);
    const checkbox = document.querySelector(`[data-candidate="${f.id}"]`); checkbox.checked = !checkbox.checked; changed(); notify(`${f.short}: 검토 후보에서 ${checkbox.checked ? '포함' : '제외'}`);
  };
  $('city-map').addEventListener('click', selectMap);
  $('city-map').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMap(e); } });
  $('alternatives').addEventListener('click', e => { const b = e.target.closest('[data-alternative]'); if (!b) return; if (state.stale) return notify('설정이 변경됐습니다. 먼저 다시 계산하세요.'); state.selected = +b.dataset.alternative; state.route = null; renderResults(); $('map-detail').innerHTML = '<span class="detail-icon">⌖</span><div><strong>비교 배치를 지도에 적용했습니다.</strong><p>수요 점을 선택해 이 배치의 경로를 확인하세요.</p></div>'; });
  $('play').addEventListener('click', () => { if (state.timer) return stopPlay(); $('play').textContent = 'Ⅱ 재생 멈춤'; $('play').setAttribute('aria-pressed', 'true'); state.timer = setInterval(() => { let h = +$('hour').value + .25; if (h > 18) h = 8; $('hour').value = h; changed(); }, 600); });
  $('source-toggle').addEventListener('click', () => { const hidden = !$('sources').hidden; $('sources').hidden = hidden; $('source-toggle').setAttribute('aria-expanded', String(!hidden)); $('source-toggle').textContent = hidden ? '출처·계산 가정 보기 ↓' : '출처·계산 가정 닫기 ↑'; });
  $('remember').addEventListener('click', remember); $('restore-memory').addEventListener('click', restoreMemory);
  $('export').addEventListener('click', () => { if (!state.result || state.stale) return; const blob = new Blob([JSON.stringify({ ...state.result, viewedAlternative: state.selected }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `cool-sydney-${state.result.runId}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('입력·지표·경로·가정을 JSON으로 내보냈습니다.'); });
  $('check-zetaris').addEventListener('click', async () => { $('check-zetaris').disabled = true; try { const r = await api('/api/integrations/zetaris/check', {}); $('zetaris-status').textContent = r.connected ? 'SQL 연결 확인' : '연결 실패'; notify(r.message); } catch (e) { $('zetaris-status').textContent = '연결 실패'; notify(e.message); } finally { $('check-zetaris').disabled = false; } });
  $('explain').addEventListener('click', async () => { if (state.stale || !state.result) return; $('explain').disabled = true; const runId = state.result.runId; $('model-answer').hidden = false; $('model-answer').textContent = 'Nemotron이 검증된 수치와 가정을 바탕으로 설명을 생성하고 있습니다…'; try { const r = await api(`/api/runs/${runId}/explain`, {}); $('model-answer').textContent = `실행 ${runId} · NVIDIA Nemotron · AI 생성 설명 (수치 검증과 별개)\n\n${r.text}`; $('nvidia-status').textContent = '응답 확인'; } catch (e) { $('model-answer').textContent = e.message; $('nvidia-status').textContent = '호출 실패'; } finally { $('explain').disabled = state.stale; } });
  window.addEventListener('resize', renderMap);
  changed(); initStatus().then(run);
})();
