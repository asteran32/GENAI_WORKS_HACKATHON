'use strict';
const { spawn } = require('node:child_process');
const { endpoint } = require('./integrations');
async function request(url, body, transport, signal) {
  let response;
  try { response = await transport(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), redirect:'error', signal:AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(10000)]) }); }
  catch { throw new Error('Meterless 8766 서비스에 연결할 수 없습니다.'); }
  if (!response.ok) throw new Error(`Meterless HTTP ${response.status}`);
  return response.json();
}
function memoryScope(catalog) { return `[cool-sydney:${catalog.area.id}]`; }
function scopedMemories(memories, catalog) {
  return memories.filter(m=>typeof m?.content==='string' && m.content.startsWith(memoryScope(catalog)))
    .sort((a,b)=>Number(b.timestamp || 0)-Number(a.timestamp || 0)).slice(0,12)
    .map(m=>({id:m.id,content:m.content.slice(0,4000),source:m.source,provenance:m.provenance,confidence:m.confidence,updatedAt:m.updatedAt,createdAt:m.createdAt,timestamp:m.timestamp}));
}
function createMemory(env, transport=fetch) {
  const base = env.METERLESS_BASE_URL || 'http://127.0.0.1:8766';
  return {
    async inspect(catalog) {
      let response;
      try { response=await transport(endpoint(base,'/api/memories'),{method:'GET',redirect:'error',signal:AbortSignal.timeout(5000)}); }
      catch {throw new Error('Meterless 서비스에 연결할 수 없습니다. meterless-demo에서 npm start를 실행하세요.');}
      if(!response.ok)throw new Error(`Meterless HTTP ${response.status}`);
      const result=await response.json();
      if(!Array.isArray(result.memories))throw new Error('Meterless 기억 응답 형식이 올바르지 않습니다.');
      return {status:'connected',scope:memoryScope(catalog),memories:scopedMemories(result.memories,catalog),checked_at:new Date().toISOString()};
    },
    async recall(catalog, signal) {
      const result = await request(endpoint(base,'/api/search'), { query:memoryScope(catalog), mode:'literal' }, transport, signal);
      if (!Array.isArray(result.results)) throw new Error('Meterless 검색 응답 형식이 올바르지 않습니다.');
      return scopedMemories(result.results.map(r=>r.memory),catalog);
    },
    async save(catalog, content, runId) {
      return request(endpoint(base,'/api/memories'), {
        content:`${memoryScope(catalog)} ${content}`,
        source:`cool-sydney:run:${runId}`, confidence:0.5, tags:['cool-sydney',runId]
      }, transport);
    }
  };
}
function dockerQuery(sql, catalog, env=process.env, signal) {
  const container=env.ZETARIS_DRIVER_CONTAINER || 'zetaris-driver-1';
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(container) || !/^cool_sydney_[a-f0-9]{16}$/.test(catalog.database)) throw new Error('Zetaris 실행 설정이 올바르지 않습니다.');
  const folder=`/home/zetaris/customer-data/shared/cool-sydney-registration/${catalog.database.slice(12)}`;
  return new Promise((resolve,reject)=>{
    const child=spawn('docker',['exec','-i',container,'java','-Xmx256m','-cp',`${folder}:${folder}/jdbc.jar`,'QueryParquet'],{stdio:['pipe','pipe','pipe'],signal});
    let output='', bytes=0, done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(new Error('Zetaris SQL 제한 시간 60초를 초과했습니다.'));},60000);
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>500000){child.kill();finish(new Error('SQL 결과가 너무 큽니다. 집계하거나 컬럼 수를 줄이세요.'));}else output+=chunk;});
    child.stderr.resume(); // Do not propagate driver/daemon logs that may contain secrets.
    child.stdin.on('error',()=>{});
    child.on('error',()=>finish(new Error('Docker에 접근하지 못했습니다. Docker가 허용된 터미널에서 대시보드를 실행하세요.')));
    child.on('close',code=>{
      if(code!==0)return finish(new Error('Zetaris SQL 실행 실패. driver 상태·SQL·등록을 확인하세요. QueryParquet가 없으면 python3 scripts/register_zetaris.py --date 2025-12-19 --with-catalog를 실행하세요.'));
      const marker=output.split('\n').find(line=>line.startsWith('COOL_SYDNEY_JSON='));
      try {if(!marker)throw new Error();finish(null,JSON.parse(marker.slice(17)));}
      catch {finish(new Error('Zetaris가 올바른 JSON 결과를 반환하지 않았습니다.'));}
    });
    child.stdin.end(sql);
  });
}
module.exports={createMemory,dockerQuery,memoryScope};
