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
  if(run.status==='completed'){previousRun=run;contextNote();if(run.plan&&$('agent-plan-auto').checked)loadLatestPlan();}
  const c=run.operating_conditions?.constraints;
  $('agent-conditions').textContent=c?`Inventory ${c.devices??'Not set'} units · Water budget ${c.water_budget_l??'Not set'} L · Commute priority ${c.commute_priority?'On':'Off'}`:'';
  $('agent-allocation').replaceChildren();
  if(run.allocation)renderCalculatedPlan($('agent-allocation'),run.allocation);
  $('agent-answer').textContent=run.allocation?planExplanation(run.allocation,run.response_language):run.answer||(run.status==='failed'?'Could not create a plan. Ask the operator to inspect this run.':'Reviewing conditions and evidence…');
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

let appliedPlanId=null,planPollFailures=0,planTimer=null,planLoading=false;
async function loadLatestPlan(){
  if(planLoading)return;planLoading=true;
  try{
    const {plan}=await api('/api/agent/plans/latest');planPollFailures=0;
    if(!plan){$('agent-plan-status').textContent='No exported allocation plan yet.';return;}
    if(plan.schema_version!=='cool-sydney.fog-plan.v1')throw new Error('Unsupported plan format.');
    $('agent-plan-json').hidden=false;$('agent-plan-json').href=`/api/agent/runs/${plan.run_id}/plan`;$('agent-plan-json').download=plan.plan_id+'.json';
    const mapped=plan.allocations.filter(a=>a.position&&a.units>0),missing=plan.allocations.filter(a=>!a.position&&a.units>0);
    $('agent-plan-status').textContent=`Plan ${plan.analysis_date}: ${plan.totals.units} units · ${plan.totals.water_l.toFixed(1)} L. ${mapped.length} reference markers; ${missing.length} sites (${missing.reduce((n,a)=>n+a.units,0)} units) need coordinates. Exact device layout is not yet specified.`;
    if(appliedPlanId!==plan.plan_id){appliedPlanId=plan.plan_id;window.coolSydneyPlan=plan;window.dispatchEvent(new CustomEvent('cool-sydney-plan',{detail:plan}));}
  }catch(error){planPollFailures++;$('agent-plan-status').textContent=`Plan sync unavailable: ${error.message}${planPollFailures>=3?' Automatic polling stopped; click Load latest plan to retry.':''}`;}
  finally{planLoading=false;}
}
async function pollPlan(){clearTimeout(planTimer);if(document.hidden||!$('agent-plan-auto').checked)return;await loadLatestPlan();if(planPollFailures<3)planTimer=setTimeout(pollPlan,15000);}
$('agent-plan-load').addEventListener('click',()=>{planPollFailures=0;loadLatestPlan().then(()=>{if($('agent-plan-auto').checked){clearTimeout(planTimer);planTimer=setTimeout(pollPlan,15000);}});});
$('agent-plan-auto').addEventListener('change',()=>{clearTimeout(planTimer);if($('agent-plan-auto').checked){planPollFailures=0;pollPlan();}});
document.addEventListener('visibilitychange',()=>{clearTimeout(planTimer);if(!document.hidden&&planPollFailures<3)pollPlan();});
pollPlan();
