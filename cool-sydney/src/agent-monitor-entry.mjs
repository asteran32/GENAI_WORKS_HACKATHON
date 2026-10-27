// Bundled with agent-graph.mjs and initialGraph by buildMonitor().
const $=id=>document.getElementById(id);
const graphView=createGraphView({svg:$('agent-graph'),detail:$('agent-graph-detail'),status:$('agent-graph-status'),mermaid:$('agent-graph-mermaid'),postGraph:$('agent-graph-post'),flow:$('agent-execution-steps')});
let graphStructure=initialGraph,graphRun=null;
graphView.paint(graphStructure,null);
$('agent-graph-status').textContent='Compiled graph from the app bundle. Checking the live server.';
let runId=null, date='2025-12-19', polling=false,replayMode=false;
const stateLabel={queued:'Pending',running:'Running',completed:'Complete',failed:'Failed'};
const memoryVersions=new Map();
let paintedVersion='';
function memoriesInto(id,memories,empty) {
  const version=JSON.stringify([memories,empty]);if(memoryVersions.get(id)===version)return;memoryVersions.set(id,version);
  const target=$(id);target.replaceChildren();
  if(!memories?.length){target.textContent=empty;return;}
  for(const memory of memories){
    const details=document.createElement('details'),summary=document.createElement('summary'),content=document.createElement('pre'),source=document.createElement('p');
    summary.textContent=memory.id||'Memory';content.textContent=memory.content;
    const stamp=memory.updatedAt||memory.createdAt||memory.timestamp;
    const parsed=stamp?new Date(stamp):null;
    source.textContent=`Source: ${memory.source||'Not recorded'}${parsed&&!Number.isNaN(parsed.getTime())?' · '+parsed.toLocaleString('en-AU'):''}`;
    details.append(summary,source,content);target.append(details);
  }
}
async function refreshMemories() {
  try {
    const data=await api('/api/agent/memories');
    $('agent-memory-connection').textContent=data.status==='connected'?`Connected · Recent area memories: ${data.memories.length} · ${new Date(data.checked_at).toLocaleTimeString('en-AU')} checked`:`Connection failed · ${data.error}`;
    memoriesInto('agent-stored-memories',data.memories,data.status==='connected'?'No memories stored for this area.':'Could not load memories.');
  } catch(error){$('agent-memory-connection').textContent=`Check failed · ${error.message}`;memoriesInto('agent-stored-memories',[],'Restart the server, then click Refresh.');}
}
async function refreshHistory(existing) {
  const runs=existing||await api('/api/agent/runs'),select=$('agent-history');
  select.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Select a run';select.append(placeholder);
  for(const run of runs){const option=document.createElement('option');option.value=run.id;option.textContent=`${stateLabel[run.status]||run.status} · ${run.question?.slice(0,65)||run.id}`;select.append(option);}
  if(!runId){const latest=runs.find(r=>r.status==='completed'&&r.date===date);if(latest){runId=latest.id;paint(await api(`/api/agent/runs/${runId}`));}}
  if(runs.some(r=>r.id===runId))select.value=runId;
}
function paintWorkflow(run) {
  const events=run?.events||[],terminal=['completed','failed'].includes(run?.status);
  const last=type=>events.filter(e=>e.type===type).at(-1);
  const nodeState=node=>{const e=events.filter(e=>e.node===node).at(-1);return !e?'idle':e.type==='node_end'?'done':e.type==='node_error'||terminal?'error':'running';};
  const recall=last('memory'),save=events.filter(e=>['memory_saved','memory_save_error','memory_save_start'].includes(e.type)).at(-1);
  const steps=[
    ['Metadata catalog',last('catalog')?'done':nodeState('load_context'),last('catalog')?`${last('catalog').tables} tables`:''],
    ['Recall Meterless',recall?(recall.status==='connected'?'done':'error'):nodeState('load_context')==='running'?'running':'idle',recall?(recall.status==='connected'?`${recall.memories?.length||0} retrieved`:recall.error):''],
    ['Apply conditions',run?.operating_conditions?'done':'idle',''],
    [`${run?.provider||'AI'} decisions ↔ tools`,nodeState('model'),`Model responses ${events.filter(e=>e.type==='model').length} · SQL requests ${events.filter(e=>e.type==='sql_request').length} · Tool errors ${events.filter(e=>e.type==='tool_error').length}`],
    ['Result',last('answer')?'done':run?.status==='failed'?'error':nodeState('finish'),run?.error||''],
    ['Save to Meterless',save?(save.type==='memory_saved'?'done':save.type==='memory_save_error'||terminal?'error':'running'):run?.remember_request===false?'skipped':'idle',save?(save.memory_id||save.error||'Saving'):run?.remember_request===false?'Auto-save disabled':'']
  ];
  // While a tool executes, the model has yielded; keep that cycle visibly active.
  if(nodeState('tools')==='running')steps[3][1]='running';
  const labels={idle:terminal?'Not run':'Pending',done:'Complete',running:'Running',error:'Error',skipped:'Skipped'};
  $('agent-workflow').replaceChildren(...steps.map(([title,state,detail])=>{const li=document.createElement('li');li.dataset.state=state;li.textContent=`${title} · ${labels[state]}${detail?' — '+detail:''}`;return li;}));
  $('agent-view-question').textContent=run?`${run.question} · ${stateLabel[run.status]||run.status}`:'Send a question to see the actual execution and memory use.';
  $('agent-recall-status').textContent=recall?(recall.status==='connected'?`This run retrieved ${recall.memories?.length||0} memories. This is a snapshot at execution time, separate from the current memory list.`:`Recall failed: ${recall.error}`):'Before recall';
  memoriesInto('agent-recalled-memories',recall?.memories,recall?.status==='connected'?'No memories retrieved.':'No recall record.');
  $('agent-condition-changes').replaceChildren();
  const conditions=run?.operating_conditions;
  if(conditions){
    for(const [key,label] of [['devices','Inventory'],['commute_priority','Commute priority'],['water_budget_l','Water budget (L)'],['start_hour','Start hour'],['end_hour','End hour']]){
      const format=v=>v==null?'Not set':typeof v==='boolean'?(v?'On':'Off'):String(v);
      const p=document.createElement('p');p.textContent=`${label}: Inherited ${format(conditions.inherited?.[key])} → Current ${format(conditions.constraints[key])}`;$('agent-condition-changes').append(p);
    }
  }
}
async function api(url,body) {
  url=url.replace('/api/agent/','/api/cool-sydney/');
  const response=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);return result;
}
async function refresh() {
  const s=await api('/api/agent/status');replayMode=s.replay_mode===true;date=s.date||date;$('agent-date').textContent=date;
  const selected=s.providers?.[$('agent-provider').value];
  $('agent-trace-notice').hidden=s.trace_version>=5;
  $('agent-trace-notice').textContent=s.trace_version>=5?'':'The server on port 8765 is outdated. Restart it to enable conversation context, survey allocation and JSON export.';
  const blockers=[];
  if(replayMode){blockers.push(`Recorded demo · ${s.snapshot?.runs?.length||0} runs · read-only. Select a run to inspect its prompts, SQL and results.`);$('agent-follow-latest').checked=false;$('agent-run').textContent='Recorded demo';$('agent-show-date').disabled=true;}
  if(!replayMode){
  if(polling)blockers.push('The previous request is still running.');
  if(!s.conversation_supported)blockers.push('Restart the server on port 8765 to enable follow-up conversations.');
  if(!s.dependency_installed)blockers.push('LangGraph is not installed.');
  if(!selected?.configured)blockers.push(`${$('agent-provider').value==='gemini'?'Gemini':'NVIDIA'} API key is not loaded. Configure .env and restart the server on port 8765.`);
  if(!s.catalog_ready)blockers.push(`Could not read data catalog: ${s.catalog_error}`);
  }
  $('agent-status').textContent=replayMode?blockers[0]:blockers.length?'Cannot send: '+blockers.join(' '):'Ready · Enter a question and click Send.';
  $('agent-run').disabled=true;$('agent-run').title=blockers.join(' ');
  if(s.catalog_ready)$('agent-catalog').textContent=JSON.stringify(await api('/api/agent/catalog'),null,2);
  try{graphStructure=await api('/api/agent/graph');graphView.paint(graphRun?.graph||graphStructure,graphRun);}
  catch(error){$('agent-graph-status').textContent=`Showing the bundled graph. Could not retrieve the live structure: ${error.message}`;}
  await Promise.all([refreshMemories(),refreshHistory().catch(error=>{$('agent-run-id').textContent=`Could not list runs: ${error.message}`;})]);
  $('agent-run').disabled=blockers.length>0;
}
function paint(run) {
  graphRun=run;paintContinuation();graphView.paint(run.graph||graphStructure,run);
  const version=JSON.stringify([run.id,run.status,run.events.length]);if(version===paintedVersion)return;paintedVersion=version;
  paintWorkflow(run);
  $('agent-run-id').textContent=`run ${run.id} · ${run.date} · ${run.status}`;
  const memoryEvent=run.events.filter(e=>['memory_saved','memory_save_error'].includes(e.type)).at(-1);
  $('agent-memory-status').textContent=memoryEvent?(memoryEvent.type==='memory_saved'?`Saved to Meterless: ${memoryEvent.memory_id}`:`Memory save failed: ${memoryEvent.error}. Conversation context remains in this run; cross-conversation memory is unavailable.`):'';
  const c=run.operating_conditions?.constraints;
  $('agent-conditions').textContent=c?`Inventory ${c.devices??'Not set'} units · Commute priority ${c.commute_priority?'On':'Off'} · Water budget ${c.water_budget_l??'Not set'} L`:'';
  $('agent-allocation').replaceChildren();
  if(run.allocation)paintAllocation(run.allocation);
  $('agent-answer').textContent=run.allocation?planExplanation(run.allocation):run.answer||run.error||'Retrieving evidence…';
  $('agent-trace').replaceChildren(...run.events.map(event=>{
    const li=document.createElement('li'),details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');
    summary.textContent=`${event.seq}. ${event.type}${event.name?' · '+event.name:''} · ${event.at.slice(11,19)}`;
    pre.textContent=JSON.stringify(event,null,2);details.append(summary,pre);li.append(details);return li;
  }));
  $('agent-remember').disabled=replayMode||run.status!=='completed';
}
function paintContinuation(){
  const previous=$('agent-continue').checked&&graphRun?.status==='completed'?graphRun:null;
  $('agent-context-note').textContent=previous?`Continuing: ${previous.question.slice(0,130)} · ${previous.candidates?.site_ids?.length||0} selected sites. Conditions and the last plan carry forward.`:'New conversation. Saved operating preferences may still be recalled from Meterless.';
}
$('agent-continue').addEventListener('change',paintContinuation);
function paintAllocation(plan){renderCalculatedPlan($('agent-allocation'),plan);}
$('agent-run').addEventListener('click',async()=>{
  if(!$('agent-question').value.trim()){$('agent-status').textContent='Enter a question.';$('agent-question').focus();return;}
  if(polling||replayMode)return;
  $('agent-follow-latest').checked=true;
  polling=true;$('agent-history').disabled=true;$('agent-run').disabled=true;$('agent-remember').disabled=true;$('agent-answer').textContent='Starting run…';$('agent-trace').replaceChildren();paintWorkflow(null);
  try {
    const started=await api('/api/agent/runs',{question:$('agent-question').value,date,provider:$('agent-provider').value,devices:$('agent-devices').value.trim()===''?null:Number($('agent-devices').value),remember_request:$('agent-remember-request').checked,previous_run_id:$('agent-continue').checked&&graphRun?.status==='completed'?graphRun.id:null});runId=started.id;$('agent-devices').value='';
    for(let i=0;i<65;i++) {
      const run=await api(`/api/agent/runs/${runId}`);paint(run);
      if(!['queued','running'].includes(run.status))break;
      await new Promise(resolve=>setTimeout(resolve,3000));
    }
  } catch(error){$('agent-answer').textContent=error.message;}
  finally{polling=false;$('agent-history').disabled=false;refresh().catch(error=>{$('agent-status').textContent=error.message;});}
});
$('agent-history').addEventListener('change',async()=>{
  $('agent-follow-latest').checked=false;
  const selected=$('agent-history').value;if(!selected||polling)return;
  try {const run=await api(`/api/agent/runs/${selected}`);if($('agent-history').value!==selected)return;runId=selected;paint(run);}
  catch(error){$('agent-answer').textContent=error.message;}
});
$('agent-provider').addEventListener('change',()=>refresh().catch(error=>{$('agent-status').textContent=error.message;}));
$('agent-question').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();if(!$('agent-run').disabled)$('agent-run').click();}});
$('agent-refresh').addEventListener('click',()=>{monitorFailures=0;refresh().then(()=>scheduleMonitor(0)).catch(error=>{$('agent-status').textContent=error.message;});});
$('agent-remember').addEventListener('click',async()=>{
  if(!runId||replayMode)return;
  $('agent-remember').disabled=true;
  try {const result=await api(`/api/agent/runs/${runId}/memory`,{text:$('agent-memory').value});paint(await api(`/api/agent/runs/${runId}`));await refreshMemories();$('agent-status').textContent=`Meterless ${result.memory_id} saved. Available to future requests.`;}
  catch(error){$('agent-status').textContent=error.message;}
  finally{$('agent-remember').disabled=false;}
});
paintWorkflow(null);
refresh().then(()=>scheduleMonitor(0)).catch(error=>{$('agent-status').textContent=`${error.message} Restart the server and click Refresh.`;$('agent-graph-status').textContent='Showing the bundled graph. Live server connection unavailable.';});

