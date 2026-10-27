'use strict';
const {validateSQL}=require('./agent-sql');
const {parsePatch}=require('./fog-allocation');
const SURVEY='survey_walking_count_surveys_0';
const MONTHS='January February March April May June July August September October November December'.split(' ');
function validPeriod(period,date) {
  const m=/^(\d{4}) - (Weekday|Weekend) - ([A-Za-z]+)$/.exec(period||'');
  const month=m?MONTHS.indexOf(m[3])+1:0;
  // Month-level surveys cannot establish that a same-month observation predates the analysis day.
  return !!(m&&month&&`${m[1]}-${String(month).padStart(2,'0')}`<date.slice(0,7));
}
function candidatesFromResult(result,catalog,runId) {
  if(result?.source!=='zetaris'||result.cells_truncated||!result.data?.length||result.data.length>100)return null;
  let checked;try{checked=validateSQL(result.sql,catalog);}catch{return null;}
  if(checked.tables.length!==1||checked.tables[0]!==`${catalog.database}.${SURVEY}`)return null;
  const keys=result.columns.map(k=>k.toLowerCase()),id=keys.indexOf('siteid'),location=keys.indexOf('location'),description=keys.indexOf('description');
  if(id<0||location<0||description<0)return null;
  const periodIndex=keys.indexOf('datefilter');
  const periods=periodIndex>=0?[...new Set(result.data.map(r=>r[periodIndex]))]:[...result.sql.matchAll(/\bDateFilter\s*=\s*'([^']+)'/gi)].map(m=>m[1]);
  // Without a returned period column, only an unambiguous filter can establish provenance.
  if(periodIndex<0&&/\bOR\b/i.test(result.sql.replace(/'[^']*'/g,'')))return null;
  if(periods.length!==1||!validPeriod(periods[0],catalog.analysis_date))return null;
  const sites=result.data.map(row=>({site_id:Number(row[id]),name:String(row[location]),description:String(row[description]),
    evidence:Object.fromEntries(result.columns.map((key,i)=>[key,row[i]]))}));
  if(sites.some(s=>!Number.isSafeInteger(s.site_id)||s.site_id<1)||new Set(sites.map(s=>s.site_id)).size!==sites.length)return null;
  return {survey_period:periods[0],site_ids:sites.map(s=>s.site_id),sites,source:'zetaris',table:checked.tables[0],
    sql:checked.sql,sql_event:result.sql_event,run_id:runId,analysis_date:catalog.analysis_date,catalog_version:catalog.catalog_version,
    evidence_type:'survey-day-observations-not-analysis-day-demand'};
}
function selectionFromRun(run,catalog) {
  if(run.date!==catalog.analysis_date||run.catalog_version!==catalog.catalog_version)return null;
  if(run.context_version&&run.candidates)return run.candidates;
  // Re-derive older runs from successful SQL results, never from generated answer text.
  const result=(run.events||[]).filter(e=>e.type==='tool_result'&&e.name==='execute_readonly_sql')
    .map(e=>candidatesFromResult(e.result,catalog,run.id)).filter(Boolean).at(-1);
  return result||run.candidates||null;
}
function conditionsFromRun(run) {
  if(!run.operating_conditions)return null;
  const conditions=structuredClone(run.operating_conditions);
  // v3 incorrectly treated a ranking question mentioning commute as an operating preference.
  if(!run.context_version&&!run.allocation&&conditions.constraints.commute_priority===true&&
     conditions.inherited?.commute_priority===false&&parsePatch(run.question||'').commute_priority===undefined){
    conditions.constraints.commute_priority=false;
    conditions.legacy_correction='A commute ranking query did not set an operating preference.';
  }
  return conditions;
}
function loadConversation(previousId,get,catalog) {
  if(!previousId)return {messages:[],candidates:null,conditions:null,previous_run_id:null};
  const latest=get(previousId);
  if(latest.status!=='completed')throw new Error('Continue a completed run, or start a new conversation.');
  if(latest.date!==catalog.analysis_date||latest.catalog_version!==catalog.catalog_version)throw new Error('The selected run uses a different analysis date or catalog. Query the current data again.');
  const runs=[],seen=new Set();let run=latest;
  while(run&&runs.length<6&&!seen.has(run.id)){
    if(run.status!=='completed'||run.date!==catalog.analysis_date||run.catalog_version!==catalog.catalog_version)break;
    runs.unshift(run);seen.add(run.id);
    if(!run.previous_run_id)break;
    try{run=get(run.previous_run_id);}catch{break;}
  }
  const candidates=runs.map(r=>selectionFromRun(r,catalog)).filter(Boolean).at(-1)||null;
  return {previous_run_id:latest.id,conversation_id:latest.conversation_id||latest.id,
    messages:runs.flatMap(r=>[{role:'user',content:r.question.slice(0,3000)},{role:'assistant',content:(r.answer||'').slice(0,6000)}]),
    candidates,conditions:conditionsFromRun(latest),previous:latest.allocation?.allocation||latest.operating_conditions?.previous||null};
}
async function querySurveyDemand({selection,catalog,query,signal,emit,trace,options={}}) {
  if(!selection)throw new Error('First query survey site IDs, Location and Description for one DateFilter, or continue the prior ranking run.');
  if(!validPeriod(selection.survey_period,catalog.analysis_date))throw new Error('The survey period is not confirmed before the analysis date.');
  const ids=options.site_ids??selection.site_ids;
  if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>!Number.isSafeInteger(id)||!selection.site_ids.includes(id)))throw new Error('Allocation must use unique site IDs from the verified candidate selection.');
  const hours=Array.from({length:18},(_,i)=>`Time_${String(i+6).padStart(2,'0')}00`);
  const sql=validateSQL(`SELECT SiteID, Location, Description, DateFilter, ${hours.join(', ')} FROM ${catalog.database}.${SURVEY} WHERE DateFilter = '${selection.survey_period}' AND SiteID IN (${ids.join(', ')}) LIMIT 100`,catalog).sql;
  const event=emit('sql_request',{sql,tables:[`${catalog.database}.${SURVEY}`],...trace});
  const result=await query(sql,catalog,signal);
  if(result?.cells_truncated||!Array.isArray(result?.columns)||!Array.isArray(result.data)||result.data.length!==ids.length||result.data.some(r=>!Array.isArray(r)||r.length!==result.columns.length))throw new Error('Incomplete or duplicate survey rows; allocation stopped.');
  const rows=result.data.map(r=>Object.fromEntries(result.columns.map((k,i)=>[k.toLowerCase(),r[i]])));
  if(new Set(rows.map(r=>Number(r.siteid))).size!==ids.length||rows.some(r=>!ids.includes(Number(r.siteid))||r.datefilter!==selection.survey_period))throw new Error('Survey result does not match the selected sites and period.');
  emit('survey_read',{...result,sql,sql_event:event.seq,...trace});
  return {date:catalog.analysis_date,survey_period:selection.survey_period,read_source:'zetaris',sql_event:event.seq,
    sites:ids.map(id=>{const row=rows.find(r=>Number(r.siteid)===id);return {id:`survey-${id}`,site_id:id,name:row.location,description:row.description,
      rows:hours.map((column,i)=>({hour:i+6,passages:row[column.toLowerCase()]==null||row[column.toLowerCase()]===''?null:Number(row[column.toLowerCase()])}))};})};
}
module.exports={SURVEY,validPeriod,candidatesFromResult,selectionFromRun,loadConversation,querySurveyDemand};
