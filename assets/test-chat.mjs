import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {createFrontendApp} from './server.mjs';
import {createAgentChat} from './dist/agent-client.js';
import {checkedPlan,publishFogPlan,createPlanPanel} from './dist/fog-plan.js';
const folder=new URL('../shared/demo/agent-monitor/',import.meta.url),read=name=>JSON.parse(fs.readFileSync(new URL(name,folder)));
const manifest=read('manifest.json');
const runs=manifest.runs.filter(r=>r.response_language==='en').reverse().map(r=>read('runs/'+r.id+'.json'));
const ready={date:'2025-12-19',fresh_start_supported:true,dependency_installed:true,catalog_ready:true,providers:{gemini:{configured:true}}};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function storage(){const values=new Map();return {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};}
class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.listeners={};this.classList={toggle:()=>{}};}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return (this.text||'')+this.children.map(c=>c.textContent).join(' ');}
  replaceChildren(...children){this.text='';this.children=children;}
  append(...children){this.children.push(...children);}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(k,v){this.listeners[k]=v;}
}
function documentFixture(){
  const elements=new Map(['candidate-list','allocation-summary','allocation-detail','panel'].map(id=>[id,new Element()]));const events=[];
  return {elements,events,getElementById:id=>elements.get(id),querySelector:()=>elements.get('panel'),createElement:tag=>new Element(tag),dispatchEvent:event=>events.push(event)};
}
test('4173 proxies the five English turns to the existing API, continues context, and displays plan units',async()=>{
  const posts=[],upstream=[],doc=documentFixture(),stop=createPlanPanel(doc),updates=[];
  const app=createFrontendApp({transport:async(url,options)=>{
    upstream.push({url,options});assert.ok(url.startsWith('http://127.0.0.1:8766/api/agent/'));
    assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Origin,undefined);
    if(url.endsWith('/status'))return response(ready);
    if(options.method==='POST'){posts.push(JSON.parse(options.body));return response({id:runs[(posts.length-1)%5].id},202);}
    return response(runs.find(r=>url.endsWith('/'+r.id)));
  }});
  const transport=(url,options)=>app(new Request('http://127.0.0.1:4173'+url,{...options,headers:{...options.headers,Origin:'http://127.0.0.1:4173'}}));
  const chat=createAgentChat({transport,storage:storage(),sleep:async()=>{},onPlan:publishFogPlan,onChange:s=>updates.push(s)});chat.initialise();
  try{
    for(const [i,run]of runs.entries()){
      await chat.send(run.question);
      assert.equal(posts[i].question,run.question);assert.equal(posts[i].date,'2025-12-19');assert.equal(posts[i].provider,'gemini');assert.equal(posts[i].remember_request,true);
      assert.equal(posts[i].fresh_start,i===0);assert.equal(posts[i].previous_run_id,i?runs[i-1].id:null);
      assert.equal(chat.snapshot().error,'');assert.equal(chat.snapshot().previous_run_id,run.id);
      if(i){
        const rows=doc.elements.get('candidate-list').children,plan=run.plan;
        assert.equal(rows.length,10);assert.deepEqual(rows.map(r=>r.dataset.allocationId),checkedPlan(plan).allocations.map(r=>r.allocation_id));
        assert.match(doc.elements.get('allocation-summary').textContent,new RegExp(`${plan.totals.units} fog units`));
        rows[0].listeners.click();assert.match(doc.elements.get('allocation-detail').textContent,/fog units/);
        const missing=plan.allocations.find(a=>!a.position);assert.ok(rows.find(r=>r.dataset.allocationId===missing.allocation_id).textContent.includes('Coordinates unavailable'));
        const events=doc.events.length;rows.find(r=>r.dataset.allocationId===missing.allocation_id).listeners.click();assert.equal(doc.events.length,events);
      }
    }
    assert.equal(chat.snapshot().plan.totals.units,30);assert.equal(chat.snapshot().plan.totals.water_l,1500);
    assert.equal(chat.reset(),true);assert.equal(doc.elements.get('candidate-list').children.length,0);assert.equal(chat.snapshot().previous_run_id,null);
    await chat.send(runs[0].question);assert.equal(posts[5].fresh_start,true);assert.equal(posts[5].previous_run_id,null);
    assert.ok(updates.some(s=>s.busy));assert.ok(upstream.every(r=>!r.url.includes('gemini')&&!r.url.includes('nvidia')));
  }finally{stop();publishFogPlan(null);}
});
test('pending responses resume with GET only after a reload; polling and duplicate sends are bounded',async()=>{
  const saved=storage(),calls=[];let complete=false,gate,entered;
  const enteredPromise=new Promise(resolve=>{entered=resolve;});
  const transport=async(url,options)=>{
    calls.push({url,method:options.method});
    if(url.endsWith('/status'))return response(ready);
    if(options.method==='POST')return response({id:runs[1].id},202);
    return response(complete?runs[1]:{id:runs[1].id,status:'running'});
  };
  const chat=createAgentChat({transport,storage:saved,maxPolls:2,sleep:()=>new Promise(resolve=>{gate=resolve;entered();})});
  const work=chat.send('Allocate 50 fog units');await enteredPromise;await chat.send('Duplicate request');assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(chat.reset(),false);
  gate();await work;assert.equal(chat.snapshot().active_run_id,runs[1].id);assert.equal(calls.filter(c=>c.url.endsWith('/'+runs[1].id)).length,2);
  complete=true;const resumed=createAgentChat({transport,storage:saved,sleep:async()=>{}});await resumed.initialise();
  assert.equal(resumed.snapshot().previous_run_id,runs[1].id);assert.equal(resumed.snapshot().active_run_id,null);assert.equal(calls.filter(c=>c.method==='POST').length,1);
});
test('failed runs preserve the last valid plan and do not become follow-up context',async()=>{
  let count=0;const planEvents=[];
  const chat=createAgentChat({transport:async(url,options)=>url.endsWith('/status')?response(ready):options.method==='POST'?response({id:runs[++count===1?1:2].id}):response(count===1?runs[1]:{id:runs[2].id,status:'failed',error:'Could not query the data.'}),sleep:async()=>{},onPlan:p=>planEvents.push(p)});
  await chat.send('First');await chat.send('Second');assert.equal(chat.snapshot().previous_run_id,runs[1].id);assert.equal(chat.snapshot().plan.plan_id,runs[1].id);assert.equal(planEvents.length,1);
  const invalid=structuredClone(runs[1].plan);invalid.totals.units++;
  assert.throws(()=>checkedPlan(invalid),/totals/);
});
test('frontend proxy rejects foreign origins, arbitrary upstream paths and credentials; serves local UI',async()=>{
  let calls=0;const app=createFrontendApp({transport:async()=>{calls++;throw new Error('offline');}});
  const get=(route,options={})=>app(new Request('http://127.0.0.1:4173'+route,options));
  assert.equal((await get('/')).status,200);assert.equal((await get('/agent-client.js')).status,200);
  assert.equal((await get('/.env')).status,404);assert.equal((await get('/api/agent/status?url=https://example.com')).status,404);
  assert.equal((await get('/api/agent/runs',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await get('/api/agent/runs',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
  assert.equal((await get('/api/agent/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(17000)})).status,413);
  assert.equal(calls,0);assert.equal((await get('/api/agent/status')).status,503);
});

test('Ask Mist UI sends user input, renders the answer and plan, and refresh starts a new scenario',async()=>{
  const {default:vm}=await import('node:vm'),{UI}=await import('./dist/i18n.js');
  const doc=documentFixture(),nodes=new Map();
  for(const [,id]of fs.readFileSync(new URL('./dist/index.html',import.meta.url),'utf8').matchAll(/id="([^"]+)"/g)){
    const e=doc.elements.get(id)||new Element();Object.assign(e,{value:'',style:{},scrollHeight:48,focus(){},getAttribute(name){return this.attrs[name];},querySelectorAll(){return [];},showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();}});nodes.set(id,e);
  }
  doc.getElementById=id=>nodes.get(id);
  const posts=[];
  const transport=async(url,options)=>{
    if(url.endsWith('/status'))return response(ready);
    if(options.method==='POST'){posts.push(JSON.parse(options.body));return response({id:runs[posts.length===2?1:0].id},202);}
    return response(url.endsWith('/'+runs[1].id)?runs[1]:runs[0]);
  };
  const context=vm.createContext({document:doc,window:{sessionStorage:storage()},UI,createPlanPanel,publishFogPlan,
    createAgentChat:options=>createAgentChat({...options,transport,sleep:async()=>{}})});
  const code=fs.readFileSync(new URL('./dist/chat.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
  try{
    vm.runInContext(code,context);
    const input=nodes.get('chat-input'),send=nodes.get('chat-send'),form=nodes.get('chat-form'),clear=nodes.get('chat-clear');
    assert.equal(send.disabled,true);
    for(const question of [runs[0].question,runs[1].question]){
      input.value=question;input.listeners.input();assert.equal(send.disabled,false);
      await form.listeners.submit({preventDefault(){}});assert.equal(input.value,'');
    }
    assert.equal(posts.length,2);assert.equal(posts[1].previous_run_id,runs[0].id);
    assert.match(nodes.get('chat-messages').textContent,/336,210/);assert.equal(doc.elements.get('candidate-list').children.length,10);
    clear.listeners.click();assert.equal(nodes.get('chat-messages').children.length,0);assert.equal(doc.elements.get('candidate-list').children.length,0);
    input.value='Start again';input.listeners.input();await form.listeners.submit({preventDefault(){}});
    assert.equal(posts[2].fresh_start,true);assert.equal(posts[2].previous_run_id,null);assert.equal(posts[2].remember_request,true);
  }finally{publishFogPlan(null);}
});
