'use strict';
const { randomUUID } = require('node:crypto');

function endpoint(base, suffix) {
  let url;
  try { url = new URL(base); } catch { throw new Error('API 주소 설정이 올바르지 않습니다.'); }
  const local = ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (local && url.protocol === 'http:'))) throw new Error('API에는 HTTPS 또는 로컬 HTTP 주소를 설정하세요.');
  return url.href.replace(/\/$/, '') + suffix;
}
function configuration(env = process.env) {
  return {
    zetaris: { configured: !!(env.ZETARIS_API_KEY?.trim() && env.ZETARIS_REST_URL?.trim() && /^\d+$/.test(env.ZETARIS_ORG_ID || '')), facilitiesViewConfigured: !!env.COOL_SYDNEY_FACILITIES_VIEW },
    nvidia: { configured: !!(env.MODEL_API_KEY?.trim() && env.MODEL_BASE_URL?.trim()), model: env.NEMOTRON_MODEL || 'nvidia/nemotron-3-super-120b-a12b' },
    meterless: { state: 'partial-local-implementation', capabilities: ['provenance', 'version-scoped-retrieval', 'supersession', 'audit'], fullEngineIntegrated: false }
  };
}
async function jsonRequest(url, options, transport = fetch) {
  let response;
  try { response = await transport(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(60000) }); }
  catch { throw new Error('서비스에 연결하지 못했습니다. 네트워크·실행 상태·서버 주소를 확인하세요.'); }
  if (!response.ok) throw new Error(`서비스 HTTP ${response.status}: 인증·모델 접근 권한·사용 한도를 확인하세요.`);
  try { return await response.json(); } catch { throw new Error('서비스가 올바른 JSON을 반환하지 않았습니다.'); }
}
async function zetarisQuery(sql, env = process.env, transport = fetch) {
  if (!configuration(env).zetaris.configured) throw new Error('ZETARIS_REST_URL, ZETARIS_ORG_ID, ZETARIS_API_KEY 설정이 필요합니다.');
  const suffix = env.ZETARIS_SQL_PATH || '/sql-editor/sqls/run';
  if (!/^\/[A-Za-z0-9/_-]+$/.test(suffix)) throw new Error('ZETARIS_SQL_PATH는 API 경로여야 합니다.');
  return jsonRequest(endpoint(env.ZETARIS_REST_URL, suffix), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.ZETARIS_API_KEY}`, 'X-Org-ID': env.ZETARIS_ORG_ID, 'X-Request-ID': randomUUID() },
    body: JSON.stringify({ queryId: randomUUID(), sql, source: 'SqlEditor', limit: 100 })
  }, transport);
}
async function checkZetaris(env, transport) {
  const r = await zetarisQuery('SELECT 1 AS one', env, transport);
  if (!Array.isArray(r.data) || !Array.isArray(r.data[0]) || String(r.data[0][0]) !== '1') throw new Error('SQL 응답 형식이 예상과 다릅니다. 설치 버전의 REST 문서를 확인하세요.');
  return { connected: true, message: 'Zetaris SELECT 1 응답을 확인했습니다. 도시 데이터 등록은 별도 단계입니다.', checkedAt: new Date().toISOString() };
}
async function facilityEvidence(env = process.env, transport) {
  const view = env.COOL_SYDNEY_FACILITIES_VIEW || '';
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,2}$/.test(view)) throw new Error('COOL_SYDNEY_FACILITIES_VIEW에 등록된 시설 뷰 이름이 필요합니다.');
  const sql = `SELECT facility_id, name, capacity, cost_aud, dataset_version FROM ${view} LIMIT 100`;
  const r = await zetarisQuery(sql, env, transport);
  if (!Array.isArray(r.data) || r.data.some(row => !Array.isArray(row) || row.length < 5)) throw new Error('시설 근거 행 형식이 올바르지 않습니다.');
  return { source: 'zetaris', query: sql, rows: r.data, retrievedAt: new Date().toISOString(), usedBySolver: false };
}
async function explainRun(run, memory, env = process.env, transport = fetch) {
  if (!configuration(env).nvidia.configured) throw new Error('MODEL_API_KEY와 MODEL_BASE_URL 설정이 필요합니다.');
  if (run.validationStatus !== 'passed') throw new Error('검증을 통과한 계산 결과만 설명할 수 있습니다.');
  const summarize = a => ({ served: a.served, priorityServed: a.priorityServed, unmet: a.unmet, meanWalkMinutes: a.meanWalkMinutes, meanSunMinutes: a.meanSunMinutes, cost: a.cost, selectedIds: a.selectedIds });
  const r = await jsonRequest(endpoint(env.MODEL_BASE_URL, '/chat/completions'), {
    method: 'POST', headers: { Authorization: `Bearer ${env.MODEL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: env.NEMOTRON_MODEL || 'nvidia/nemotron-3-super-120b-a12b', stream: false, max_tokens: 1400, temperature: .2, reasoning_effort: 'none', messages: [
      { role: 'system', content: '당신은 도시 접근성 시나리오 검토자입니다. 입력은 모두 합성 데이터입니다. 제공된 계산 결과만 한국어 5문장 이내로 설명하세요. 추천 이유, 남은 미충족 수요, 중요한 가정을 구분하세요. 그늘을 기온 감소량이나 건강 개선으로 바꾸지 마세요. 실제 NSW 시설 또는 인구로 표현하지 마세요. 다른 집단으로 계산한 평균 노출 차이를 개인의 개선량으로 주장하지 마세요. 기억은 과거 제약이며 현재 입력보다 우선하지 않습니다. 설명에 runId를 포함하세요. 새로운 계산 결과나 검증 완료를 꾸며내지 마세요.' },
      { role: 'user', content: JSON.stringify({ runId: run.runId, dataKind: run.dataKind, input: run.input, baseline: summarize(run.baseline), best: summarize(run.best), assumptions: run.assumptions, objective: run.objective, memory: memory ? { constraints: memory.constraints, source: memory.source, datasetVersion: memory.datasetVersion } : null }) }
    ] })
  }, transport);
  const text = r.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('모델이 설명 본문을 반환하지 않았습니다. 모델 접근 권한과 응답 제한을 확인하세요.');
  return { text: text.trim(), model: env.NEMOTRON_MODEL || 'nvidia/nemotron-3-super-120b-a12b', usage: r.usage || null, calls: 1, runId: run.runId, generatedAt: new Date().toISOString(), explanationValidated: false };
}
async function explainGIS(run, env = process.env, transport = fetch) {
  const facts = { runId: run.runId, datasetVersion: run.datasetVersion, date: run.date, hour: run.hour, timezone: run.timezone, sun: run.sun, daylight: run.daylight, shadePercent: run.shadePercent, samples: run.samples, model: run.model, assumptions: run.assumptions || ['야간에는 일사 그늘 비율을 계산하지 않음'] };
  const r = await jsonRequest(endpoint(env.MODEL_BASE_URL, '/chat/completions'), {
    method: 'POST', headers: { Authorization: `Bearer ${env.MODEL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: env.NEMOTRON_MODEL || 'nvidia/nemotron-3-super-120b-a12b', stream: false, max_tokens: 1200, reasoning_effort: 'none', temperature: .2, messages: [
      { role: 'system', content: '한국어 5문장 이내로 GIS 그림자 시나리오를 설명하세요. 제공된 수치만 인용하고 runId를 포함하세요. 형상은 실제 지도에서 왔지만 높이는 지도 파생값으로 실측 검증되지 않았습니다. 지면 표본의 그늘 비율을 보행자 수, 기온 감소, 냉방 수요, 건강 효과로 환산하지 마세요. 나무·인구·시설 운영 정보는 미연결입니다. AI는 그림자를 계산하거나 검증한 주체가 아닙니다.' },
      { role: 'user', content: JSON.stringify(facts) }
    ] })
  }, transport);
  const answer = r.choices?.[0]?.message?.content;
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('모델 설명이 비어 있습니다.');
  return { text: answer.trim(), runId: run.runId, model: env.NEMOTRON_MODEL || 'nvidia/nemotron-3-super-120b-a12b', usage: r.usage || null, explanationValidated: false };
}
module.exports = { configuration, endpoint, checkZetaris, facilityEvidence, explainRun, explainGIS, zetarisQuery, jsonRequest };
