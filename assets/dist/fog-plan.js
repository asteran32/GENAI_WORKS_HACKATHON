let current=null;
const subscribers=new Set();
export function checkedPlan(plan){
  if(plan?.schema_version!=='cool-sydney.fog-plan.v1'||plan.status!=='proposal'||!Array.isArray(plan.allocations)||!plan.operating_window)throw new Error('The returned placement plan is incomplete.');
  let units=0,water=0;const ids=new Set();
  for(const row of plan.allocations){
    if(!row.allocation_id||ids.has(row.allocation_id)||!Number.isInteger(row.units)||row.units<0||!Array.isArray(row.schedule))throw new Error('Invalid placement quantities.');
    ids.add(row.allocation_id);units+=row.units;
    for(const slot of row.schedule){if(!Number.isFinite(slot.water_l)||slot.water_l<0||!Number.isInteger(slot.hour_local)||slot.hour_local<0||slot.hour_local>23||!Number.isInteger(slot.active_minutes)||slot.active_minutes<0||slot.active_minutes>60)throw new Error('Invalid operating schedule.');water+=slot.water_l;}
    if(row.position&&(!Number.isFinite(row.position.longitude)||!Number.isFinite(row.position.latitude)||Math.abs(row.position.longitude)>180||Math.abs(row.position.latitude)>90||row.position.kind!=='survey-site-reference'||row.position.installation_verified!==false))throw new Error('Invalid reference location.');
  }
  if(units!==plan.totals?.units||units!==plan.constraints?.devices||!Number.isFinite(plan.totals?.water_l)||Math.abs(water-plan.totals.water_l)>1e-5||(plan.constraints.water_budget_l!=null&&water>plan.constraints.water_budget_l+1e-5))throw new Error('Placement totals do not match the plan.');
  return {...plan,allocations:[...plan.allocations].sort((a,b)=>b.units-a.units||(b.demand_score||0)-(a.demand_score||0)||String(a.site_id).localeCompare(String(b.site_id),'en',{numeric:true}))};
}
export function publishFogPlan(plan){current=plan==null?null:checkedPlan(plan);for(const callback of subscribers)callback(current);return current;}
export function subscribeFogPlan(callback){subscribers.add(callback);callback(current);return()=>subscribers.delete(callback);}
export function createPlanPanel(root=document){
  const list=root.getElementById('candidate-list'),summary=root.getElementById('allocation-summary'),detail=root.getElementById('allocation-detail'),panel=root.querySelector('.cooling-panel');
  const el=(tag,text)=>{const node=root.createElement(tag);if(text!=null)node.textContent=text;return node;};
  const number=n=>n.toLocaleString('en-AU'),clock=h=>String(h).padStart(2,'0')+':00';
  return subscribeFogPlan(plan=>{
    list.replaceChildren();detail.replaceChildren();panel.classList.toggle('has-agent-plan',!!plan);
    if(!plan){summary.textContent='Ask Mist for a placement plan to see locations and unit counts.';return;}
    summary.textContent=`${number(plan.totals.units)} fog units · ${number(plan.totals.water_l)} L/day · ${plan.analysis_date}`;
    const select=(row,button)=>{
      for(const item of list.children){item.classList.toggle('selected',item===button);item.setAttribute('aria-pressed',String(item===button));}
      detail.replaceChildren(el('strong',`${row.location} · Site ${row.site_id??row.allocation_id}`),el('p',row.description||'Survey segment'),el('p',`${number(row.units)} fog units · ${plan.equipment_model}`));
      const active=row.schedule.filter(slot=>slot.active_minutes>0);
      detail.append(el('p',active.length?active.map(slot=>`${clock(slot.hour_local)}–${clock(slot.hour_local+1)}: ${slot.active_minutes} min`).join(' · '):'No spraying scheduled.'),el('p',`${number(row.schedule.reduce((sum,slot)=>sum+slot.water_l,0))} L/day for this segment.`));
      detail.append(el('p',row.position?`Survey reference: ${row.position.latitude.toFixed(5)}, ${row.position.longitude.toFixed(5)}. Exact installation positions need a site layout.`:'Reference coordinates unavailable. This segment remains in the plan.'));
      if(row.position)root.dispatchEvent(new CustomEvent('mist-plan-focus',{detail:row}));
    };
    for(const [i,row]of plan.allocations.entries()){
      const button=el('button');button.type='button';button.className='candidate-row allocation-row';button.dataset.allocationId=row.allocation_id;button.setAttribute('aria-pressed','false');
      button.setAttribute('aria-label',`${row.location}, Site ${row.site_id}, ${row.units} fog units`);
      const rank=el('span',String(i+1).padStart(2,'0'));rank.className='candidate-rank';
      const location=el('span');location.className='candidate-name';location.append(el('strong',row.location),el('small',`Site ${row.site_id??'—'} · ${row.description||'Survey segment'}`));
      const quantity=el('span',`${number(row.units)} units`);quantity.className='candidate-units';
      if(!row.position)location.append(el('small','Coordinates unavailable'));
      button.append(rank,location,quantity);button.addEventListener('click',()=>select(row,button));list.append(button);
    }
    const note=el('p','Proposed segment allocations · highest unit count first.');detail.append(note);
  });
}
