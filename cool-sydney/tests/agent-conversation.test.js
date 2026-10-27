'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createAgent}=require('../agent');
const {loadConversation,candidatesFromResult,querySurveyDemand,SURVEY}=require('../agent-context');
const {allocateSurveyFog}=require('../fog-allocation');
const db='cool_sydney_0123456789abcdef',date='2025-12-19',period='2025 - Weekday - October';
const ids=[50,105,107,102,43,106,235,39,38,36];
const catalog={database:db,catalog_version:'test',analysis_date:date,gis_version:'ofm-0123456789abcdef',cbd_version:'cbd-0123456789abcdef',area:{id:'sydney-cbd-harbour'},joins:[],notes:[],tables:[]};
const base=['building','transportation','water','landcover','landuse','poi','walk_nodes','walk_edges','trees','pedestrian_sites','pedestrian_counts','weather'];
catalog.tables=[...base,SURVEY].map(name=>({name,qualified_name:`${db}.${name}`,row_count:0,file_sha256:'hash',dataset_version:'survey-0123456789abcdef',columns:[],limitations:[]}));
const ranking={source:'zetaris',columns:['SiteID','Location','Description','Time_0800','commute_total'],data:ids.map((id,i)=>[String(id),'Street '+id,'Segment '+id,1000-i*50,4000-i*200]),
  sql:`SELECT SiteID, Location, Description, Time_0800, Time_0800 + Time_0900 + Time_1700 + Time_1800 AS commute_total FROM ${db}.${SURVEY} WHERE DateFilter = '${period}' ORDER BY commute_total DESC LIMIT 10`,sql_event:1};
