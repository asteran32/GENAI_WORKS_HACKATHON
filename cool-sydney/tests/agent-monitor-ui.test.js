'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

// Exercise the delivered script against a minimal DOM, including offline boot.
class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.listeners={};this.value='gemini';}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return (this.text||'')+this.children.map(c=>c.textContent).join('');}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.text='';this.children=children;}
  setAttribute(name,value){this.attributes[name]=String(value);if(name==='data-node')this.dataset.node=value;}
  addEventListener(name,listener){this.listeners[name]=listener;}
  querySelectorAll(selector){return this.children.flatMap(c=>[...(selector==='[data-node]'&&c.dataset.node?[c]:[]),...c.querySelectorAll(selector)]);}
}
test('delivered monitor renders the compiled graph before any API succeeds',async()=>{
  const src=path.resolve(__dirname,'../src');
  const html=fs.readFileSync(path.join(src,'agent-monitor.html'),'utf8');
  const ids=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  const code=fs.readFileSync(path.join(src,'agent-monitor.mjs'),'utf8');
  assert.doesNotMatch(code,/^import\s/m,'older servers must not need new module routes');
  const context=vm.createContext({document:{hidden:true,getElementById:id=>ids[id],createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)},
    window:{},AbortSignal,fetch:async()=>{throw new Error('offline');},setInterval:()=>0,setTimeout,console});
  vm.runInContext(code,context);
  const nodes=ids['agent-graph'].querySelectorAll('[data-node]');
  assert.ok(nodes.some(n=>n.dataset.node==='execute_sql'));assert.ok(nodes.some(n=>n.dataset.node==='simulate_cooling'));assert.ok(!nodes.some(n=>n.dataset.node==='tools'));
  nodes.find(n=>n.dataset.node==='recall_memory').listeners.click();
  assert.match(ids['agent-graph-detail'].textContent,/Meterless/);
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(ids['agent-graph-status'].textContent,/실시간 서버 연결을 확인하지 못했습니다/);
  assert.equal(ids['agent-graph'].querySelectorAll('[data-node]').length,nodes.length);
});
test('node inspector shows prompt bodies, model turns, and SQL result cells as text',async()=>{
  const src=path.resolve(__dirname,'../src');
  const code=fs.readFileSync(path.join(src,'agent-graph.mjs'),'utf8').replace(/^export /gm,'');
  const context=vm.createContext({document:{createElement:tag=>new Element(tag)}});vm.runInContext(code,context);
  const prompt={seq:1,type:'context_prompt',messages:[{role:'system',content:'SYSTEM PROMPT'},{role:'user',content:'USER QUESTION'}],tools:[]};
  const first=new Element();context.renderNodeTrace(first,'load_context',[prompt],{});
  assert.match(first.textContent,/SYSTEM PROMPT/);assert.match(first.textContent,/USER QUESTION/);
  const request={seq:2,type:'model_request',call:1,messages:prompt.messages,tools:[],tool_choice:'auto'};
  const response={seq:3,type:'model',request_event:2,call:1,message:{role:'assistant',content:'MODEL OUTPUT'}};
  const model=new Element();context.renderNodeTrace(model,'model',[request,response],{provider:'gemini',model:'test'});
  assert.match(model.textContent,/SYSTEM PROMPT/);assert.match(model.textContent,/MODEL OUTPUT/);
  const call={seq:4,type:'tool_call',name:'execute_readonly_sql',tool_call_id:'c1',model_call:1,arguments:'{"sql":"SELECT value"}'};
  const sql={seq:5,type:'sql_request',tool_event:4,sql:'SELECT value LIMIT 100'};
  const result={seq:6,type:'tool_result',tool_event:4,result:{sql_event:5,columns:['value'],data:[['<script>untrusted</script>']]}};
  const tools=new Element();context.renderNodeTrace(tools,'tools',[call,sql,result],{events:[call,sql,result]});
  assert.match(tools.textContent,/SELECT value LIMIT 100/);assert.match(tools.textContent,/実際|실제 반환 1행/);
  const walk=el=>[el,...el.children.flatMap(walk)];assert.equal(walk(tools).filter(el=>el.tag==='table').length,1);
  assert.equal(walk(tools).filter(el=>el.tag==='script').length,0);
  assert.equal(walk(tools).find(el=>el.tag==='td').textContent,'<script>untrusted</script>');
});
test('clicking separate model and SQL steps isolates their inputs and outputs',()=>{
  const code=fs.readFileSync(path.resolve(__dirname,'../src/agent-graph.mjs'),'utf8').replace(/^export /gm,'');
  const context=vm.createContext({document:{createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)}});vm.runInContext(code,context);
  const graph={nodes:['__start__','load_context','model','tools','finish','__end__'].map(id=>({id})),edges:[]};
  const events=[];const add=(type,extra={})=>events.push({seq:events.length+1,type,at:'2025-12-19T00:00:00Z',...extra});
  add('node_start',{node:'load_context'});add('context_prompt',{messages:[{role:'system',content:'SYSTEM'}],tools:[]});add('node_end',{node:'load_context'});
  add('node_start',{node:'model'});add('model_request',{call:1,messages:[{role:'user',content:'FIRST INPUT'}],tools:[]});add('model',{call:1,request_event:5,message:{role:'assistant',content:'FIRST OUTPUT'}});add('node_end',{node:'model'});
  add('node_start',{node:'tools'});add('tool_call',{name:'execute_readonly_sql',tool_call_id:'c1',model_call:1,arguments:'{}'});add('sql_request',{tool_event:9,sql:'SELECT temperature FROM weather LIMIT 100'});add('tool_result',{tool_event:9,result:{sql_event:10,columns:['temperature'],data:[[39]]}});add('node_end',{node:'tools'});
  add('node_start',{node:'model'});add('model_request',{call:2,messages:[{role:'tool',content:'temperature = 39'}],tools:[]});add('model',{call:2,request_event:14,message:{role:'assistant',content:'SECOND OUTPUT'}});add('node_end',{node:'model'});
  const run={id:'r1',status:'running',events};
  const elements=Object.fromEntries(['svg','detail','status','mermaid','postGraph','flow'].map(k=>[k,new Element()]));
  const view=context.createGraphView(elements);view.paint(graph,run);
  assert.deepEqual(Array.from(context.executionSteps(run),s=>s.title),['메타·기억 준비','모델 1','SQL 조회 1','모델 2']);
  elements.flow.children[1].listeners.click();
  assert.match(elements.detail.textContent,/FIRST INPUT/);assert.match(elements.detail.textContent,/FIRST OUTPUT/);assert.doesNotMatch(elements.detail.textContent,/SECOND OUTPUT/);
  view.paint(graph,run);assert.match(elements.detail.textContent,/FIRST OUTPUT/,'polling must preserve the manually selected step');
  elements.flow.children[2].listeners.click();assert.match(elements.detail.textContent,/SELECT temperature/);assert.match(elements.detail.textContent,/실제 반환 1행/);
  elements.flow.children[3].listeners.click();assert.match(elements.detail.textContent,/temperature = 39/);assert.match(elements.detail.textContent,/SECOND OUTPUT/);
});
