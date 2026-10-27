const $=id=>document.getElementById(id);
let date='2025-12-19',busy=false;
async function api(url,body){
  const response=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data;
}
async function refresh(){
  const status=await api('/api/agent/status');date=status.date||date;$('agent-date').textContent=date;
  const ready=status.dependency_installed&&status.model_configured&&status.catalog_ready;
  $('agent-status').textContent=ready?'계획을 요청할 수 있습니다.':'계획 서비스를 준비하지 못했습니다. 운영자에게 확인해주세요.';
  $('agent-run').disabled=busy||!ready;
}
function paint(run){
  const c=run.operating_conditions?.constraints;
  $('agent-conditions').textContent=c?`장비 ${c.devices??'미지정'}대 · 물 예산 ${c.water_budget_l??'미지정'} L · 출퇴근 우선 ${c.commute_priority?'켜짐':'꺼짐'}`:'';
  $('agent-allocation').replaceChildren();
  if(run.allocation){
    const list=document.createElement('ul');
    for(const row of run.allocation.allocation){const li=document.createElement('li');li.textContent=`${row.name}: ${row.devices}대${row.change==null?'':` (이전 대비 ${row.change>=0?'+':''}${row.change})`}`;list.append(li);}
    $('agent-allocation').append(list);
    const note=document.createElement('p');note.className='hint';note.textContent='구역별 배분 검토안입니다. 실제 설치 위치는 현장 확인이 필요합니다.';$('agent-allocation').append(note);
  }
  $('agent-answer').textContent=run.answer||(run.status==='failed'?'계획을 만들지 못했습니다. 운영자에게 실행 확인을 요청해주세요.':'조건과 데이터를 검토하고 있습니다…');
  const saved=run.events.filter(e=>['memory_saved','memory_save_error'].includes(e.type)).at(-1);
  $('agent-save-notice').textContent=saved?(saved.type==='memory_saved'?'운영 조건을 다음 요청에도 적용하도록 저장했습니다.':'조건을 저장하지 못했습니다. 다음 요청에는 필요한 조건을 다시 입력해주세요.'):'';
}
$('agent-run').addEventListener('click',async()=>{
  if(busy)return;busy=true;$('agent-run').disabled=true;$('agent-answer').textContent='계획을 요청하고 있습니다…';$('agent-save-notice').textContent='';$('agent-allocation').replaceChildren();$('agent-conditions').textContent='';
  try{
    const started=await api('/api/agent/runs',{question:$('agent-question').value,date,devices:$('agent-devices').value.trim()===''?null:Number($('agent-devices').value),remember_request:$('agent-remember-request').checked});
    $('agent-devices').value='';
    for(let i=0;i<210;i++){
      const run=await api(`/api/agent/runs/${started.id}`);paint(run);
      if(!['queued','running'].includes(run.status))return;
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
    $('agent-answer').textContent='계획 처리 시간이 길어지고 있습니다. 운영자에게 상태 확인을 요청해주세요.';
  }catch{$('agent-answer').textContent='요청을 처리하지 못했습니다. 입력 내용과 서비스 상태를 확인해주세요.';}
  finally{busy=false;refresh().catch(()=>{$('agent-status').textContent='계획 서비스에 연결하지 못했습니다.';});}
});
$('agent-refresh').addEventListener('click',()=>refresh().catch(()=>{$('agent-status').textContent='계획 서비스에 연결하지 못했습니다.';}));
$('agent-show-date').addEventListener('click',()=>window.dispatchEvent(new CustomEvent('cool-sydney-analysis-date',{detail:date})));
refresh().catch(()=>{$('agent-status').textContent='계획 서비스에 연결하지 못했습니다.';});
