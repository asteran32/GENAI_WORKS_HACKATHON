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
function planExplanation(plan,language='ko'){
  const report=allocationReport(plan),c=plan.constraints,format=n=>n.toLocaleString('en-AU'),clock=h=>`${String(h).padStart(2,'0')}:00`;
  const active=plan.schedule.filter(h=>h.active_minutes>0);
  const eligible=(plan.assumptions?.commute_hours||[]).filter(h=>h>=plan.operating_hours.start_hour&&h<plan.operating_hours.end_hour);
  const changes=report.rows.filter(row=>row.change!=null&&row.change!==0);
  if(language==='en'){
    const lines=[
      `Operating conditions: ${format(report.total_devices)} units · water budget ${c.water_budget_l==null?'not set':format(c.water_budget_l)+' L'} · ${clock(plan.operating_hours.start_hour)}–${clock(plan.operating_hours.end_hour)}.`,
      `Demand evidence: ${plan.survey_period||'Forecast demand proxies from automatic counting sites'}. ${report.total_passages==null?'':`${format(report.total_passages)} passages during operating hours. `}These are not unique visitors or observations on the analysis date.`,
      c.commute_priority?`Commute priority applied: ${eligible.length?eligible.map(h=>`${clock(h)}–${clock(h+1)}`).join(', ')+' demand weighted ×'+(plan.assumptions?.commute_weight||2):'no commuting hours fall within the operating window'}. Operating hours are unchanged.`:'No commute-priority weighting applied.',
      'Units are allocated as integers in proportion to demand scores during operating hours. Water is assigned to the hours with the highest total weighted demand first.',
      `Proposed operation: ${active.length?active.map(h=>`${clock(h.hour)}–${clock(h.hour+1)}: ${h.active_minutes} spray minutes`).join(', '):'no spraying'}. Total water usage: ${format(report.total_water_l)} L.`
    ];
    if(report.rows.some(row=>row.change!=null))lines.push(changes.length?`Changes from the previous plan: ${changes.map(row=>`${row.site_id?'Site '+row.site_id:row.name} ${row.devices-row.change}→${row.devices} units (${row.change>0?'+':''}${row.change})`).join(', ')}. Other retained sites keep the same unit counts.`:'Unit counts at each site are unchanged from the previous plan.');
    if(plan.comparison?.schedule_changed===false)lines.push('The operating schedule is unchanged from the previous plan.');
    lines.push(`Water usage assumes ${plan.assumptions?.water_l_per_device_hour??12} L per unit-hour. Weather, shade, water and power access, footpath clearance, and actual cooling beneficiaries are not modeled in this allocation.`);
    return lines.join('\n\n');
  }
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
module.exports={orderAllocations,allocationReport,planExplanation,renderCalculatedPlan};
