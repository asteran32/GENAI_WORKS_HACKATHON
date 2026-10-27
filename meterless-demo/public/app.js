const $ = id => document.getElementById(id);
const state = { memories: [], history: [], results: [], selected: null, expected: null, view: 'list', query: '', mode: 'ranked', searched: false, busy: false };
const actions = { create: '기억 생성', read: '기억 조회', update: '조건 변경', feedback: '피드백', promote: '기억 승격', demote: '기억 이동', delete: '기억 삭제', restore: '기억 복원' };
const labels = { content: '조건', source: '출처', confidence: '신뢰도', tags: '태그' };
const date = stamp => new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(stamp);
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
let toastTimer;

function notice(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500); }
function connection(online) { $('connection').className = `connection ${online ? 'online' : 'offline'}`; $('connection').lastElementChild.textContent = online ? '로컬 연결됨' : '서버 연결 확인'; }
async function api(route, options) {
  let response;
  try { response = await fetch(route, { ...options, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(12000) }); }
  catch { connection(false); throw new Error('로컬 서버에 연결할 수 없어요. 서버가 실행 중인지 확인한 후 새로고침하세요.'); }
  let body;
  try { body = await response.json(); } catch { throw new Error('서버 응답을 읽을 수 없어요. 새로고침 후 다시 시도하세요.'); }
  if (!response.ok) throw new Error(body.error || '요청을 처리하지 못했습니다.');
  connection(true);
  return body;
}
function lock(value) { document.querySelectorAll('#notebook-screen button').forEach(button => { button.disabled = value; }); document.querySelector('main').setAttribute('aria-busy', String(value)); }
async function run(action) {
  if (state.busy) return;
  state.busy = true; lock(true); $('error').hidden = true;
  try { await action(); }
  catch (error) { $('error').textContent = error.message; $('error').hidden = false; }
  finally { state.busy = false; lock(false); }
}
async function refresh() {
  const [data, history] = await Promise.all([api('/api/memories'), api('/api/history')]);
  state.memories = data.memories; state.history = history.entries;
  $('memory-count').textContent = String(state.memories.length);
  renderItems();
}
function setView(view) {
  state.view = view;
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  renderItems();
}
function empty(title, text) { const node = el('div', 'empty'); node.append(el('strong', '', title), el('span', '', text)); return node; }
function memoryCard(memory, relevance) {
  const card = el('button', `memory-card${state.selected === memory.id ? ' selected' : ''}`);
  card.type = 'button'; card.setAttribute('aria-pressed', String(state.selected === memory.id));
  const top = el('div', 'card-top'); top.append(el('span', 'memory-id', memory.id.toUpperCase()), el('span', 'card-date', date(memory.timestamp)));
  const bottom = el('div', 'card-bottom'); bottom.append(el('span', 'card-source', `↳ ${memory.source}`));
  bottom.append(relevance !== undefined ? el('span', 'score', relevance === null ? '원문 일치' : `관련도 ${relevance.toFixed(2)}`) : el('span', 'badge', `신뢰도 ${Math.round(memory.confidence * 100)}%`));
  card.append(top, el('p', 'memory-content', memory.content), bottom);
  card.addEventListener('click', () => { if (!state.busy) selectMemory(state.memories.find(item => item.id === memory.id) || memory); });
  return card;
}
function timeline(entries) {
  const list = el('ol', 'timeline');
  for (const entry of entries) {
    const item = el('li', 'event');
    const head = el('div', 'event-head'), time = el('time', '', date(entry.timestamp)); time.dateTime = new Date(entry.timestamp).toISOString();
    head.append(el('span', 'event-action', actions[entry.action] || entry.action), time);
    item.append(head, el('p', 'event-meta', `${entry.memoryId} · ${entry.actor}`));
    if (entry.action === 'update' && entry.previousState && entry.newState) {
      for (const [key, label] of Object.entries(labels)) {
        if (JSON.stringify(entry.previousState[key]) === JSON.stringify(entry.newState[key])) continue;
        const diff = el('div', 'diff');
        const format = value => Array.isArray(value) ? value.join(', ') || '없음' : String(value ?? '없음');
        diff.append(el('p', 'before', `이전 ${label} · ${format(entry.previousState[key])}`), el('p', 'after', `변경 ${label} · ${format(entry.newState[key])}`));
        item.append(diff);
      }
    } else if (entry.action === 'create' && entry.newState) item.append(el('p', 'event-detail', entry.newState.content));
    if (entry.details?.query) item.append(el('p', 'event-detail', `검색어 · ${entry.details.query}`));
    list.append(item);
  }
  return list;
}
function renderItems() {
  const target = $('items'); target.replaceChildren();
  if (state.view === 'history') {
    $('view-description').textContent = `생성·조회·변경 ${state.history.length}건 · 최근 활동부터 표시`;
    if (!state.history.length) target.append(empty('아직 이력이 없어요.', '첫 조건을 저장하면 이력이 시작됩니다.'));
    else { const card = el('div', 'history-card'); card.append(timeline(state.history)); target.append(card); }
  } else if (state.view === 'search') {
    $('view-description').textContent = state.searched ? `“${state.query}” · ${state.results.length}건 · ${state.mode === 'literal' ? '원문 포함 검색' : 'H-MEM 순위 검색'}` : '위 검색창에서 기억을 찾아보세요.';
    if (!state.searched) target.append(empty('어떤 기억을 찾을까요?', '조건의 핵심 단어를 검색해보세요.'));
    else if (!state.results.length) target.append(empty('검색 결과가 없어요.', '다른 키워드나 원문 포함 검색을 사용해보세요.'));
    else for (const result of state.results) target.append(memoryCard(result.memory, result.relevance));
  } else {
    $('view-description').textContent = `${state.memories.length}개의 기억 · 최근 생성 순서`;
    if (!state.memories.length) target.append(empty('첫 번째 조건을 남겨보세요.', '저장한 조건은 다음에 다시 열어볼 수 있어요.'));
    else for (const memory of state.memories) target.append(memoryCard(memory));
  }
}
function selectMemory(memory) {
  state.selected = memory?.id ?? null;
  state.expected = memory ? JSON.stringify(memory) : null;
  $('detail-eyebrow').textContent = memory ? `MEMORY / ${memory.id.toUpperCase()}` : 'CAPTURE SOMETHING';
  $('detail-title').textContent = memory ? '기억 살펴보기' : '새로운 조건';
  $('content').value = memory?.content ?? '';
  $('source').value = memory?.source ?? '사용자 직접 입력';
  $('confidence').value = String(memory?.confidence ?? 0.7);
  $('tags').value = memory?.tags.join(', ') ?? '';
  $('detail-meta').textContent = memory ? `${memory.id} · ${date(memory.timestamp)} 생성 · ${memory.accessCount}회 검색됨` : '조건과 출처를 함께 남기세요.';
  $('save-memory').replaceChildren(document.createTextNode(memory ? '변경 저장' : '조건 저장'), el('span', '', memory ? '↗' : '＋'));
  const entries = memory ? state.history.filter(entry => entry.memoryId === memory.id) : [];
  $('audit-count').textContent = `${entries.length}건`;
  $('audit-items').replaceChildren(entries.length ? timeline(entries) : el('p', 'muted', '기억을 선택하면 생성·조회·변경 이력이 보여요.'));
  renderItems();
}
async function search() {
  const query = $('query').value.trim(), mode = $('search-mode').value;
  const data = await api('/api/search', { method: 'POST', body: JSON.stringify({ query, mode }) });
  state.results = data.results; state.query = query; state.mode = mode; state.searched = true;
  await refresh(); setView('search');
  if (state.selected) selectMemory(state.memories.find(memory => memory.id === state.selected));
}
$('search-form').addEventListener('submit', event => { event.preventDefault(); run(search); });
$('search-mode').addEventListener('change', () => { $('search-hint').textContent = $('search-mode').value === 'literal' ? '원문에 입력한 문구가 포함된 기억을 찾아요.' : '순위 검색은 영문 키워드를 사용해요.'; });
$('example-query').addEventListener('click', () => { $('query').value = 'accessibility constraints'; $('search-mode').value = 'ranked'; $('search-mode').dispatchEvent(new Event('change')); run(search); });
$('memory-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const selected = state.selected;
    const body = { content: $('content').value.trim(), source: $('source').value.trim(), confidence: Number($('confidence').value), tags: $('tags').value.split(',').map(tag => tag.trim()).filter(Boolean), expected: state.expected };
    const data = await api(selected ? `/api/memories/${selected}` : '/api/memories', { method: selected ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    state.results = []; state.searched = false;
    await refresh(); setView('list'); selectMemory(data.memory);
    notice(selected ? '변경 내용과 이전 값을 이력에 남겼어요.' : '새로운 조건을 기억했어요.');
  });
});
$('new-memory').addEventListener('click', () => { selectMemory(null); $('content').focus(); });
$('reload').addEventListener('click', () => run(async () => { await refresh(); state.results = []; state.searched = false; selectMemory(state.memories.find(memory => memory.id === state.selected) ?? null); notice('최신 기억을 불러왔어요.'); }));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
run(async () => { await refresh(); if (state.memories.length) selectMemory(state.memories[0]); });
function showScreen(monitor) {
  $('monitor-screen').hidden=!monitor;$('notebook-screen').hidden=monitor;
  $('show-monitor').setAttribute('aria-pressed',String(monitor));$('show-notebook').setAttribute('aria-pressed',String(!monitor));
  if(!monitor)run(refresh);
}
$('show-monitor').addEventListener('click',()=>showScreen(true));
$('show-notebook').addEventListener('click',()=>showScreen(false));
