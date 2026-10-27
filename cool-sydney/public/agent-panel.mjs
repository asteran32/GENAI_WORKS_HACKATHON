'use strict';
// Shared by the calculation backend and both browser bundles. Numeric output
// is derived from tool results; model-authored prose is retained in the trace.
function orderAllocations(rows){
  return [...rows].sort((a,b)=>(b.devices??b.units)-(a.devices??a.units)||(b.demand_score??0)-(a.demand_score??0)||String(a.site_id??a.id).localeCompare(String(b.site_id??b.id),'en',{numeric:true}));
}
function allocationReport(plan){
  const rows=orderAllocations(plan.allocation).map(row=>({...row,operating_passages:row.operating_passages??(plan.constraints.commute_priority?null:row.demand_score)}));
  const units=rows.reduce((sum,row)=>sum+row.devices,0),water=plan.schedule.reduce((sum,row)=>sum+row.water_l,0);
  if(!Number.isFinite(units)||units!==plan.total_devices||units!==plan.constraints.devices||!Number.isFinite(water)||Math.abs(water-plan.total_water_l)>1e-6)throw new Error('Plan totals do not match the calculation rows.');
  const passages=rows.every(row=>Number.isFinite(row.operating_passages))?rows.reduce((sum,row)=>sum+row.operating_passages,0):null;
  return {rows,total_devices:units,total_water_l:water,total_passages:passages,total_demand_score:rows.reduce((sum,row)=>sum+row.demand_score,0)};
}
function planExplanation(plan){
  const report=allocationReport(plan),c=plan.constraints,format=n=>n.toLocaleString('en-AU'),clock=h=>`${String(h).padStart(2,'0')}:00`;
  const active=plan.schedule.filter(h=>h.active_minutes>0);
  const eligible=(plan.assumptions?.commute_hours||[]).filter(h=>h>=plan.operating_hours.start_hour&&h<plan.operating_hours.end_hour);
  const changes=report.rows.filter(row=>row.change!=null&&row.change!==0);
  const lines=[
    `운영 조건: 장비 ${format(report.total_devices)}대 · 물 예산 ${c.water_budget_l==null?'미지정':format(c.water_budget_l)+'L'} · ${clock(plan.operating_hours.start_hour)}–${clock(plan.operating_hours.end_hour)}.`,
    `수요 근거: ${plan.survey_period||'자동 계수 지점의 예측 대리 수요'}. ${report.total_passages==null?'':`운영시간 내 통과량 합계 ${format(report.total_passages)}회. `}고유 방문자 수나 분석일 당일의 실측값을 뜻하지 않습니다.`,
    c.commute_priority?`출퇴근 우선 적용: ${eligible.length?eligible.map(h=>`${clock(h)}–${clock(h+1)}`).join(', ')+'의 수요에 '+(plan.assumptions?.commute_weight||2)+'배 가중치.':'운영시간 안에 출퇴근 시간대가 없습니다.'} 운영시간을 확장하지 않았습니다.`:'출퇴근 우선 가중치는 적용하지 않았습니다.',
    '배치 대수는 운영시간 내 수요 점수에 비례해 정수로 배분했습니다. 물 예산은 전체 수요 점수가 높은 시간대부터 사용합니다.',
    `운영 제안: ${active.length?active.map(h=>`${clock(h.hour)}–${clock(h.hour+1)} ${h.active_minutes}분`).join(', '):'분사하지 않음'}. 총 물 사용량 ${format(report.total_water_l)}L.`
  ];
  if(report.rows.some(row=>row.change!=null))lines.push(changes.length?`이전 계획 대비: ${changes.map(row=>`${row.site_id?'Site '+row.site_id:row.name} ${row.devices-row.change}→${row.devices}대 (${row.change>0?'+':''}${row.change})`).join(', ')}. 나머지 지점의 대수는 같습니다.`:'이전 계획과 지점별 배치 대수는 같습니다.');
  if(plan.comparison?.schedule_changed===false)lines.push('운영 스케줄은 이전과 같습니다.');
  lines.push(`물 사용량은 장비당 ${plan.assumptions?.water_l_per_device_hour??12} L/h 가정입니다. 기상·그늘·급수·전원·보도 폭과 실제 냉각 수혜 인원은 이 배분 계산에 반영하지 않았습니다.`);
  return lines.join('\n\n');
}
function renderCalculatedPlan(target,plan){
  const report=allocationReport(plan),format=n=>n==null?'—':n.toLocaleString('en-AU');
  const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);return node;};
  target.replaceChildren();
  target.append(el('h3','Calculated allocation'),el('p',`Sorted by units ↓, then demand score ↓ · ${plan.survey_period||'Forecast proxies'}`));
  const wrap=el('div');wrap.className='trace-table allocation-table';
  const table=el('table'),head=el('thead'),header=el('tr'),body=el('tbody'),foot=el('tfoot');
  const labels=['Rank','Site','Street / segment','Passages',...(plan.constraints.commute_priority?['Weighted score']:[]),'Units ↓','Change'];
  for(const label of labels)header.append(el('th',label));head.append(header);
  for(const [i,row]of report.rows.entries()){
    const tr=el('tr');tr.dataset.siteId=String(row.site_id??row.id);
    for(const value of [i+1,row.site_id??row.id,[row.name,row.description].filter(Boolean).join(' · '),format(row.operating_passages),...(plan.constraints.commute_priority?[format(row.demand_score)]:[]),row.devices,row.change==null?'—':`${row.change>=0?'+':''}${row.change}`])tr.append(el('td',value));
    body.append(tr);
  }
  const total=el('tr');for(const value of ['Total','—','—',format(report.total_passages),...(plan.constraints.commute_priority?[format(report.total_demand_score)]:[]),report.total_devices,'—'])total.append(el('th',value));foot.append(total);
  table.append(head,body,foot);wrap.append(table);target.append(wrap);
  const schedule=el('details'),title=el('summary','Calculated hourly schedule'),list=el('ul');
  for(const row of plan.schedule)list.append(el('li',`${String(row.hour).padStart(2,'0')}:00–${String(row.hour+1).padStart(2,'0')}:00 · ${row.active_minutes} spray min · ${format(row.water_l)} L`));
  schedule.append(title,list,el('p',`Total water: ${format(report.total_water_l)} L / budget: ${format(plan.constraints.water_budget_l)} L`));target.append(schedule);
}


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
  $('agent-answer').textContent=run.allocation?planExplanation(run.allocation):run.answer||(run.status==='failed'?'Could not create a plan. Ask the operator to inspect this run.':'Reviewing conditions and evidence…');
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
