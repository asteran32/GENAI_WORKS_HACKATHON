// The frontend consumes the exported contract, never parses a model's answer.
export function planMarkers(plan,date,hour){
  if(!plan)return [];
  if(plan.schema_version!=='cool-sydney.fog-plan.v1'||!Array.isArray(plan.allocations))throw new Error('Unsupported fog plan schema.');
  return plan.allocations.filter(a=>a.units>0&&a.position?.kind==='survey-site-reference'&&a.position.installation_verified===false&&Number.isFinite(a.position.longitude)&&Number.isFinite(a.position.latitude))
    .map(a=>{const schedule=a.schedule.find(s=>s.hour_local===Math.floor(hour)),sameDate=date===plan.analysis_date;
      return {site_id:a.site_id,longitude:a.position.longitude,latitude:a.position.latitude,units:a.units,
        title:`Site ${a.site_id} · ${a.units} units`,location:a.location,description:a.description,
        active:sameDate&&!!schedule?.active_minutes,
        detail:sameDate?`${String(Math.floor(hour)).padStart(2,'0')}:00 · ${schedule?.active_minutes||0} spray min/h · proposed segment`:`Plan ${plan.analysis_date} · proposed segment`};});
}