$('agent-show-date').addEventListener('click',()=>window.open('http://127.0.0.1:8765/','_blank','noopener'));
let monitorBusy=false,monitorTimer=null,monitorFailures=0;
function scheduleMonitor(delay){clearTimeout(monitorTimer);monitorTimer=setTimeout(monitorTick,delay);}
async function monitorTick(){
  if(monitorBusy||document.hidden)return;
  if(polling){scheduleMonitor(3000);return;}
  const active=graphRun&&['queued','running'].includes(graphRun.status);
  if(!$('agent-follow-latest').checked&&!active)return;
  monitorBusy=true;let next=30000;
  try {
    if(active){
      const run=await api(`/api/agent/runs/${graphRun.id}`);paint(run);
      if(['queued','running'].includes(run.status))next=3000;
      else await Promise.all([refreshHistory(),refreshMemories()]);
    }else{
      const runs=await api('/api/agent/runs');await refreshHistory(runs);
      const latest=runs[0];
      if(latest&&latest.id!==runId){const run=await api(`/api/agent/runs/${latest.id}`);runId=latest.id;paint(run);if(['queued','running'].includes(run.status))next=3000;else await refreshMemories();}
    }
    monitorFailures=0;
  }catch(error){
    monitorFailures++;next=Math.min(60000,15000*monitorFailures);
    $('agent-status').textContent=`${error.message}${monitorFailures>=3?' Automatic polling stopped. Reconnect and click Refresh.':''}`;
  }finally{monitorBusy=false;if(monitorFailures<3)scheduleMonitor(next);}
}
$('agent-follow-latest').addEventListener('change',()=>{if($('agent-follow-latest').checked){monitorFailures=0;scheduleMonitor(0);}else clearTimeout(monitorTimer);});
document.addEventListener?.('visibilitychange',()=>{if(document.hidden)clearTimeout(monitorTimer);else if(monitorFailures<3)scheduleMonitor(0);});
