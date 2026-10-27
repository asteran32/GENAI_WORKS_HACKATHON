'use strict';
const {orderAllocations}=require('./plan-output');
// Area-level scenario proxies, not surveyed installation coordinates or demand counts.
const ZONES=[
  {id:'martin-place',name:'Martin Place',proxy_site_id:'A002'},
  {id:'qvb',name:'QVB',proxy_site_id:'A003'},
  {id:'park-street',name:'Park Street',proxy_site_id:'A004'}
];
function parsePatch(text) {
  text=text.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g,'');
  const patch={};
  if(/-\s*\d+(?:\.\d+)?\s*(?:L\b|lit(?:er|re)s?\b|리터|대(?:\s|$)|(?:fog\s+)?(?:units|devices)\b)/i.test(text))throw new Error('Inventory and water budget cannot be negative.');
  const values=[...text.matchAll(/(\d+)\s*대(?!\d)/g)].map(m=>Number(m[1]));
  for(const m of text.matchAll(/(?:포그|장비)(?:가|는|를)?\s*(\d+)\s*(?:개|대)/g))values.push(Number(m[1]));
  for(const m of text.matchAll(/\b(\d+)\s+(?:fog\s+)?(?:units|devices)\b/gi))values.push(Number(m[1]));
  const unique=[...new Set(values)];
  if(unique.length===1){if(unique[0]>10000)throw new Error('장비 수는 0~10,000대 범위입니다.');patch.devices=unique[0];}
  if(/출퇴근[^.!?]*(고려하지|제외|빼|그만)|no commute/i.test(text))patch.commute_priority=false;
  else if(/출퇴근[^.!?]*(고려해|고려하|우선해|우선하|우선으로|중점|가중|더\s*많은[^.!?]*혜택[^.!?]*(?:바꿔|조정|변경)|혜택[^.!?]*늘려)|(?:prioriti[sz]e|consider)\s+(?:the\s+)?commut|commut[^.!?]*priority|(?:revise|adjust|change)[^.!?]*more\s+people\s+benefit[^.!?]*commuting\s+hours/i.test(text))patch.commute_priority=true;
  const water=[...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:L\b|lit(?:er|re)s?\b|리터)/gi)];if(water.length===1)patch.water_budget_l=Number(water[0][1]);
  const hours=[...text.matchAll(/(?<![\d-])(\d{1,2})(?::00|시)?\s*(?:부터|~|–|—|-|to)\s*(\d{1,2})(?::00|시)/gi)];
  if(hours.length===1){const start=Number(hours[0][1]),end=Number(hours[0][2]);if(start<0||end>24||start>=end)throw new Error('운영 시간은 시작보다 종료가 늦은 0~24시 범위여야 합니다.');patch.start_hour=start;patch.end_hour=end;}
  return patch;
}
function memorySnapshot(memory) {
  const index=memory.content?.indexOf('[운영 조건 JSON] ');if(index==null||index<0)return null;
  try {const v=JSON.parse(memory.content.slice(index+'[운영 조건 JSON] '.length));return v && typeof v==='object'?v:null;}catch{return null;}
}
function resolveConstraints(question,memories,explicit,conversation) {
  let constraints={devices:null,commute_priority:false,water_budget_l:null},previous=null;
  for(const memory of [...memories].reverse()) {
    const snapshot=memorySnapshot(memory);
    if(snapshot?.constraints){const c=snapshot.constraints;if(Number.isInteger(c.devices)&&c.devices>=0&&c.devices<=10000)constraints.devices=c.devices;
      if(typeof c.commute_priority==='boolean'&&(snapshot.context_version||snapshot.plan||!snapshot.request||parsePatch(snapshot.request).commute_priority!==undefined))constraints.commute_priority=c.commute_priority;
      if(Number.isInteger(c.start_hour)&&Number.isInteger(c.end_hour)&&c.start_hour>=0&&c.end_hour<=24&&c.start_hour<c.end_hour){constraints.start_hour=c.start_hour;constraints.end_hour=c.end_hour;}
      if(c.water_budget_l===null||Number.isFinite(c.water_budget_l)&&c.water_budget_l>=0)constraints.water_budget_l=c.water_budget_l;
      if(Array.isArray(snapshot.plan))previous=snapshot.plan;
    }
  }
  if(conversation?.conditions){constraints={...constraints,...conversation.conditions.constraints};previous=conversation.previous;}
  const inherited={...constraints};constraints={...constraints,...parsePatch(question)};
  if(explicit!=null){if(!Number.isInteger(explicit)||explicit<0||explicit>10000)throw new Error('장비 수는 0~10,000 정수여야 합니다.');constraints.devices=explicit;}
  return {constraints,inherited,previous,previous_schedule:conversation?.previous_schedule||null};
}
function allocateFog(forecast,conditions,options={}) {
  const {constraints,previous}=conditions,n=constraints.devices;
  if(!Number.isInteger(n))throw new Error('사용할 장비 수를 먼저 알려주세요. 예: 포그 50대');
  if(!forecast.ready)throw new Error('해당 날짜의 보행량 예측이 없습니다.');
  const start=constraints.start_hour??options.start_hour??8,end=constraints.end_hour??options.end_hour??19;
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>24||start>=end)throw new Error('운영 시간은 0~24시 범위로 지정하세요.');
  const peak=h=>(h>=7&&h<10)||(h>=16&&h<19);
  const selected=options.zone_ids||ZONES.map(z=>z.id);
  if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length||selected.some(id=>!ZONES.some(z=>z.id===id)))throw new Error('지원되는 구역을 중복 없이 지정하세요.');
  const zones=ZONES.filter(z=>selected.includes(z.id)).map(z=>{
    const rows=forecast.rows.filter(r=>r.site_id===z.proxy_site_id&&r.hour>=start&&r.hour<end);
    if(rows.length!==end-start||rows.some(r=>!Number.isFinite(r.predicted_passages)||r.predicted_passages<0))throw new Error('구역 대리 지점의 시간별 예측이 불완전합니다.');
    return {...z,score:rows.reduce((sum,r)=>sum+r.predicted_passages*(constraints.commute_priority&&peak(r.hour)?2:1),0),rows};
  });
  return calculateAllocation(zones,conditions,start,end,{date:forecast.date,model_id:forecast.manifest.model_id,evidence_type:'forecast-proxy-allocation',
    limitations:['Unverified area proxies: Martin Place ← Elizabeth St; QVB ← Market St; Park Street ← Park St.']});
}
function allocateSurveyFog(demand,conditions,options={}) {
  const start=conditions.constraints.start_hour??options.start_hour??10,end=conditions.constraints.end_hour??options.end_hour??18;
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<6||end>24||start>=end)throw new Error('Survey operating hours must be within 06:00–24:00.');
  const peak=h=>(h>=8&&h<10)||(h>=17&&h<19);
  const zones=demand.sites.map(site=>{
    const rows=site.rows.filter(r=>r.hour>=start&&r.hour<end).map(r=>({...r,predicted_passages:r.passages}));
    if(rows.length!==end-start||rows.some(r=>!Number.isFinite(r.passages)||r.passages<0))throw new Error(`Missing hourly observations for Site ${site.site_id}; do not treat missing data as zero.`);
    return {...site,rows,score:rows.reduce((sum,r)=>sum+r.passages*(conditions.constraints.commute_priority&&peak(r.hour)?2:1),0)};
  });
  return calculateAllocation(zones,conditions,start,end,{date:demand.date,survey_period:demand.survey_period,evidence_type:'survey-based-allocation-scenario',
    demand_source:demand.read_source,demand_sql_event:demand.sql_event,
    limitations:['Survey-day passages, not observed or forecast demand on the analysis date.',
      'Segment-level allocation; installation coordinates, pedestrian clearance and site capacity are unverified.']},peak);
}
function calculateAllocation(zones,conditions,start,end,metadata,peak=h=>(h>=7&&h<10)||(h>=16&&h<19)) {
  const {constraints,previous}=conditions,n=constraints.devices;
  if(!Number.isInteger(n)||n<0||n>10000)throw new Error('Specify an inventory between 0 and 10,000 units.');
  const total=zones.reduce((s,z)=>s+z.score,0);if(total<=0&&n>0)throw new Error('배분에 사용할 수요 근거가 없습니다.');
  let spare=n;
  for(const z of zones){z.exact=total?n*z.score/total:0;z.devices=Math.floor(z.exact);spare-=z.devices;}
  for(const z of [...zones].sort((a,b)=>(b.exact-b.devices)-(a.exact-a.devices)||a.id.localeCompare(b.id)).slice(0,spare))z.devices++;
  const fullWater=n*12*(end-start);let water=constraints.water_budget_l??fullWater;
  if(!Number.isFinite(water)||water<0)throw new Error('물 예산은 0 이상이어야 합니다.');
  const hours=Array.from({length:end-start},(_,i)=>start+i).map(hour=>({hour,score:zones.reduce((s,z)=>s+z.rows.find(r=>r.hour===hour).predicted_passages,0)*(constraints.commute_priority&&peak(hour)?2:1)}));
  const schedule=[];
  for(const item of [...hours].sort((a,b)=>b.score-a.score||a.hour-b.hour)){
    const minutes=n?Math.min(60,Math.floor((water/(n*12))*60+1e-9)):0,used=n*12*minutes/60;water=Math.max(0,water-used);
    schedule.push({hour:item.hour,active_minutes:minutes,water_l:used});
  }
  const allocation=orderAllocations(zones.map(({id,name,description,site_id,proxy_site_id,devices,score,rows})=>({id,name,description,site_id,proxy_site_id,devices,operating_passages:rows.reduce((sum,r)=>sum+r.predicted_passages,0),demand_score:Math.round(score),change:previous?devices-(previous.find(p=>p.id===id)?.devices||0):null})));
  return {...metadata,method:'largest-remainder proportional allocation',constraints,operating_hours:{start_hour:start,end_hour:end},allocation,schedule:schedule.sort((a,b)=>a.hour-b.hour),
    total_operating_passages:allocation.reduce((sum,row)=>sum+row.operating_passages,0),total_demand_score:allocation.reduce((sum,row)=>sum+row.demand_score,0),
    total_devices:allocation.reduce((s,z)=>s+z.devices,0),total_water_l:schedule.reduce((s,h)=>s+h.water_l,0),full_time_water_l:fullWater,
    comparison:previous?{schedule_changed:conditions.previous_schedule?conditions.previous_schedule.length!==schedule.length||schedule.some(row=>conditions.previous_schedule.find(old=>old.hour===row.hour)?.active_minutes!==row.active_minutes):null,previous_devices:previous.reduce((sum,p)=>sum+p.devices,0),device_change:n-previous.reduce((sum,p)=>sum+p.devices,0),removed_sites:previous.filter(p=>!allocation.some(a=>a.id===p.id)).map(p=>({id:p.id,devices:0,change:-p.devices}))}:null,
    assumptions:{water_l_per_device_hour:12,commute_weight:constraints.commute_priority?2:1,commute_hours:[...Array(24).keys()].filter(peak),schedule:'All allocated units share the hourly spray duration; highest weighted-demand hours receive water first.'},
    limitations:[...metadata.limitations,'Demand-proportional scenario, not global optimization or measured cooling.',
      'Water access, power, overlapping devices, weather and shade are not modeled.',
      '12 L per unit-hour is an assumption. Active minutes are total spraying time within each hour, not a device control command.',
      'Commute priority doubles demand weights only within the unchanged operating window.']};
}
module.exports={parsePatch,resolveConstraints,allocateFog,allocateSurveyFog,memorySnapshot,ZONES};
