'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validateSQL}=require('../agent-sql');
const {createNodes,buildGraph,describeGraph,nvidiaCall,createAgent}=require('../agent');
const {createMemory}=require('../agent-connectors');
const catalog={database:'cool_sydney_0123456789abcdef',catalog_version:'test',analysis_date:'2025-12-19',gis_version:'ofm-test',cbd_version:'cbd-test',area:{id:'sydney-cbd-harbour'},tables:['weather','pedestrian_counts','trees'].map(name=>({name,qualified_name:`cool_sydney_0123456789abcdef.${name}`,columns:[],limitations:[],row_count:name==='pedestrian_counts'?0:24})),joins:[],notes:[]};
const db=catalog.database;
const call=(name,args,id='c1')=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
function nodes(overrides={}) {
  const events=[];
  const emit=(type,data)=>{const e={seq:events.length+1,type,...data};events.push(e);return e;};
  return {events,n:createNodes({catalog,question:'12월 19일 5대·물 300L',emit,signal:new AbortController().signal,memory:{recall:async()=>[]},query:async()=>({columns:['instant_utc','temperature_c','humidity_pct'],data:[['2025-12-19T03:00:00.000Z','40','20']]}),model:async()=>({message:{role:'assistant',content:'답변'},usage:null}),...overrides})};
}
test('SQL scope, row limit and forbidden external readers / writes',()=>{
  assert.equal(validateSQL(`SELECT MAX(temperature_c) FROM ${db}.weather;`,catalog).sql,`SELECT MAX(temperature_c) FROM ${db}.weather LIMIT 100`);
  assert.doesNotThrow(()=>validateSQL(`SELECT a.instant_utc FROM ${db}.weather a LEFT JOIN ${db}.pedestrian_counts b ON a.instant_utc = b.instant_utc WHERE a.humidity_pct > 20 LIMIT 24`,catalog));
  for(const sql of [`DELETE FROM ${db}.weather`,`SELECT * FROM other.weather`,`SELECT * FROM ${db}.weather; DROP TABLE x`,`SELECT * FROM ${db}.weather -- hi`,`SELECT * FROM ${db}.weather /* hi */`,`SELECT java_method('x','y') FROM ${db}.weather`,`SELECT * FROM parquet.'/etc/passwd'`,`SELECT * FROM ${db}.weather a, external.secret`,`SELECT * FROM ${db}.weather UNION SELECT * FROM ${db}.trees`,`SELECT * FROM ${db}.weather LIMIT 101`,`SELECT * FROM (SELECT * FROM ${db}.weather)`,`SELECT reflect('a','b') FROM ${db}.weather`])assert.throws(()=>validateSQL(sql,catalog),sql);
});
test('context loads catalog once and reports unavailable memory without fabricating memories',async()=>{
  const {n,events}=nodes({memory:{recall:async()=>{throw new Error('offline');}}});const s=await n.context();
  assert.equal(events.find(e=>e.type==='catalog').database,db);assert.equal(events.find(e=>e.type==='memory').status,'unavailable');
  assert.match(s.messages[0].content,/2025-12-19/);assert.equal(JSON.parse(s.messages[1].content).memories.length,0);
});
test('node traces preserve prompts, SQL inputs and results across calls without hidden provider fields',async()=>{
  const sent=[];let count=0;
  const {n,events}=nodes({model:async messages=>{
    sent.push(JSON.parse(JSON.stringify(messages)));
    return {message:count++===0?{role:'assistant',content:null,reasoning_content:'hidden-reasoning',tool_calls:[{...call('execute_readonly_sql',{sql:`SELECT instant_utc, temperature_c, humidity_pct FROM ${db}.weather`}),extra_content:{google:{thought_signature:'hidden-signature'}}}]}:{role:'assistant',content:'확인했습니다.'},usage:{total_tokens:25}};
  }});
  let state=await n.context();state={...state,...await n.model(state)};state={...state,...await n.tools(state)};await n.model(state);
  const prompt=events.find(e=>e.type==='context_prompt'),requests=events.filter(e=>e.type==='model_request'),responses=events.filter(e=>e.type==='model');
  assert.deepEqual(prompt.messages,sent[0]);assert.deepEqual(requests[0].messages,sent[0]);assert.ok(requests[0].tools.length);
  const query=events.find(e=>e.type==='sql_request'),output=events.find(e=>e.type==='tool_result');
  assert.equal(query.tool_call_id,'c1');assert.match(query.sql,/LIMIT 100$/);assert.equal(output.result.sql_event,query.seq);
  assert.equal(output.tool_event,events.find(e=>e.type==='tool_call').seq);
  assert.deepEqual(JSON.parse(requests[1].messages.at(-1).content).result.data,output.result.data);
  assert.equal(responses[0].request_event,requests[0].seq);assert.equal(responses[1].message.content,'확인했습니다.');
  assert.doesNotMatch(JSON.stringify(events),/hidden-reasoning|hidden-signature/);
});
test('SQL result feeds physics tool; water budget and evidence are explicit',async()=>{
  const {n,events}=nodes();
  let s=await n.context();s.messages.push({role:'assistant',tool_calls:[call('execute_readonly_sql',{sql:`SELECT instant_utc, temperature_c, humidity_pct FROM ${db}.weather LIMIT 24`})]});
  s={...s,...await n.tools(s)};
  s.messages.push({role:'assistant',tool_calls:[call('simulate_fog',{instant_utc:'2025-12-19T03:00:00.000Z',devices:5,hours:8},'c2')]});
  s={...s,...await n.tools(s)};
  const result=JSON.parse(s.messages.at(-1).content).result;
  assert.equal(result.total_water_l,480);assert.equal(result.evidence_type,'assumption-based-simulation');
  assert.ok(result.source_air.afterC<40);assert.equal(events.filter(e=>e.type==='sql_request').length,1);
});
test('invented weather, disallowed SQL and malformed arguments return observable errors for retry',async()=>{
  let queries=0;const {n,events}=nodes({query:async()=>{queries++;}});
  const s=await n.context();s.messages.push({role:'assistant',tool_calls:[call('simulate_fog',{instant_utc:'2025-12-19T03:00:00.000Z',devices:5,hours:8}),call('execute_readonly_sql',{sql:'DROP TABLE x'},'c2'),{id:'c3',function:{name:'execute_readonly_sql',arguments:'bad-json'}}]});
  const r=await n.tools(s);assert.equal(queries,0);assert.equal(events.filter(e=>e.type==='tool_error').length,3);assert.equal(r.messages.at(-1).role,'tool');
});
test('SQL error is returned to model, empty data remains empty',async()=>{
  const {n}=nodes({query:async()=>({columns:['passages'],data:[]})});const s=await n.context();
  s.messages.push({role:'assistant',tool_calls:[call('execute_readonly_sql',{sql:`SELECT passages FROM ${db}.pedestrian_counts`})]});
  const r=await n.tools(s);assert.deepEqual(JSON.parse(r.messages.at(-1).content).result.data,[]);
});
test('Meterless scopes recall, excludes unrelated memories, and preserves provenance',async()=>{
  const requests=[];const memory=createMemory({},async(url,options)=>{
    requests.push({url,body:JSON.parse(options.body)});
    return {ok:true,json:async()=>({results:[{memory:{id:'mem-1',timestamp:1,content:'[cool-sydney:sydney-cbd-harbour] 물 300L',provenance:{label:'user'}}},{memory:{id:'mem-2',content:'private unrelated'}}]})};
  });
  const results=await memory.recall(catalog);assert.equal(results.length,1);assert.equal(results[0].id,'mem-1');assert.equal(requests[0].body.mode,'literal');
  await memory.save(catalog,'물 예산 300L','run-id');assert.match(requests[1].body.content,/^\[cool-sydney:sydney-cbd-harbour\]/);
});
test('integrated memory view reads only scoped memories without creating search events',async()=>{
  const requests=[];
  const memory=createMemory({},async(url,options)=>{
    requests.push({url,options});return {ok:true,json:async()=>({memories:[{id:'mem-1',timestamp:1,content:'[cool-sydney:sydney-cbd-harbour] water 300L'},{id:'other',content:'unrelated'}]})};
  });
  const result=await memory.inspect(catalog);
  assert.equal(result.status,'connected');assert.equal(result.memories.length,1);assert.equal(result.memories[0].id,'mem-1');
  assert.equal(requests[0].options.method,'GET');assert.equal(requests[0].options.body,undefined);assert.match(requests[0].url,/\/api\/memories$/);
  await assert.rejects(createMemory({},async()=>{throw new Error('offline');}).inspect(catalog),/연결할 수 없습니다/);
});
test('NVIDIA messages retain tool calls but exclude hidden reasoning and API key from output',async()=>{
  let request;
  const result=await nvidiaCall([{role:'user',content:'test'}],{env:{MODEL_API_KEY:'secret'},signal:new AbortController().signal,last:false,transport:async(url,opts)=>{
    request=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{message:{content:'answer',reasoning_content:'private reasoning'}}],usage:{total_tokens:12}})};
  }});
  assert.equal(request.tool_choice,'auto');assert.equal(request.chat_template_kwargs.enable_thinking,false);assert.equal(result.message.reasoning_content,undefined);assert.doesNotMatch(JSON.stringify(result),/secret|private reasoning/);
});
let installed=true;try{require.resolve('@langchain/langgraph');}catch{installed=false;}
test('real LangGraph cycles model → SQL tool → model with bounded calls', {skip:installed?false:'LangGraph package unavailable; run npm install then rerun'},async()=>{
  let count=0;const {n,events}=nodes({model:async()=>({message:count++===0?{role:'assistant',content:null,tool_calls:[call('execute_readonly_sql',{sql:`SELECT instant_utc, temperature_c, humidity_pct FROM ${db}.weather LIMIT 24`})]}:{role:'assistant',content:'기온 40°C, 가정 기반 검토입니다.'}})});
  const graph=await buildGraph(n),result=await graph.invoke({}, {recursionLimit:20});
  assert.equal(result.calls,2);assert.match(result.answer,/40/);assert.equal(events.filter(e=>e.type==='tool_result').length,1);
  assert.deepEqual(events.filter(e=>e.type==='node_start').map(e=>e.node),['load_catalog','recall_memory','compose_prompt','model','route_tools','execute_sql','route_tools','model','finish','export_plan']);
  assert.equal(events.filter(e=>e.type==='node_end').length,10);
  const structure=await describeGraph();
  assert.equal(structure.source,'compiled-langgraph');assert.ok(!structure.nodes.some(n=>n.id==='tools'));assert.ok(structure.nodes.some(n=>n.id==='execute_sql'));
  assert.deepEqual(structure.edges.filter(e=>e.source==='model').map(e=>e.target).sort(),['finish','route_tools']);
  const {graphExecution}=await import('../src/agent-graph.mjs');
  const view=graphExecution(structure,{events,status:'completed'});
  assert.equal(view.nodes.model.visits,2);assert.equal(view.nodes.execute_sql.visits,1);assert.equal(view.nodes.__end__.state,'done');
  assert.equal(view.edges['model->route_tools'],1);assert.equal(view.edges['route_tools->model'],1);assert.equal(view.edges['model->finish'],1);
  assert.ok(view.nodes.execute_sql.events.some(e=>e.type==='sql_request'));
});
test('graph monitor distinguishes interrupted nodes, unexecuted paths, and runs without traces',async()=>{
  const {graphExecution}=await import('../src/agent-graph.mjs');
  const graph={nodes:['__start__','model','finish','__end__'].map(id=>({id})),edges:[{source:'__start__',target:'model'},{source:'model',target:'finish'},{source:'finish',target:'__end__'}]};
  const view=graphExecution(graph,{status:'failed',finished_at:'2025-12-19T00:00:02Z',events:[{type:'node_start',node:'model',at:'2025-12-19T00:00:00Z'}]});
  assert.equal(view.nodes.model.state,'error');assert.equal(view.nodes.model.duration_ms,2000);
  assert.equal(view.nodes.__end__.state,'idle');assert.equal(view.edges['model->finish'],0);
  assert.equal(graphExecution(graph,{status:'completed',events:[{type:'answer'}]}).has_trace,false);
});
test('real LangGraph terminates a model that keeps calling tools', {skip:!installed},async()=>{
  const {n}=nodes({model:async()=>({message:{role:'assistant',tool_calls:[call('catalog_details',{table_names:['weather']})]}})});
  const result=await (await buildGraph(n)).invoke({}, {recursionLimit:80});assert.equal(result.calls,4);assert.match(result.answer,/한도/);
});
test('identical tool requests reuse results without another database query',async()=>{
  let queries=0;const {n,events}=nodes({query:async()=>{queries++;return {columns:['passages'],data:[[25]]};}});
  const state=await n.context();state.messages.push({role:'assistant',tool_calls:[call('execute_readonly_sql',{sql:`SELECT passages FROM ${db}.pedestrian_counts`},'first'),call('execute_readonly_sql',{sql:`SELECT passages FROM ${db}.pedestrian_counts`},'again')]});
  const result=await n.tools(state);assert.equal(queries,1);assert.equal(events.filter(e=>e.type==='tool_reused').length,1);
  assert.deepEqual(result.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content).result.data),[[[25]],[[25]]]);
});
test('separate SQL and cooling nodes preserve multi-tool ordering and shared weather evidence',{skip:!installed},async()=>{
  let turn=0;const {n,events}=nodes({model:async messages=>{
    if(turn++===0)return {message:{role:'assistant',tool_calls:[call('execute_readonly_sql',{sql:`SELECT instant_utc, temperature_c, humidity_pct FROM ${db}.weather LIMIT 24`},'sql1'),call('simulate_fog',{instant_utc:'2025-12-19T03:00:00.000Z',devices:5,hours:8},'cool1')]}};
    assert.deepEqual(messages.filter(m=>m.role==='tool').map(m=>m.tool_call_id),['sql1','cool1']);
    assert.equal(JSON.parse(messages.at(-1).content).result.total_water_l,480);
    return {message:{role:'assistant',content:'근거를 이용해 계산했습니다.'}};
  }});
  const result=await(await buildGraph(n)).invoke({}, {recursionLimit:80});assert.equal(result.calls,2);
  const starts=events.filter(e=>e.type==='node_start').map(e=>e.node);
  assert.ok(starts.indexOf('execute_sql')<starts.indexOf('simulate_cooling'));
  assert.ok(!starts.includes('allocate_devices'));assert.ok(!starts.includes('tools'));
});
test('agent marks interrupted runs failed and rejects invalid IDs',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cool-agent-')),id='12345678-1234-1234-1234-123456789abc';
  fs.mkdirSync(path.join(root,'agent-runs'));fs.writeFileSync(path.join(root,'agent-runs',id+'.json'),JSON.stringify({id,status:'running'}));
  const agent=createAgent({root,env:{}});try {assert.equal(agent.get(id).status,'failed');assert.throws(()=>agent.get('../.env'));assert.equal(agent.status().catalog_ready,false);}finally{agent.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('Gemini uses its own credentials and compatible options; preserves opaque tool signatures',async()=>{
  const {modelCall}=require('../agent');let request,authorization,url;
  const result=await modelCall([{role:'user',content:'weather'}],{provider:'gemini',env:{GEMINI_API_KEY:'gem-secret',MODEL_API_KEY:'nvidia-secret'},signal:new AbortController().signal,last:false,transport:async(u,o)=>{
    url=u;request=JSON.parse(o.body);authorization=o.headers.Authorization;
    return {ok:true,json:async()=>({choices:[{message:{content:null,reasoning_content:'hidden',tool_calls:[{...call('catalog_details',{table_names:['weather']}),extra_content:{google:{thought_signature:'opaque'}}}]}}]})};
  }});
  assert.match(url,/generativelanguage.googleapis.com/);assert.equal(authorization,'Bearer gem-secret');assert.equal(request.chat_template_kwargs,undefined);assert.equal(request.reasoning_effort,'low');
  assert.equal(result.message.tool_calls[0].extra_content.google.thought_signature,'opaque');assert.equal(result.message.reasoning_content,undefined);
});

test('operator changes inventory while preserving commute priority and water budget',()=>{
  const {resolveConstraints}=require('../fog-allocation');
  const memories=[{content:'[cool-sydney:sydney-cbd-harbour] [운영 조건 JSON] '+JSON.stringify({constraints:{devices:50,commute_priority:true,water_budget_l:300},plan:[{id:'qvb',devices:20}]})}];
  const c=resolveConstraints('이번에는 30대가 있어',memories);
  assert.deepEqual(c.constraints,{devices:30,commute_priority:true,water_budget_l:300});assert.equal(c.previous[0].devices,20);
  assert.equal(resolveConstraints('출퇴근 시간을 고려해줘',memories).constraints.devices,50);
  assert.equal(resolveConstraints('출퇴근은 고려하지 마',memories).constraints.commute_priority,false);
  assert.equal(resolveConstraints('포그가 50개 있어',[]).constraints.devices,50);
  assert.equal(resolveConstraints('전체 보행 조사 지점에서 평일 출퇴근 시간대의 보행량이 많은 구간 10곳을 찾아줘',[]).constraints.commute_priority,false);
  const english=resolveConstraints('Place 50 fog units. Operate 10:00–18:00 with 3000L.',[]);
  assert.equal(english.constraints.devices,50);assert.equal(english.constraints.start_hour,10);assert.equal(english.constraints.end_hour,18);
  assert.equal(resolveConstraints('2025-12-19',[]).constraints.start_hour,undefined);
});

test('allocation conserves arbitrary inventory and water budget with explicit proxy evidence',()=>{
  const {allocateFog}=require('../fog-allocation');
  const forecast={ready:true,date:'2025-12-19',manifest:{model_id:'test'},rows:['A002','A003','A004'].flatMap((site,i)=>Array.from({length:24},(_,hour)=>({site_id:site,hour,predicted_passages:(i+1)*100+(hour===8?100:0)})))};
  for(const devices of [0,1,7,30,50,101]){
    const result=allocateFog(forecast,{constraints:{devices,commute_priority:true,water_budget_l:300},previous:null});
    assert.equal(result.total_devices,devices);assert.ok(result.total_water_l<=300);assert.ok(result.allocation.every(r=>Number.isInteger(r.devices)&&r.devices>=0));assert.equal(result.evidence_type,'forecast-proxy-allocation');
  }
  assert.throws(()=>allocateFog(forecast,{constraints:{devices:null}},{}),/장비 수/);
});

test('full graph persists changing inventory and reuses commute preference through memory', {skip:!installed},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cool-agent-flow-'));
  const c={...catalog,gis_version:'ofm-0123456789abcdef',cbd_version:'cbd-0123456789abcdef'};
  c.tables=['building','transportation','water','landcover','landuse','poi','walk_nodes','walk_edges','trees','pedestrian_sites','pedestrian_counts','weather'].map(name=>({name,qualified_name:`${db}.${name}`,row_count:0,file_sha256:'hash',columns:[],limitations:[]}));
  for(const dir of ['catalog',`processed/${c.gis_version}`,`processed/bundles/${c.cbd_version}`])fs.mkdirSync(path.join(root,dir),{recursive:true});
  const files=c.tables.map(t=>({name:t.name+'.parquet',rows:0,sha256:'hash'}));
  fs.writeFileSync(path.join(root,'catalog/current.json'),JSON.stringify(c));
  fs.writeFileSync(path.join(root,`processed/${c.gis_version}/manifest.json`),JSON.stringify({files:files.slice(0,6)}));
  fs.writeFileSync(path.join(root,`processed/bundles/${c.cbd_version}/manifest.json`),JSON.stringify({files:files.slice(6),date:'2025-12-19',components:{buildings:c.gis_version}}));
  const memories=[];
  const forecast={ready:true,date:'2025-12-19',manifest:{model_id:'test'},rows:['A002','A003','A004'].flatMap((site,i)=>Array.from({length:24},(_,hour)=>({site_id:site,hour,predicted_passages:100*(i+1)+(hour===8?200:0)})))};
  const agent=createAgent({root,env:{},forecasts:{get:async()=>forecast},memory:{recall:async()=>[...memories].reverse(),save:async(c,content)=>{const memory={id:'mem-'+memories.length,content:'[cool-sydney:sydney-cbd-harbour] '+content};memories.push(memory);return {memory};}},model:async messages=>({message:messages.at(-1).role==='tool'?{role:'assistant',content:'검토 배분입니다.'}:{role:'assistant',tool_calls:[call('allocate_fog',{})]}})});
  async function run(question){const job=await agent.start({question,date:'2025-12-19',provider:'gemini',remember_request:true});for(let i=0;i<200;i++){const result=agent.get(job.id);if(!['queued','running'].includes(result.status)){assert.equal(result.status,'completed',result.error);return result;}await new Promise(r=>setTimeout(r,10));}assert.fail('agent did not finish');}
  try{
    assert.equal((await run('포그 50대가 있어. 10시부터 18시까지 운영해줘.')).allocation.total_devices,50);
    const second=await run('출퇴근 시간을 고려해줘');assert.equal(second.allocation.total_devices,50);assert.equal(second.operating_conditions.constraints.commute_priority,true);
    assert.deepEqual(second.allocation.operating_hours,{start_hour:10,end_hour:18});
    assert.equal(second.allocation.schedule.length,8);
    const third=await run('이번에는 30대로 바꿔');assert.equal(third.allocation.total_devices,30);assert.equal(third.operating_conditions.constraints.commute_priority,true);assert.equal(memories.length,3);
    assert.equal(agent.list().length,3);assert.equal(agent.list()[0].id,third.id);
    assert.equal(third.events.at(-1).type,'memory_saved');
  }finally{agent.close();fs.rmSync(root,{recursive:true,force:true});}
});
