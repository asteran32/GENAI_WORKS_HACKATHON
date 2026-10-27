'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { createDataset } = require('./src/dataset');
const E = require('./src/engine');
const { createStore } = require('./src/memory');
const integrations = require('./integrations');
const { createGISStore } = require('./gis-store');
const { createCBDStore } = require('./cbd-store');
const { createMicroclimateStore } = require('./microclimate-store');
const { createLiveWeather } = require('./live-weather');
const { createZetarisGIS } = require('./zetaris-gis');
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
function atomicJSON(file, body) { const temp = `${file}.${randomUUID()}.tmp`; fs.writeFileSync(temp, JSON.stringify(body, null, 2), { mode: 0o600 }); fs.renameSync(temp, file); }
function createService({ directory, env = process.env, transport = fetch, weatherNow } = {}) {
  const data = createDataset(), root = directory || path.join(__dirname, '..', 'data', 'cool-sydney');
  for (const folder of ['runs', 'jobs', 'scenarios', 'processed']) fs.mkdirSync(path.join(root, folder), { recursive: true });
  const file = (folder, id) => path.join(root, folder, `${id}.json`);
  const validId = id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id);
  const read = (folder, id) => { if (!validId(id) || !fs.existsSync(file(folder, id))) throw new ApiError(404, '해당 기록을 찾을 수 없습니다.'); return JSON.parse(fs.readFileSync(file(folder, id), 'utf8')); };
  const write = (folder, id, body) => atomicJSON(file(folder, id), body);
  const memoryFile = path.join(root, 'memory.json');
  const memory = createStore(fs.existsSync(memoryFile) ? JSON.parse(fs.readFileSync(memoryFile, 'utf8')) : null);
  const persistMemory = () => atomicJSON(memoryFile, memory.state);
  const scope = { areaId: data.areaId, datasetVersion: data.version };
  const queue = [], workers = new Set(), explanations = new Map();
  const gis = createGISStore(root, { env, transport }), cbd = createCBDStore(root, { env, transport, gis }), microclimate = createMicroclimateStore(root), liveWeather = createLiveWeather({ transport, now: weatherNow }), zetarisGIS = createZetarisGIS(root, env, transport);
  let gisRunning = false;
  let running = false, closed = false;
  // Interrupted jobs must not remain stuck in a fake running state after restart.
  for (const name of fs.readdirSync(path.join(root, 'jobs')).filter(n => n.endsWith('.json'))) {
    const location = path.join(root, 'jobs', name), j = JSON.parse(fs.readFileSync(location, 'utf8'));
    if (j.status === 'queued' || j.status === 'running') atomicJSON(location, { ...j, status: 'failed', error: '서버 재시작으로 작업이 중단됐습니다. 다시 실행하세요.', finishedAt: new Date().toISOString() });
  }
  function pump() {
    if (closed || running || !queue.length) return;
    running = true;
    const item = queue.shift(), job = read('jobs', item.jobId); job.status = 'running'; job.startedAt = new Date().toISOString(); write('jobs', job.id, job);
    const worker = new Worker(path.join(__dirname, 'job-worker.js'), { workerData: { input: item.scenario.input }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    workers.add(worker);
    let finished = false;
    const finish = (error, result) => {
      if (finished) return; finished = true; clearTimeout(timer); workers.delete(worker); worker.terminate();
      try {
        if (error) { job.status = 'failed'; job.error = error; }
        else {
          const runId = randomUUID();
          const output = { ...result, runId, scenarioId: item.scenario.id, inputHash: item.scenario.inputHash, createdAt: new Date().toISOString() };
          write('runs', runId, output); job.status = 'succeeded'; job.runId = runId;
        }
        job.finishedAt = new Date().toISOString(); write('jobs', job.id, job);
      } catch { job.status = 'failed'; job.error = '실행 결과 저장에 실패했습니다.'; try { write('jobs', job.id, job); } catch { /* Storage error is also surfaced to the poller. */ } }
      running = false; pump();
    };
    const timer = setTimeout(() => finish('계산 시간이 30초를 초과했습니다.'), 30000);
    worker.once('message', message => finish(message.error, message.result));
    worker.once('error', () => finish('계산 워커에서 오류가 발생했습니다.'));
    worker.once('exit', code => { if (!finished) finish(`계산 워커가 결과 없이 종료됐습니다 (${code}).`); });
  }
  async function dispatch(method, route, body, searchParams = new URLSearchParams()) {
    if (closed) throw new ApiError(503, '서버가 종료 중입니다.');
    if (method === 'GET' && route === '/api/status') return { app: 'cool-sydney', solverVersion: 'gis-shade-0.3', gis: gis.metadata(), cbd: cbd.metadata(), microclimate: microclimate.metadata(), ...integrations.configuration(env) };
    if (method === 'GET' && route === '/api/weather/current') {
      try { return await liveWeather.get(); }
      catch (error) { throw new ApiError(502, `현재 기상 정보를 가져오지 못했습니다: ${error.message}`); }
    }
    if (route.startsWith('/api/gis/')) {
      try {
        if (method === 'GET' && route === '/api/gis/status') return gis.metadata();
        if (method === 'GET' && route === '/api/gis/data') return await gis.get();
        if (method === 'GET' && route === '/api/gis/microclimate/metadata') return microclimate.metadata();
        if (method === 'GET' && route === '/api/gis/microclimate') {
          const hourText = searchParams.get('hour');
          const hour = hourText === null || hourText.trim() === '' ? NaN : Number(hourText);
          try { return microclimate.at(searchParams.get('date'), hour); }
          catch (error) { if (error instanceof RangeError) throw new ApiError(422, error.message); throw error; }
        }
        if (method === 'POST' && route === '/api/gis/import') { await gis.load(); return gis.metadata(); }
        if (method === 'GET' && route === '/api/gis/datasets') {
          const state = cbd.metadata();
          if (!state.ready) return { ...state, components:{ buildings:gis.metadata().ready ? { ready:true, version:gis.metadata().version } : { ready:false }, walk_graph:{ready:false}, trees:{ready:false}, pedestrian_counts:{ready:false}, weather:{ready:false} } };
          const { manifest } = await cbd.get();
          return { ...state, bundle_version:manifest.bundle_version, date:manifest.date, components:Object.fromEntries(Object.entries(manifest.components).map(([key,version])=>[key,{ready:!!version,version}])), sources:manifest.sources, quality:manifest.quality, files:manifest.files, validation_status:manifest.validation_status };
        }
        if (method === 'POST' && route === '/api/gis/cbd/import') {
          if (!gis.metadata().ready) throw new ApiError(422,'건물 GIS 자료를 먼저 가져오세요.');
          try { require('./cbd-store').dateWindow(body?.date); } catch(error) { throw new ApiError(422,error.message); }
          await cbd.load(body?.date); return await dispatch('GET','/api/gis/datasets');
        }
        if (method === 'GET' && route === '/api/gis/layers') {
          const { manifest, tables } = await cbd.get();
          return { bundle_version:manifest.bundle_version, area:require('./city-data').AREA, walk_edges:tables.walk_edges.map(e=>({ id:e.id, quality:e.quality, geometry:e.geometry })), trees:tables.trees, pedestrian_sites:tables.pedestrian_sites };
        }
        if (method === 'GET' && route === '/api/gis/observations') {
          const instant=searchParams.get('instant'), time=new Date(instant);
          if (!instant || !Number.isFinite(+time) || time.toISOString()!==instant) throw new ApiError(422,'유효한 UTC ISO 시각이 필요합니다.');
          const { manifest, tables }=await cbd.get(), hour=time.toISOString().slice(0,13);
          const day=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(time).map(p=>[p.type,p.value]));
          if (`${day.year}-${day.month}-${day.day}`!==manifest.date) throw new ApiError(422,'묶음 날짜의 시각을 조회하세요.');
          const counts=tables.pedestrian_counts.filter(c=>c.instant_utc.startsWith(hour)).map(c=>({ ...c, passages:c.quality==='known-undercount'?null:c.passages }));
          const weather=tables.weather.find(w=>w.instant_utc.startsWith(hour))||null;
          return { bundle_version:manifest.bundle_version, instant_utc:time.toISOString(), date:manifest.date, counts, weather, sites:tables.pedestrian_sites, limitations:['자동 계수는 2025년 6월에 종료됐습니다. 관측이 없는 구간은 수치를 추정하지 않습니다.','기상은 격자 재분석 자료이며 거리 수준의 실측이 아닙니다.'] };
        }
        if (method === 'POST' && route === '/api/gis/routes') {
          const { validateInput }=require('./cbd-route'), bundle=await cbd.get(), map=await gis.get();
          try { validateInput(body,bundle.manifest.date); } catch(error) { throw new ApiError(422,error.message); }
          const result=await new Promise((resolve,reject)=>{
            const worker=new Worker(path.join(__dirname,'cbd-worker.js'),{workerData:{gis:map,cbd:bundle,input:body},resourceLimits:{maxOldGenerationSizeMb:384}});
            workers.add(worker); let done=false;
            const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);workers.delete(worker);worker.terminate();error?reject(new ApiError(422,error)):resolve(value);};
            const timer=setTimeout(()=>finish('경로 계산이 30초를 초과했습니다.'),30000);
            worker.once('message',message=>finish(message.error,message.result)); worker.once('error',()=>finish('경로 워커 오류입니다.'));
            worker.once('exit',()=>{if(!done)finish('경로 워커가 결과 없이 종료됐습니다.');});
          });
          const run={...result,runId:randomUUID(),dataKind:'cbd-walking-shade-scenario',createdAt:new Date().toISOString()};
          write('runs',run.runId,run); return run;
        }
        if (method === 'GET' && route === '/api/gis/zetaris/plan') return zetarisGIS.plan(await gis.get());
        if (method === 'POST' && route === '/api/gis/zetaris/register') return await zetarisGIS.register(await gis.get());
        if (method === 'GET' && route === '/api/gis/zetaris/summary') return await zetarisGIS.summary(await gis.get());
        if (method === 'GET' && route === '/api/gis/memory') { const info = await gis.get(), record = memory.retrieve({ areaId: info.area.id, datasetVersion: info.version }); persistMemory(); return record; }
        if (method === 'POST' && route === '/api/gis/memory') {
          const info = await gis.get(), constraints = require('./gis-shadow').validateInput(body);
          const record = memory.save({ scope: { areaId: info.area.id, datasetVersion: info.version }, constraints, source: { type: 'user-form', id: 'gis-dashboard' } }); persistMemory(); return record;
        }
        if (method === 'POST' && route === '/api/gis/shadow') {
          if (gisRunning) throw new ApiError(429, '그림자를 계산 중입니다. 잠시 후 다시 실행하세요.');
          const input = require('./gis-shadow').validateInput(body), snapshot = await gis.get();
          if (gisRunning) throw new ApiError(429, '그림자를 계산 중입니다.');
          gisRunning = true;
          try {
            const result = await new Promise((resolve, reject) => {
              const worker = new Worker(path.join(__dirname, 'gis-worker.js'), { workerData: { snapshot, input }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
              workers.add(worker); let done = false;
              const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); workers.delete(worker); worker.terminate(); error ? reject(new Error(error)) : resolve(value); };
              const timer = setTimeout(() => finish('그림자 계산이 30초를 초과했습니다.'), 30000);
              worker.once('message', message => finish(message.error, message.result));
              worker.once('error', () => finish('GIS 계산 워커 오류입니다.'));
              worker.once('exit', () => { if (!done) finish('GIS 워커가 결과 없이 종료됐습니다.'); });
            });
            const run = { ...result, runId: randomUUID(), source: snapshot.readSource, dataKind: snapshot.dataKind };
            write('runs', run.runId, run); return run;
          } finally { gisRunning = false; }
        }
        const explainMatch = route.match(/^\/api\/gis\/runs\/([^/]+)\/explain$/);
        if (method === 'POST' && explainMatch) {
          const run = read('runs', explainMatch[1]);
          if (run.dataKind !== 'real-gis-vector-tiles') throw new ApiError(422, '실제 GIS 실행 기록이 아닙니다.');
          if (run.explanation) return run.explanation;
          if (explanations.has(run.runId)) return await explanations.get(run.runId);
          if (!integrations.configuration(env).nvidia.configured) throw new ApiError(503, 'MODEL_API_KEY와 MODEL_BASE_URL 설정이 필요합니다.');
          if ((run.modelAttempts || 0) >= 4) throw new ApiError(429, '이 실행의 AI 요청 한도에 도달했습니다.');
          run.modelAttempts = (run.modelAttempts || 0) + 1; write('runs', run.runId, run);
          const task = (async () => { const answer = await integrations.explainGIS(run, env, transport); run.explanation = answer; write('runs', run.runId, run); return answer; })();
          explanations.set(run.runId, task);
          try { return await task; } finally { explanations.delete(run.runId); }
        }
      } catch (e) { throw e instanceof ApiError ? e : new ApiError(502, e.message); }
    }
    if (method === 'GET' && route === '/api/assets/dataset') return data;
    if (method === 'POST' && route === '/api/scenarios') {
      let input; try { input = E.validateInput(data, body); } catch (e) { throw new ApiError(422, e.message); }
      const id = randomUUID(), inputHash = createHash('sha256').update(JSON.stringify({ version: data.version, solver: E.VERSION, input })).digest('hex');
      const scenario = { id, input, inputHash, datasetVersion: data.version, createdAt: new Date().toISOString() };
      write('scenarios', id, scenario); return scenario;
    }
    let match;
    if (method === 'POST' && (match = route.match(/^\/api\/scenarios\/([^/]+)\/runs$/))) {
      if (queue.length >= 8) throw new ApiError(429, '대기 작업이 많습니다. 잠시 후 다시 시도하세요.');
      const scenario = read('scenarios', match[1]), id = randomUUID(), job = { id, scenarioId: scenario.id, status: 'queued', createdAt: new Date().toISOString() };
      write('jobs', id, job); queue.push({ jobId: id, scenario }); setImmediate(pump); return job;
    }
    if (method === 'GET' && (match = route.match(/^\/api\/jobs\/([^/]+)$/))) return read('jobs', match[1]);
    if (method === 'GET' && (match = route.match(/^\/api\/runs\/([^/]+)$/))) return read('runs', match[1]);
    if (method === 'GET' && route === '/api/memory/latest') { const record = memory.retrieve(scope); persistMemory(); return record; }
    if (method === 'POST' && route === '/api/memory') {
      let constraints; try { constraints = E.validateInput(data, body?.constraints); } catch (e) { throw new ApiError(422, e.message); }
      const record = memory.save({ scope, constraints, source: { type: 'user-form', id: 'local-api' } }); persistMemory(); return record;
    }
    if (method === 'POST' && route === '/api/integrations/zetaris/check') {
      try { return await integrations.checkZetaris(env, transport); } catch (e) { throw new ApiError(502, e.message); }
    }
    if (method === 'GET' && route === '/api/integrations/zetaris/facilities') {
      try { return await integrations.facilityEvidence(env, transport); } catch (e) { throw new ApiError(502, e.message); }
    }
    if (method === 'POST' && (match = route.match(/^\/api\/runs\/([^/]+)\/explain$/))) {
      const run = read('runs', match[1]), existing = run.explanation;
      if (existing) return existing;
      if (explanations.has(run.runId)) return explanations.get(run.runId);
      // Count failed requests too: maximum four attempts per run, no automatic retries.
      if ((run.modelAttempts || 0) >= 4) throw new ApiError(429, '실행당 모델 호출 한도 4회를 사용했습니다.');
      if (!integrations.configuration(env).nvidia.configured) throw new ApiError(503, 'MODEL_API_KEY와 MODEL_BASE_URL 설정이 필요합니다.');
      run.modelAttempts = (run.modelAttempts || 0) + 1; write('runs', run.runId, run);
      const task = (async () => {
        try {
          const recalled = memory.retrieve(scope); persistMemory();
          const answer = await integrations.explainRun(run, recalled, env, transport);
          run.explanation = answer; run.modelUsage = { calls: run.modelAttempts, mode: 'nvidia-explanation', usage: answer.usage }; write('runs', run.runId, run); return answer;
        } catch (e) { throw new ApiError(502, e.message); }
      })();
      explanations.set(run.runId, task);
      try { return await task; } finally { explanations.delete(run.runId); }
    }
    throw new ApiError(404, 'API 경로를 찾을 수 없습니다.');
  }
  return { dispatch, root, close() { closed = true; for (const worker of workers) worker.terminate(); } };
}
module.exports = { createService, ApiError };
