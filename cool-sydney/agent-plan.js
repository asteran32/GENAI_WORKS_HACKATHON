'use strict';
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {validateSQL}=require('./agent-sql');
const {orderAllocations}=require('./plan-output');
const SCHEMA='cool-sydney.fog-plan.v1';
function atomic(file,value){const temp=`${file}.${randomUUID()}.tmp`;fs.writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(temp,file);}
function point(raw){
  try{
    const geometry=typeof raw==='string'?JSON.parse(raw):raw;
    if(geometry?.spatialReference?.wkid&&geometry.spatialReference.wkid!==4326)return null;
    const longitude=geometry?.x,latitude=geometry?.y;
    if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>90)return null;
    return {longitude,latitude,crs:'EPSG:4326',kind:'survey-site-reference',installation_verified:false};
  }catch{return null;}
}
async function lookupPositions({allocation,catalog,query,emit,signal}){
  const table=catalog.tables.find(t=>t.name==='survey_walkingcountsites_0');
  const ids=allocation.allocation.map(r=>r.site_id).filter(Number.isSafeInteger);
  if(!table||!ids.length)return {positions:new Map(),status:'unavailable',sql_event:null};
  const sql=validateSQL(`SELECT Site_ID, Location, source_geometry_json FROM ${table.qualified_name} WHERE Site_ID IN (${ids.join(', ')}) LIMIT 100`,catalog).sql;
  const event=emit('sql_request',{sql,tables:[table.qualified_name],purpose:'plan-reference-positions'});
  try{
    const result=await query(sql,catalog,signal);
    if(result?.cells_truncated||!Array.isArray(result?.columns)||!Array.isArray(result.data)||result.data.length>ids.length)throw new Error('Invalid position result.');
    const positions=new Map(),seen=new Set();
    for(const values of result.data){
      if(!Array.isArray(values)||values.length!==result.columns.length)throw new Error('Invalid position row.');
      const row=Object.fromEntries(result.columns.map((key,i)=>[key.toLowerCase(),values[i]])),id=Number(row.site_id);
      if(!ids.includes(id)||seen.has(id))throw new Error('Unexpected or duplicate position ID.');seen.add(id);
      const location=allocation.allocation.find(r=>r.site_id===id)?.name;
      // An old survey location must not silently locate a renamed/reused site ID.
      if(String(row.location).trim().toLowerCase()===String(location).trim().toLowerCase())positions.set(id,point(row.source_geometry_json));
    }
    emit('plan_positions',{...result,sql_event:event.seq});
    return {positions,status:'queried',sql_event:event.seq};
  }catch(error){if(signal?.aborted)throw error;emit('plan_position_error',{error:error.message,sql_event:event.seq});return {positions:new Map(),status:'query-failed',sql_event:event.seq};}
}
function validatePlan(plan){
  if(plan.schema_version!==SCHEMA||!Array.isArray(plan.allocations)||!plan.allocations.length)throw new Error('Invalid plan document.');
  if(!Number.isInteger(plan.constraints?.devices)||!Number.isInteger(plan.totals?.units)||!Number.isFinite(plan.totals?.water_l)||!Number.isFinite(plan.assumptions?.water_l_per_device_hour)||plan.assumptions.water_l_per_device_hour<0)throw new Error('Invalid plan totals or flow assumption.');
  if(!Number.isInteger(plan.operating_window?.start_hour)||!Number.isInteger(plan.operating_window?.end_hour)||plan.operating_window.start_hour<0||plan.operating_window.end_hour>24||plan.operating_window.start_hour>=plan.operating_window.end_hour)throw new Error('Invalid operating window.');
  if(plan.constraints.water_budget_l!=null&&(!Number.isFinite(plan.constraints.water_budget_l)||plan.constraints.water_budget_l<0))throw new Error('Invalid water budget.');
  const ids=new Set();let devices=0,water=0;
  for(const site of plan.allocations){
    if(ids.has(site.allocation_id)||!Number.isInteger(site.units)||site.units<0)throw new Error('Invalid or duplicate allocation.');ids.add(site.allocation_id);devices+=site.units;
    if(site.position&&(!Number.isFinite(site.position.longitude)||!Number.isFinite(site.position.latitude)||site.position.kind!=='survey-site-reference'||site.position.installation_verified!==false))throw new Error('Invalid reference position.');
    if(!Array.isArray(site.schedule)||site.schedule.length!==plan.operating_window.end_hour-plan.operating_window.start_hour)throw new Error('Incomplete schedule.');
    const hours=new Set();
    for(const row of site.schedule){
      if(!Number.isInteger(row.hour_local)||row.hour_local<plan.operating_window.start_hour||row.hour_local>=plan.operating_window.end_hour||hours.has(row.hour_local)||!Number.isInteger(row.active_minutes)||row.active_minutes<0||row.active_minutes>60||!Number.isFinite(row.water_l)||row.water_l<0)throw new Error('Invalid schedule.');
      hours.add(row.hour_local);
      if(Math.abs(row.water_l-site.units*plan.assumptions.water_l_per_device_hour*row.active_minutes/60)>1e-6)throw new Error('Schedule water does not match unit flow.');water+=row.water_l;
    }
  }
  if(devices!==plan.totals.units||devices!==plan.constraints.devices||Math.abs(water-plan.totals.water_l)>1e-6)throw new Error('Plan totals do not match allocations.');
  if(plan.constraints.water_budget_l!=null&&water>plan.constraints.water_budget_l+1e-6)throw new Error('Plan exceeds the water budget.');
  return plan;
}
function makePlan({run,allocation,catalog,positions=new Map(),positionStatus='unavailable',positionEvent=null}){
  const plan={schema_version:SCHEMA,plan_id:run.id,run_id:run.id,conversation_id:run.conversation_id||run.id,
    analysis_date:run.date,time_zone:'Australia/Sydney',created_at:new Date().toISOString(),status:'proposal',equipment_model:'FEC-MP003',
    operating_window:allocation.operating_hours,constraints:allocation.constraints,assumptions:allocation.assumptions,
    source:{database:catalog.database,catalog_version:catalog.catalog_version,survey_period:allocation.survey_period||null,evidence_type:allocation.evidence_type,demand_sql_event:allocation.demand_sql_event||null,position_sql_event:positionEvent,position_status:positionStatus},
    totals:{operating_passages:allocation.total_operating_passages,demand_score:allocation.total_demand_score,units:allocation.total_devices,water_l:allocation.total_water_l,full_time_water_l:allocation.full_time_water_l},
    allocations:orderAllocations(allocation.allocation).map(site=>({allocation_id:site.id,site_id:site.site_id??null,location:site.name,description:site.description||null,units:site.devices,operating_passages:site.operating_passages,demand_score:site.demand_score,change:site.change,
      position:positions.get(site.site_id)||null,placement_status:'requires-site-layout',
      schedule:allocation.schedule.map(hour=>({hour_local:hour.hour,active_minutes:hour.active_minutes,water_l:site.devices*allocation.assumptions.water_l_per_device_hour*hour.active_minutes/60}))})),
    limitations:[...allocation.limitations,'Map positions are survey reference markers. Exact device installation coordinates have not been chosen.'],
    execution:{controls_physical_devices:false,apply_as:'segment-allocation-markers'}};
  plan.unmapped_site_ids=plan.allocations.filter(a=>!a.position).map(a=>a.site_id??a.allocation_id);
  return validatePlan(plan);
}
async function exportPlan({root,run,allocation,catalog,query,emit,signal}){
  const positions=await lookupPositions({allocation,catalog,query,emit,signal});
  const plan=makePlan({run,allocation,catalog,positions:positions.positions,positionStatus:positions.status,positionEvent:positions.sql_event});
  const folder=path.join(root,'agent-plans');fs.mkdirSync(folder,{recursive:true});
  atomic(path.join(folder,run.id+'.json'),plan);
  emit('plan_exported',{schema_version:SCHEMA,path:`agent-plans/${run.id}.json`,url:`/api/agent/runs/${run.id}/plan`,plan});
  return plan;
}
function publishPlan(root,plan){validatePlan(plan);atomic(path.join(root,'agent-plans/latest.json'),{plan_id:plan.plan_id});}
function readPlan(root,id){
  const folder=path.join(root,'agent-plans');
  if(id==null){const pointer=path.join(folder,'latest.json');if(!fs.existsSync(pointer))return null;id=JSON.parse(fs.readFileSync(pointer,'utf8')).plan_id;}
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid plan ID.');
  const file=path.join(folder,id+'.json');if(!fs.existsSync(file))return null;
  return validatePlan(JSON.parse(fs.readFileSync(file,'utf8')));
}
module.exports={SCHEMA,point,makePlan,validatePlan,exportPlan,publishPlan,readPlan};
