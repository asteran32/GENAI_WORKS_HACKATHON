const $=id=>document.getElementById(id);
let date='2025-12-19',busy=false,previousRun=null,initialized=false;
function contextNote(){ $('agent-context-note').textContent=$('agent-continue').checked&&previousRun?`Continue: ${previousRun.question.slice(0,100)}`:'New conversation. Saved operating preferences may still apply.'; }
$('agent-continue').addEventListener('change',contextNote);
async function api(url,body){
  const response=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data;
}
async function refresh(){
  const status=await api('/api/agent/status');date=status.date||date;$('agent-date').textContent=date;
  const ready=status.dependency_installed&&status.model_configured&&status.catalog_ready;
  $('agent-status').textContent=ready?'Ready to plan.':'Planning service unavailable. Ask the operator to check its status.';
  $('agent-run').disabled=busy||!ready;
  if(!initialized){const runs=await api('/api/agent/runs');previousRun=runs.find(r=>r.date===date&&r.status==='completed')||null;initialized=true;contextNote();}
}
function paint(run){
  if(run.status==='completed'){previousRun=run;contextNote();}
  const c=run.operating_conditions?.constraints;
  $('agent-conditions').textContent=c?`Inventory ${c.devices??'Not set'} units · Water budget ${c.water_budget_l??'Not set'} L · Commute priority ${c.commute_priority?'On':'Off'}`:'';
  $('agent-allocation').replaceChildren();
  if(run.allocation){
    const list=document.createElement('ul');
    for(const row of run.allocation.allocation){const li=document.createElement('li');li.textContent=`${row.site_id?`Site ${row.site_id} · `:''}${row.name}${row.description?` (${row.description})`:''}: ${row.devices} units${row.change==null?'':` (Change ${row.change>=0?'+':''}${row.change})`}`;list.append(li);}
    $('agent-allocation').append(list);
    const note=document.createElement('p');note.className='hint';note.textContent='Demand-based allocation proposal. Installation positions require site checks.';$('agent-allocation').append(note);
  }
  $('agent-answer').textContent=run.answer||(run.status==='failed'?'Could not create a plan. Ask the operator to inspect this run.':'Reviewing conditions and evidence…');
  const saved=run.events.filter(e=>['memory_saved','memory_save_error'].includes(e.type)).at(-1);
  $('agent-save-notice').textContent=saved?(saved.type==='memory_saved'?'Operating conditions saved for future requests.':'Memory save failed. Continue this conversation to retain its conditions.'):'';
}
$('agent-run').addEventListener('click',async()=>{
  if(busy)return;busy=true;$('agent-run').disabled=true;$('agent-answer').textContent='Requesting a plan…';$('agent-save-notice').textContent='';$('agent-allocation').replaceChildren();$('agent-conditions').textContent='';
  try{
    const started=await api('/api/agent/runs',{question:$('agent-question').value,date,devices:$('agent-devices').value.trim()===''?null:Number($('agent-devices').value),remember_request:$('agent-remember-request').checked,previous_run_id:$('agent-continue').checked?previousRun?.id:null});
    $('agent-devices').value='';
    for(let i=0;i<65;i++){
      const run=await api(`/api/agent/runs/${started.id}`);paint(run);
      if(!['queued','running'].includes(run.status))return;
      await new Promise(resolve=>setTimeout(resolve,3000));
    }
    $('agent-answer').textContent='This run is taking longer than expected. Check its status in the monitor.';
  }catch{$('agent-answer').textContent='Could not process the request. Check the input and service status.';}
  finally{busy=false;refresh().catch(()=>{$('agent-status').textContent='Could not connect to the planning service.';});}
});
$('agent-refresh').addEventListener('click',()=>refresh().catch(()=>{$('agent-status').textContent='Could not connect to the planning service.';}));
$('agent-show-date').addEventListener('click',()=>window.dispatchEvent(new CustomEvent('cool-sydney-analysis-date',{detail:date})));
refresh().catch(()=>{$('agent-status').textContent='Could not connect to the planning service.';});
