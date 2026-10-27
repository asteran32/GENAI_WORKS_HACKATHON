'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {exportPlan,publishPlan,readPlan,validatePlan,point}=require('../agent-plan');
const {allocateSurveyFog}=require('../fog-allocation');
const {createService}=require('../service');
const id='12345678-1234-1234-1234-123456789abc';
const catalog={database:'cool_sydney_0123456789abcdef',catalog_version:'test',tables:[{name:'survey_walkingcountsites_0',qualified_name:'cool_sydney_0123456789abcdef.survey_walkingcountsites_0'}]};
const allocation=()=>allocateSurveyFog({date:'2025-12-19',survey_period:'2025 - Weekday - October',read_source:'zetaris',sql_event:11,sites:[{id:'survey-50',site_id:50,name:'Park Street',description:'George to Pitt',rows:Array.from({length:18},(_,i)=>({hour:i+6,passages:200}))},{id:'survey-235',site_id:235,name:'Market Street',description:'Clarence to York',rows:Array.from({length:18},(_,i)=>({hour:i+6,passages:300}))}]},{constraints:{devices:5,water_budget_l:300,start_hour:10,end_hour:18,commute_priority:false}});
test('export validates JSON, preserves missing coordinates and serves it through frontend APIs',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cool-plan-')),events=[];let service;
  try{
    const run={id,conversation_id:id,date:'2025-12-19',status:'completed',events:[]};
    const plan=await exportPlan({root,run,allocation:allocation(),catalog,signal:new AbortController().signal,emit:(type,data)=>{const e={seq:events.length+1,type,...data};events.push(e);return e;},query:async sql=>{
      assert.match(sql,/Site_ID IN \(235, 50\)/);
      return {columns:['Site_ID','Location','source_geometry_json'],data:[['50','Park Street',JSON.stringify({x:151.207,y:-33.873})]]};
    }});
    assert.equal(plan.totals.units,5);assert.equal(plan.totals.water_l,300);assert.equal(plan.allocations.find(a=>a.site_id===50).units,2);assert.equal(plan.allocations.find(a=>a.site_id===235).units,3);
    assert.equal(plan.allocations.find(a=>a.site_id===50).position.kind,'survey-site-reference');assert.equal(plan.allocations.find(a=>a.site_id===235).position,null);assert.deepEqual(plan.unmapped_site_ids,[235]);
    assert.deepEqual(readPlan(root,id),plan);assert.equal(readPlan(root),null,'unpublished plans cannot become latest');
    fs.mkdirSync(path.join(root,'agent-runs'));fs.writeFileSync(path.join(root,'agent-runs',id+'.json'),JSON.stringify(run));publishPlan(root,plan);
    service=createService({directory:root,env:{}});
    assert.deepEqual(await service.dispatch('GET','/api/agent/plans/latest'),{plan});
    assert.deepEqual(await service.dispatch('GET',`/api/agent/runs/${id}/plan`),plan);
    const broken=structuredClone(plan);broken.totals.units=6;assert.throws(()=>validatePlan(broken),/totals/);
    broken.totals.units=5;broken.constraints.water_budget_l=299;assert.throws(()=>validatePlan(broken),/budget/);
    assert.throws(()=>readPlan(root,'../../.env'),/Invalid/);
    const {planMarkers}=await import('../src/agent-plan-view.mjs');
    const active=plan.allocations[0].schedule.find(s=>s.active_minutes>0).hour_local;
    const markers=planMarkers(plan,'2025-12-19',active);assert.equal(markers.length,1);assert.equal(markers[0].units,2);assert.equal(markers[0].active,true);
    assert.equal(planMarkers(plan,'2026-10-28',active)[0].active,false);
    assert.equal(planMarkers(plan,'2025-12-19',23)[0].active,false);
    assert.ok(events.some(e=>e.type==='plan_positions'));assert.ok(events.some(e=>e.type==='plan_exported'));
  }finally{service?.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('projected or invalid coordinates are never interpreted as longitude and latitude',()=>{
  for(const value of ['bad',JSON.stringify({x:335000,y:6200000}),JSON.stringify({x:151,y:-33,spatialReference:{wkid:3857}}),JSON.stringify({x:'151',y:'-33'})])assert.equal(point(value),null);
});

test('recorded ten-site scenario keeps arithmetic exact and applies the actual commute request',()=>{
  const {resolveConstraints}=require('../fog-allocation'),{allocationReport,planExplanation}=require('../plan-output');
  const fixture=require('./fixtures/survey-allocation.json');
  const sites=fixture.data.map(values=>{const row=Object.fromEntries(fixture.columns.map((k,i)=>[k,values[i]]));return {id:`survey-${row.SiteID}`,site_id:Number(row.SiteID),name:row.Location,description:row.Description,rows:Array.from({length:18},(_,i)=>({hour:i+6,passages:Number(row[`Time_${String(i+6).padStart(2,'0')}00`])}))};});
  const demand={date:'2025-12-19',survey_period:fixture.period,read_source:'zetaris',sites};
  const initial=resolveConstraints('포그 50대, 물 3,000L, 10시부터 18시까지',[]),baseline=allocateSurveyFog(demand,initial);
  const summary=allocationReport(baseline);
  assert.equal(summary.total_passages,336210);assert.equal(summary.total_devices,50);assert.equal(summary.total_water_l,3000);
  assert.deepEqual(summary.rows.map(r=>r.site_id),[105,43,50,38,102,235,107,36,39,106]);
  const question='출퇴근 시간에 더 많은 사람이 혜택을 받도록 바꿔줘. 다른 조건은 유지하고, 이전 계획에서 무엇이 달라졌는지 보여줘.';
  const conditions=resolveConstraints(question,[],null,{conditions:initial,previous:baseline.allocation,previous_schedule:baseline.schedule});
  assert.equal(conditions.constraints.commute_priority,true);
  const revised=allocateSurveyFog(demand,conditions),report=allocationReport(revised);
  assert.equal(report.total_passages,336210);assert.equal(report.total_demand_score,400410);
  assert.equal(report.rows.find(r=>r.site_id===102).devices,6);assert.equal(report.rows.find(r=>r.site_id===106).devices,3);
  assert.deepEqual(revised.schedule,baseline.schedule);assert.equal(revised.comparison.schedule_changed,false);
  const answer=planExplanation(revised);assert.match(answer,/336,210/);assert.doesNotMatch(answer,/316,210/);assert.match(answer,/Site 102 5→6대/);assert.match(answer,/Site 106 4→3대/);assert.match(answer,/17:00–18:00/);
  assert.equal(resolveConstraints('전체 보행 조사 지점에서 평일 출퇴근 시간대의 보행량이 많은 구간 10곳을 찾아줘',[]).constraints.commute_priority,false);
});
