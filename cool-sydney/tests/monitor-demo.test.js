'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createMonitorDemo}=require('../monitor-demo'),{snapshotRedactor}=require('../monitor-snapshot');
test('committed demo serves prompts, graph, memory and plans without any live dependencies',async()=>{
  const app=createMonitorDemo();
  const get=route=>app(new Request('http://127.0.0.1:8766'+route));
  const status=await (await get('/api/cool-sydney/status')).json();assert.equal(status.replay_mode,true);assert.equal(status.model_configured,false);
  const runs=await (await get('/api/cool-sydney/runs')).json();assert.equal(runs.length,6);
  const latest=await (await get('/api/cool-sydney/runs/'+runs[0].id)).json();assert.ok(latest.events.some(e=>e.type==='model_request'));assert.ok(latest.events.some(e=>e.type==='sql_request'));
  const plan=await (await get(`/api/cool-sydney/runs/${runs[0].id}/plan`)).json();assert.equal(plan.totals.units,30);assert.ok(plan.totals.water_l<=1500);
  assert.equal((await get('/')).status,200);assert.equal((await get('/agent-monitor.mjs')).status,200);
  const graph=await(await get('/api/cool-sydney/graph')).json();assert.ok(graph.nodes.some(n=>n.id==='export_plan'));
  const memories=await(await get('/api/cool-sydney/memories')).json();assert.equal(memories.memories.length,6);assert.ok(memories.memories.every(m=>m.content.startsWith('[cool-sydney:')));
  assert.equal((await app(new Request('http://127.0.0.1:8766/api/cool-sydney/runs',{method:'POST'}))).status,405);
  assert.equal((await get('/.env')).status,404);
  assert.equal((await app(new Request('http://127.0.0.1:8766/api/cool-sydney/runs',{headers:{Origin:'https://example.com'}}))).status,403);
});
test('snapshot redaction removes credentials, provider internals and machine paths',()=>{
  const redactor=snapshotRedactor(['test-private-key-12345'],[['/Users/test/project','<project>']]);
  const cleaned=redactor.clean({api_key:'secret',content:'Stored at /Users/test/project/data. key test-private-key-12345',messages:[{reasoning_content:'hidden',extra_content:{google:{thought_signature:'private'}},content:'answer'}],embedding:[1,2],usage:{total_tokens:10}});
  const text=JSON.stringify(cleaned);assert.doesNotMatch(text,/test-private-key|private|hidden|\/Users\/test|embedding/);assert.equal(cleaned.usage.total_tokens,10);assert.ok(redactor.count()>0);
});
