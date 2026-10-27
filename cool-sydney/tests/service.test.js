'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createService } = require('../service');
const { createHandler } = require('../server');
const { createStore } = require('../src/memory');
const I = require('../integrations');

test('memory keeps provenance, supersession and reads within the same area and dataset version', () => {
  const store = createStore(), scope = { areaId: 'a', datasetVersion: 'v1' }, source = { type: 'user-form', id: 'test' };
  assert.throws(() => store.save({ scope, constraints: {} }));
  const first = store.save({ scope, source, constraints: { budget: 10000 } });
  const second = store.save({ scope, source, constraints: { budget: 8000 } });
  assert.equal(second.supersedes, first.id); assert.equal(first.supersededBy, second.id);
  assert.equal(store.retrieve({ ...scope, datasetVersion: 'v2' }), null);
  assert.equal(store.retrieve({ ...scope, areaId: 'b' }), null);
  assert.equal(store.retrieve(scope).constraints.budget, 8000);
  assert.deepEqual(store.state.ledger.map(x => x.action), ['create', 'supersede', 'create', 'read']);
});
test('Zetaris adapter authenticates server-side and never reports success for unexpected data', async () => {
  const env = { ZETARIS_API_KEY: 'test-private-key', ZETARIS_REST_URL: 'http://localhost:8888/api/v1.0', ZETARIS_ORG_ID: '1' };
  let call;
  const result = await I.checkZetaris(env, async (url, options) => { call = { url, options }; return { ok: true, json: async () => ({ data: [[1]] }) }; });
  assert.equal(result.connected, true); assert.equal(call.url, 'http://localhost:8888/api/v1.0/sql-editor/sqls/run');
  assert.equal(call.options.headers.Authorization, 'Bearer test-private-key'); assert.equal(JSON.parse(call.options.body).sql, 'SELECT 1 AS one');
  await assert.rejects(I.checkZetaris(env, async () => ({ ok: true, json: async () => ({ data: 'unexpected' }) })), /응답 형식/);
  await assert.rejects(I.checkZetaris({}, async () => { throw Error('must not call'); }), /설정/);
  assert.ok(!JSON.stringify(I.configuration(env)).includes('test-private-key'));
});
test('NVIDIA adapter uses supplied facts, limits tokens, disables streaming and sanitizes failures', async () => {
  const env = { MODEL_API_KEY: 'private-model-key', MODEL_BASE_URL: 'https://integrate.api.nvidia.com/v1' };
  const a = { served: 4, priorityServed: 2, unmet: 3, selectedIds: [], cost: 0 };
  const run = { runId: 'test', validationStatus: 'passed', dataKind: 'synthetic', baseline: a, best: a, assumptions: [] };
  let input;
  const result = await I.explainRun(run, null, env, async (_, options) => { input = JSON.parse(options.body); return { ok: true, json: async () => ({ choices: [{ message: { content: '합성 시나리오의 결과입니다.' } }], usage: { total_tokens: 42 } }) }; });
  assert.equal(input.stream, false); assert.equal(input.max_tokens, 1400); assert.equal(result.calls, 1); assert.equal(result.usage.total_tokens, 42);
  assert.ok(!JSON.stringify(input).includes('private-model-key'));
  await assert.rejects(I.explainRun(run, null, env, async () => { throw Error('private-model-key leaked upstream'); }), error => !error.message.includes('private-model-key'));
  await assert.rejects(I.explainRun(run, null, env, async () => ({ ok: true, json: async () => ({ choices: [] }) })), /설명 본문/);
});
test('API runs real worker calculation, persists snapshots and retrieves constraints after restart', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cool-sydney-test-'));
  let service = createService({ directory, env: {} });
  t.after(() => { service.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const scenario = await service.dispatch('POST', '/api/scenarios', { budget: 18000, maxFacilities: 1 });
  assert.equal(scenario.inputHash.length, 64);
  const job = await service.dispatch('POST', `/api/scenarios/${scenario.id}/runs`, {});
  let status;
  for (let i = 0; i < 150; i++) { status = await service.dispatch('GET', `/api/jobs/${job.id}`); if (status.status === 'succeeded' || status.status === 'failed') break; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.equal(status.status, 'succeeded');
  const run = await service.dispatch('GET', `/api/runs/${status.runId}`);
  assert.equal(run.validationStatus, 'passed'); assert.ok(run.best.cost <= 18000);
  await service.dispatch('POST', '/api/memory', { constraints: { budget: 8000 } });
  service.close(); service = createService({ directory, env: {} });
  assert.equal((await service.dispatch('GET', '/api/memory/latest')).constraints.budget, 8000);
  assert.equal((await service.dispatch('GET', `/api/runs/${run.runId}`)).inputHash, run.inputHash);
  await assert.rejects(service.dispatch('GET', '/api/runs/../../.env'), e => e.status === 404);
  await assert.rejects(service.dispatch('POST', '/api/scenarios', { budget: -5 }), e => e.status === 422);
  await assert.rejects(service.dispatch('POST', `/api/runs/${run.runId}/explain`, {}), e => e.status === 503);
});
test('HTTP boundary serves only public assets, rejects foreign origins/hosts and oversized input', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cool-sydney-http-'));
  const service = createService({ directory, env: {} }), handler = createHandler(service, 8765);
  t.after(() => { service.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  async function request(url, options = {}) {
    const req = Readable.from(options.body ? [Buffer.from(options.body)] : []);
    Object.assign(req, { url, method: options.method || 'GET', headers: { host: '127.0.0.1:8765', ...options.headers } });
    const result = {}, res = { headersSent: false, writeHead(status, headers) { this.headersSent = true; result.status = status; result.headers = headers; }, end(body) { result.body = body?.toString() || ''; } };
    await handler(req, res); return result;
  }
  const page = await request('/'); assert.equal(page.status, 200); assert.match(page.body, /COOLSYDNEY|COOL<span/);
  require('../build').build();
  const deck = await request('/deck'); assert.equal(deck.status, 200); assert.match(deck.body, /submission deck/i);
  const planView = await request('/agent-plan-view.mjs'); assert.equal(planView.status,200); assert.match(planView.headers['Content-Type'],/javascript/); assert.match(planView.body,/export function planMarkers/);
  const status = await request('/api/status'); assert.equal(status.status, 200); assert.equal(JSON.parse(status.body).app, 'cool-sydney');
  assert.equal((await request('/.env')).status, 404);
  assert.equal((await request('/api/status', { headers: { host: 'evil.example:8765' } })).status, 403);
  assert.equal((await request('/api/status', { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('/api/scenarios', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await request('/api/scenarios', { method: 'POST', body: '{', headers: { 'content-type': 'application/json' } })).status, 400);
  assert.equal((await request('/api/scenarios', { method: 'POST', body: ' '.repeat(17000), headers: { 'content-type': 'application/json' } })).status, 413);
});