const hourly={columns:['SiteID','Location','Description','DateFilter',...Array.from({length:18},(_,i)=>`Time_${String(i+6).padStart(2,'0')}00`)],
  data:ids.map((id,i)=>[String(id),'Street '+id,'Segment '+id,period,...Array.from({length:18},(_,h)=>String(h+6===17?(i+1)*1000:(10-i)*100))])};
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cool-conversation-'));
  for(const dir of ['catalog',`processed/${catalog.gis_version}`,`processed/bundles/${catalog.cbd_version}`,'processed/walking-surveys/survey-0123456789abcdef'])fs.mkdirSync(path.join(root,dir),{recursive:true});
  const files=base.map(name=>({name:name+'.parquet',rows:0,sha256:'hash'}));
  fs.writeFileSync(path.join(root,'catalog/current.json'),JSON.stringify(catalog));
  fs.writeFileSync(path.join(root,`processed/${catalog.gis_version}/manifest.json`),JSON.stringify({files:files.slice(0,6)}));
  fs.writeFileSync(path.join(root,`processed/bundles/${catalog.cbd_version}/manifest.json`),JSON.stringify({files:files.slice(6),date,components:{buildings:catalog.gis_version}}));
  fs.writeFileSync(path.join(root,'processed/walking-surveys/survey-0123456789abcdef/manifest.json'),JSON.stringify({version:'survey-0123456789abcdef',files:[{name:SURVEY.replace('survey_','')+'.parquet',rows:0,sha256:'hash'}]}));
  return root;
}
const call=(name,args)=>({id:'tool1',type:'function',function:{name,arguments:JSON.stringify(args)}});
test('old ranking SQL recovers the actual ten sites; prose cannot invent candidates',()=>{
  const old={id:'old',status:'completed',date,catalog_version:'test',question:'출퇴근 시간대 보행량이 많은 10곳을 찾아줘',answer:'Site 999 is best',events:[{type:'tool_result',name:'execute_readonly_sql',result:ranking}],operating_conditions:{constraints:{devices:null,commute_priority:true,water_budget_l:null},inherited:{commute_priority:false}}};
  const context=loadConversation('old',()=>old,catalog);
  assert.deepEqual(context.candidates.site_ids,ids);assert.equal(context.conditions.constraints.commute_priority,false);
  assert.equal(context.candidates.survey_period,period);assert.equal(context.messages.length,2);
  assert.equal(candidatesFromResult({...ranking,data:[ranking.data[0],ranking.data[0]]},catalog),null);
  assert.equal(candidatesFromResult({...ranking,sql:ranking.sql.replace('2025 - Weekday - October','2026 - Weekday - March')},catalog),null);
  assert.throws(()=>loadConversation('old',()=>({...old,catalog_version:'other'}),catalog),/different/);
  assert.throws(()=>loadConversation('old',()=>({...old,status:'failed'}),catalog),/completed/);
});
test('survey allocation rejects missing observations and invented site IDs',async()=>{
  const selection=candidatesFromResult(ranking,catalog,'rank');
  const options={selection,catalog,query:async()=>hourly,signal:new AbortController().signal,emit:()=>({seq:1}),trace:{}};
  await assert.rejects(querySurveyDemand({...options,options:{site_ids:[999]}}),/verified/);
  await assert.rejects(querySurveyDemand({...options,query:async()=>({...hourly,data:hourly.data.slice(1)})}),/Incomplete/);
  const demand=await querySurveyDemand(options),conditions={constraints:{devices:50,start_hour:10,end_hour:18,water_budget_l:3000}};
  const plan=allocateSurveyFog(demand,conditions);assert.equal(plan.total_devices,50);assert.ok(plan.total_water_l<=3000);assert.equal(plan.allocation.length,10);
  demand.sites[0].rows.find(r=>r.hour===10).passages=null;
  assert.throws(()=>allocateSurveyFog(demand,conditions),/Missing hourly/);
});
test('persisted LangGraph conversation ranks ten sites then allocates, reprioritizes and changes inventory and water',async()=>{
  const root=fixture(),saved=[],queries=[],prompts=[];let memoryOffline=false;
  const deps={root,env:{},memory:{recall:async()=>{if(memoryOffline)throw new Error('offline');return [...saved].reverse();},save:async(c,content)=>{assert.ok(content.length<3900);const memory={id:'m'+saved.length,content};saved.push(memory);return {memory};}},
    query:async sql=>{queries.push(sql);return sql.includes('SiteID IN')?structuredClone(hourly):structuredClone(ranking);},
    model:async messages=>{
      prompts.push(messages);
      if(messages.at(-1).role==='tool'){const result=JSON.parse(messages.at(-1).content);assert.equal(result.error,undefined);return {message:{role:'assistant',content:JSON.stringify(result.result.allocation||'Here are the ten sites.')}};}
      const context=JSON.parse(messages.at(-1).content);
      if(context.question==='Rank ten sites')return {message:{role:'assistant',tool_calls:[call('execute_readonly_sql',{sql:ranking.sql})]}};
      assert.deepEqual([...context.verified_candidates.site_ids].sort((a,b)=>a-b),[...ids].sort((a,b)=>a-b));assert.ok(messages.some(m=>m.role==='assistant'));
      return {message:{role:'assistant',tool_calls:[call('allocate_fog',{})]}};
    }};
  let agent=createAgent(deps);
  async function run(question,previous_run_id){const job=await agent.start({question,date,previous_run_id,remember_request:true});for(let i=0;i<200;i++){const r=agent.get(job.id);if(!['running','queued'].includes(r.status)){assert.equal(r.status,'completed',r.error);assert.equal(r.events.filter(e=>e.type==='model_request').length,2);return r;}await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('run timed out');}
  try{
    const first=await run('Rank ten sites');assert.deepEqual(first.candidates.site_ids,ids);assert.equal(agent.latestPlan(),null);
    agent.close();agent=createAgent(deps); // Disk state must survive a service restart.
    const second=await run('그 10곳에 포그 50대를 배치해줘. 10시부터 18시까지, 물은 3000L.',first.id);
    assert.equal(second.previous_run_id,first.id);assert.equal(second.conversation_id,first.id);assert.equal(second.allocation.total_devices,50);
    assert.deepEqual(second.allocation.allocation.map(r=>r.site_id).sort((a,b)=>a-b),[...ids].sort((a,b)=>a-b));assert.ok(second.allocation.allocation.every(r=>r.proxy_site_id===undefined));
    assert.equal(second.plan.schema_version,'cool-sydney.fog-plan.v1');assert.equal(second.plan.allocations.length,10);assert.deepEqual(agent.latestPlan(),second.plan);assert.deepEqual(agent.plan(second.id),second.plan);
    assert.deepEqual(second.events.filter(e=>e.type==='node_start').slice(-2).map(e=>e.node),['finish','export_plan']);
    assert.equal(second.allocation.survey_period,period);assert.ok(second.allocation.total_water_l<=3000);
    memoryOffline=true; // The explicit conversation remains usable if Meterless recall is unavailable.
    const third=await run('출퇴근 시간에 더 많은 사람이 혜택을 받도록 바꿔줘. 다른 조건은 유지하고, 이전 계획에서 무엇이 달라졌는지 보여줘.',second.id);
    assert.equal(third.operating_conditions.constraints.commute_priority,true);assert.equal(third.allocation.total_devices,50);
    assert.deepEqual(third.allocation.operating_hours,{start_hour:10,end_hour:18});assert.ok(third.allocation.allocation.some(r=>r.change!==0));
    assert.equal(third.allocation.schedule.find(h=>h.hour===17).active_minutes,60);
    const fourth=await run('장비는 30대로 바꿔줘.',third.id);
    assert.equal(fourth.allocation.total_devices,30);assert.equal(fourth.allocation.constraints.water_budget_l,3000);assert.equal(fourth.allocation.comparison.device_change,-20);
    const fifth=await run('물도 하루 1,500L만 사용할 수 있어. 어느 구간과 시간대를 우선 유지하고, 어디를 줄여야 할까?',fourth.id);
    assert.equal(fifth.allocation.total_devices,30);assert.ok(fifth.allocation.total_water_l<=1500);assert.equal(fifth.allocation.constraints.commute_priority,true);
    assert.equal(queries.length,5);assert.ok(queries.slice(1).every(q=>q.includes(`DateFilter = '${period}'`)&&q.match(/IN \(([^)]+)\)/)[1].split(',').map(Number).sort((a,b)=>a-b).join(',')===[...ids].sort((a,b)=>a-b).join(',')));
    assert.equal(saved.length,5);const memory=JSON.parse(saved.at(-1).content.split('[운영 조건 JSON] ')[1]);assert.deepEqual([...memory.candidates.site_ids].sort((a,b)=>a-b),[...ids].sort((a,b)=>a-b));
    await assert.rejects(agent.start({question:'x',date,previous_run_id:'../.env'}));
    assert.ok(fifth.events.some(e=>e.type==='survey_read'&&e.data.length===10));
  }finally{agent.close();fs.rmSync(root,{recursive:true,force:true});}
});
