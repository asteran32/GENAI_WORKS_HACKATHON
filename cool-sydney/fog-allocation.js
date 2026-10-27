'use strict';
// Area-level scenario proxies, not surveyed installation coordinates or demand counts.
const ZONES=[
  {id:'martin-place',name:'Martin Place',proxy_site_id:'A002'},
  {id:'qvb',name:'QVB',proxy_site_id:'A003'},
  {id:'park-street',name:'Park Street',proxy_site_id:'A004'}
];
function parsePatch(text) {
  const patch={};
  const values=[...text.matchAll(/(\d+)\s*대(?!\d)/g)].map(m=>Number(m[1]));
  for(const m of text.matchAll(/(?:포그|장비)(?:가|는|를)?\s*(\d+)\s*(?:개|대)/g))values.push(Number(m[1]));
  for(const m of text.matchAll(/\b(\d+)\s+(?:fog\s+)?(?:units|devices)\b/gi))values.push(Number(m[1]));
  const unique=[...new Set(values)];
  if(unique.length===1){if(unique[0]>10000)throw new Error('장비 수는 0~10,000대 범위입니다.');patch.devices=unique[0];}
  if(/출퇴근[^.!?]*(고려하지|제외|빼|그만)|no commute/i.test(text))patch.commute_priority=false;
  else if(/출퇴근[^.!?]*(고려해|고려하|우선해|우선하|우선으로|중점|가중)|(?:prioriti[sz]e|consider)\s+(?:the\s+)?commut|commut[^.!?]*priority/i.test(text))patch.commute_priority=true;
  const water=[...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:L\b|리터)/gi)];if(water.length===1)patch.water_budget_l=Number(water[0][1]);
  const hours=[...text.matchAll(/(?<![\d-])(\d{1,2})(?::00|시)\s*(?:부터|~|–|—|-|to)\s*(\d{1,2})(?::00|시)/gi)];
  if(hours.length===1){const start=Number(hours[0][1]),end=Number(hours[0][2]);if(start<0||end>24||start>=end)throw new Error('운영 시간은 시작보다 종료가 늦은 0~24시 범위여야 합니다.');patch.start_hour=start;patch.end_hour=end;}
  return patch;
}
function memorySnapshot(memory) {
  const index=memory.content?.indexOf('[운영 조건 JSON] ');if(index==null||index<0)return null;
  try {const v=JSON.parse(memory.content.slice(index+'[운영 조건 JSON] '.length));return v && typeof v==='object'?v:null;}catch{return null;}
}
function resolveConstraints(question,memories,explicit) {
  let constraints={devices:null,commute_priority:false,water_budget_l:null},previous=null;
  for(const memory of [...memories].reverse()) {
    const snapshot=memorySnapshot(memory);
    if(snapshot?.constraints){const c=snapshot.constraints;if(Number.isInteger(c.devices)&&c.devices>=0&&c.devices<=10000)constraints.devices=c.devices;
      if(typeof c.commute_priority==='boolean')constraints.commute_priority=c.commute_priority;
      if(Number.isInteger(c.start_hour)&&Number.isInteger(c.end_hour)&&c.start_hour>=0&&c.end_hour<=24&&c.start_hour<c.end_hour){constraints.start_hour=c.start_hour;constraints.end_hour=c.end_hour;}
      if(c.water_budget_l===null||Number.isFinite(c.water_budget_l)&&c.water_budget_l>=0)constraints.water_budget_l=c.water_budget_l;
      if(Array.isArray(snapshot.plan))previous=snapshot.plan;
    }
  }
  const inherited={...constraints};constraints={...constraints,...parsePatch(question)};
  if(explicit!=null){if(!Number.isInteger(explicit)||explicit<0||explicit>10000)throw new Error('장비 수는 0~10,000 정수여야 합니다.');constraints.devices=explicit;}
  return {constraints,inherited,previous};
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
  const allocation=zones.map(({id,name,proxy_site_id,devices,score})=>({id,name,proxy_site_id,devices,demand_score:Math.round(score),change:previous?.some(p=>p.id===id)?devices-previous.find(p=>p.id===id).devices:null}));
  return {date:forecast.date,evidence_type:'forecast-proxy-allocation',method:'largest-remainder proportional allocation',constraints,operating_hours:{start_hour:start,end_hour:end},allocation,schedule:schedule.sort((a,b)=>a.hour-b.hour),
    total_devices:allocation.reduce((s,z)=>s+z.devices,0),total_water_l:schedule.reduce((s,h)=>s+h.water_l,0),full_time_water_l:fullWater,model_id:forecast.manifest.model_id,
    limitations:['구역별 대리 지점 매핑은 미검증: Martin Place←Elizabeth St, QVB←Market St, Park Street←Park St',
      '정기 보행 조사는 이 배분 계산에 아직 연결되지 않음','구역 단위 수요 비례 배분이며 개별 설치 위치·전역 최적해 아님',
      '급수·전원·통행 폭·장비 간 중복·그늘·기상 영향 미반영','물 사용량은 장비당 12 L/h 가정. active_minutes는 해당 시간 안에서의 총 분사 분량이며 세부 제어 스케줄 아님',
      '출퇴근 우선은 07~10시·16~19시 수요 가중치 2배라는 시나리오 가정']};
}
module.exports={parsePatch,resolveConstraints,allocateFog,memorySnapshot,ZONES};
