// Bundled with agent-graph.mjs and initialGraph by buildMonitor().
const $=id=>document.getElementById(id);
const graphView=createGraphView({svg:$('agent-graph'),detail:$('agent-graph-detail'),status:$('agent-graph-status'),mermaid:$('agent-graph-mermaid'),postGraph:$('agent-graph-post'),flow:$('agent-execution-steps')});
let graphStructure=initialGraph,graphRun=null;
graphView.paint(graphStructure,null);
$('agent-graph-status').textContent='배포 파일의 실제 컴파일 그래프입니다. 실시간 서버 연결을 확인하고 있습니다.';
let runId=null, date='2025-12-19', polling=false;
const stateLabel={queued:'대기',running:'실행 중',completed:'완료',failed:'실패'};
const memoryVersions=new Map();
let paintedVersion='';
function memoriesInto(id,memories,empty) {
  const version=JSON.stringify([memories,empty]);if(memoryVersions.get(id)===version)return;memoryVersions.set(id,version);
  const target=$(id);target.replaceChildren();
  if(!memories?.length){target.textContent=empty;return;}
  for(const memory of memories){
    const details=document.createElement('details'),summary=document.createElement('summary'),content=document.createElement('pre'),source=document.createElement('p');
    summary.textContent=memory.id||'기억';content.textContent=memory.content;
    const stamp=memory.updatedAt||memory.createdAt||memory.timestamp;
    const parsed=stamp?new Date(stamp):null;
    source.textContent=`출처: ${memory.source||'미기록'}${parsed&&!Number.isNaN(parsed.getTime())?' · '+parsed.toLocaleString('ko-KR'):''}`;
    details.append(summary,source,content);target.append(details);
  }
}
async function refreshMemories() {
  try {
    const data=await api('/api/agent/memories');
    $('agent-memory-connection').textContent=data.status==='connected'?`연결됨 · 이 지역의 최근 기억 ${data.memories.length}건 · ${new Date(data.checked_at).toLocaleTimeString('ko-KR')} 확인`:`연결 실패 · ${data.error}`;
    memoriesInto('agent-stored-memories',data.memories,data.status==='connected'?'이 지역에 저장된 기억이 없습니다.':'기억을 불러오지 못했습니다.');
  } catch(error){$('agent-memory-connection').textContent=`확인 실패 · ${error.message}`;memoriesInto('agent-stored-memories',[],'서버를 재시작한 뒤 설정 확인을 눌러주세요.');}
}
async function refreshHistory(existing) {
  const runs=existing||await api('/api/agent/runs'),select=$('agent-history');
  select.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='실행을 선택하세요';select.append(placeholder);
  for(const run of runs){const option=document.createElement('option');option.value=run.id;option.textContent=`${stateLabel[run.status]||run.status} · ${run.question?.slice(0,65)||run.id}`;select.append(option);}
  if(runs.some(r=>r.id===runId))select.value=runId;
}
function paintWorkflow(run) {
  const events=run?.events||[],terminal=['completed','failed'].includes(run?.status);
  const last=type=>events.filter(e=>e.type===type).at(-1);
  const nodeState=node=>{const e=events.filter(e=>e.node===node).at(-1);return !e?'idle':e.type==='node_end'?'done':e.type==='node_error'||terminal?'error':'running';};
  const recall=last('memory'),save=events.filter(e=>['memory_saved','memory_save_error','memory_save_start'].includes(e.type)).at(-1);
  const steps=[
    ['메타 카탈로그',last('catalog')?'done':nodeState('load_context'),last('catalog')?`${last('catalog').tables}개 테이블`:''],
    ['Meterless 기억 조회',recall?(recall.status==='connected'?'done':'error'):nodeState('load_context')==='running'?'running':'idle',recall?(recall.status==='connected'?`${recall.memories?.length||0}건 조회`:recall.error):''],
    ['운영 조건 적용',run?.operating_conditions?'done':'idle',''],
    [`${run?.provider||'AI'} 판단 ↔ 도구`,nodeState('model'),`모델 응답 ${events.filter(e=>e.type==='model').length}회 · SQL 요청 ${events.filter(e=>e.type==='sql_request').length}회 · 도구 오류 ${events.filter(e=>e.type==='tool_error').length}회`],
    ['결과',last('answer')?'done':run?.status==='failed'?'error':nodeState('finish'),run?.error||''],
    ['Meterless 기억 저장',save?(save.type==='memory_saved'?'done':save.type==='memory_save_error'||terminal?'error':'running'):run?.remember_request===false?'skipped':'idle',save?(save.memory_id||save.error||'저장 중'):run?.remember_request===false?'자동 저장 선택 안 함':'']
  ];
  // While a tool executes, the model has yielded; keep that cycle visibly active.
  if(nodeState('tools')==='running')steps[3][1]='running';
  const labels={idle:terminal?'미실행':'대기',done:'완료',running:'실행 중',error:'오류',skipped:'건너뜀'};
  $('agent-workflow').replaceChildren(...steps.map(([title,state,detail])=>{const li=document.createElement('li');li.dataset.state=state;li.textContent=`${title} · ${labels[state]}${detail?' — '+detail:''}`;return li;}));
  $('agent-view-question').textContent=run?`${run.question} · ${stateLabel[run.status]||run.status}`:'질문을 보내면 실제 실행 단계와 기억 사용 내역이 나타납니다.';
  $('agent-recall-status').textContent=recall?(recall.status==='connected'?`이 실행이 조회한 기억 ${recall.memories?.length||0}건. 현재 저장 목록과 구분되는 실행 당시 기록입니다.`:`기억 조회 실패: ${recall.error}`):'기억 조회 전';
  memoriesInto('agent-recalled-memories',recall?.memories,recall?.status==='connected'?'조회된 기억이 없습니다.':'조회 기록이 없습니다.');
  $('agent-condition-changes').replaceChildren();
  const conditions=run?.operating_conditions;
  if(conditions){
    for(const [key,label] of [['devices','장비 수'],['commute_priority','출퇴근 우선'],['water_budget_l','물 예산 (L)'],['start_hour','운영 시작 (시)'],['end_hour','운영 종료 (시)']]){
      const format=v=>v==null?'미지정':typeof v==='boolean'?(v?'켜짐':'꺼짐'):String(v);
      const p=document.createElement('p');p.textContent=`${label}: 기억·기본값 ${format(conditions.inherited?.[key])} → 현재 ${format(conditions.constraints[key])}`;$('agent-condition-changes').append(p);
    }
  }
}
async function api(url,body) {
  url=url.replace('/api/agent/','/api/cool-sydney/');
  const response=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);return result;
}
async function refresh() {
  const s=await api('/api/agent/status');date=s.date||date;$('agent-date').textContent=date;
  const selected=s.providers?.[$('agent-provider').value];
  $('agent-trace-notice').hidden=s.trace_version>=3;
  $('agent-trace-notice').textContent=s.trace_version>=3?'':'현재 8765 서버는 이전 버전입니다. 서버를 재시작한 뒤 새 질문을 보내야 분리된 실행 노드와 상세 프롬프트가 기록됩니다.';
  const blockers=[];
  if(polling)blockers.push('이전 요청을 처리하고 있습니다.');
  if(!s.dependency_installed)blockers.push('LangGraph 패키지가 설치되지 않았습니다.');
  if(!selected?.configured)blockers.push(`${$('agent-provider').value==='gemini'?'Gemini':'NVIDIA'} API 키가 서버에 로드되지 않았습니다. .env 설정 후 8765 서버를 재시작하세요.`);
  if(!s.catalog_ready)blockers.push(`데이터 카탈로그를 읽지 못했습니다: ${s.catalog_error}`);
  $('agent-status').textContent=blockers.length?'질문을 보낼 수 없는 이유: '+blockers.join(' '):'준비 완료 · 질문을 입력하고 보내기를 누르세요.';
  $('agent-run').disabled=blockers.length>0;$('agent-run').title=blockers.join(' ');
  if(s.catalog_ready)$('agent-catalog').textContent=JSON.stringify(await api('/api/agent/catalog'),null,2);
  try{graphStructure=await api('/api/agent/graph');graphView.paint(graphRun?.graph||graphStructure,graphRun);}
  catch(error){$('agent-graph-status').textContent=`배포 파일의 그래프를 표시합니다. 서버의 최신 구조 조회는 실패했습니다: ${error.message}`;}
  await Promise.all([refreshMemories(),refreshHistory().catch(error=>{$('agent-run-id').textContent=`실행 목록 조회 실패: ${error.message}`;})]);
}
function paint(run) {
  graphRun=run;graphView.paint(run.graph||graphStructure,run);
  const version=JSON.stringify([run.id,run.status,run.events.length]);if(version===paintedVersion)return;paintedVersion=version;
  paintWorkflow(run);
  $('agent-run-id').textContent=`run ${run.id} · ${run.date} · ${run.status}`;
  const memoryEvent=run.events.filter(e=>['memory_saved','memory_save_error'].includes(e.type)).at(-1);
  $('agent-memory-status').textContent=memoryEvent?(memoryEvent.type==='memory_saved'?`Meterless 기억 저장됨: ${memoryEvent.memory_id}`:`기억 저장 실패: ${memoryEvent.error}. 다음 요청에 조건이 유지되지 않을 수 있습니다.`):'';
  const c=run.operating_conditions?.constraints;
  $('agent-conditions').textContent=c?`적용 장비 ${c.devices??'미지정'}대 · 출퇴근 우선 ${c.commute_priority?'켜짐':'꺼짐'} · 물 예산 ${c.water_budget_l??'미지정'} L`:'';
  $('agent-allocation').replaceChildren();
  if(run.allocation){const ul=document.createElement('ul');for(const row of run.allocation.allocation){const li=document.createElement('li');li.textContent=`${row.name}: ${row.devices}대${row.change==null?'':` (이전 대비 ${row.change>=0?'+':''}${row.change})`}`;ul.append(li);}$('agent-allocation').append(ul);const note=document.createElement('p');note.className='hint';note.textContent='미검증 대리 수요를 사용한 구역 배분 시나리오입니다. 개별 설치 위치가 아닙니다.';$('agent-allocation').append(note);}
  $('agent-answer').textContent=run.answer||run.error||'근거를 조회하고 있습니다…';
  $('agent-trace').replaceChildren(...run.events.map(event=>{
    const li=document.createElement('li'),details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');
    summary.textContent=`${event.seq}. ${event.type}${event.name?' · '+event.name:''} · ${event.at.slice(11,19)}`;
    pre.textContent=JSON.stringify(event,null,2);details.append(summary,pre);li.append(details);return li;
  }));
  $('agent-remember').disabled=run.status!=='completed';
}
$('agent-run').addEventListener('click',async()=>{
  if(!$('agent-question').value.trim()){$('agent-status').textContent='질문을 입력하세요.';$('agent-question').focus();return;}
  if(polling)return;
  $('agent-follow-latest').checked=true;
  polling=true;$('agent-history').disabled=true;$('agent-run').disabled=true;$('agent-remember').disabled=true;$('agent-answer').textContent='실행을 시작합니다…';$('agent-trace').replaceChildren();paintWorkflow(null);
  try {
    const started=await api('/api/agent/runs',{question:$('agent-question').value,date,provider:$('agent-provider').value,devices:$('agent-devices').value.trim()===''?null:Number($('agent-devices').value),remember_request:$('agent-remember-request').checked});runId=started.id;$('agent-devices').value='';
    for(let i=0;i<65;i++) {
      const run=await api(`/api/agent/runs/${runId}`);paint(run);
      if(!['queued','running'].includes(run.status))break;
      await new Promise(resolve=>setTimeout(resolve,3000));
    }
  } catch(error){$('agent-answer').textContent=error.message;}
  finally{polling=false;$('agent-history').disabled=false;refresh().catch(error=>{$('agent-status').textContent=error.message;});}
});
$('agent-history').addEventListener('change',async()=>{
  $('agent-follow-latest').checked=false;
  const selected=$('agent-history').value;if(!selected||polling)return;
  try {const run=await api(`/api/agent/runs/${selected}`);if($('agent-history').value!==selected)return;runId=selected;paint(run);}
  catch(error){$('agent-answer').textContent=error.message;}
});
$('agent-provider').addEventListener('change',()=>refresh().catch(error=>{$('agent-status').textContent=error.message;}));
$('agent-question').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();if(!$('agent-run').disabled)$('agent-run').click();}});
$('agent-refresh').addEventListener('click',()=>{monitorFailures=0;refresh().then(()=>scheduleMonitor(0)).catch(error=>{$('agent-status').textContent=error.message;});});
$('agent-remember').addEventListener('click',async()=>{
  if(!runId)return;
  $('agent-remember').disabled=true;
  try {const result=await api(`/api/agent/runs/${runId}/memory`,{text:$('agent-memory').value});paint(await api(`/api/agent/runs/${runId}`));await refreshMemories();$('agent-status').textContent=`Meterless ${result.memory_id}에 저장했습니다. 다음 요청에 조회됩니다.`;}
  catch(error){$('agent-status').textContent=error.message;}
  finally{$('agent-remember').disabled=false;}
});
paintWorkflow(null);
refresh().then(()=>scheduleMonitor(0)).catch(error=>{$('agent-status').textContent=`${error.message} 서버를 재시작하고 새로고침을 누르세요.`;$('agent-graph-status').textContent='배포 파일의 그래프를 표시합니다. 실시간 서버 연결을 확인하지 못했습니다.';});

$('agent-show-date').addEventListener('click',()=>window.open('http://127.0.0.1:8765/','_blank','noopener'));
let monitorBusy=false,monitorTimer=null,monitorFailures=0;
function scheduleMonitor(delay){clearTimeout(monitorTimer);monitorTimer=setTimeout(monitorTick,delay);}
async function monitorTick(){
  if(monitorBusy||document.hidden)return;
  if(polling){scheduleMonitor(3000);return;}
  const active=graphRun&&['queued','running'].includes(graphRun.status);
  if(!$('agent-follow-latest').checked&&!active)return;
  monitorBusy=true;let next=30000;
  try {
    if(active){
      const run=await api(`/api/agent/runs/${graphRun.id}`);paint(run);
      if(['queued','running'].includes(run.status))next=3000;
      else await Promise.all([refreshHistory(),refreshMemories()]);
    }else{
      const runs=await api('/api/agent/runs');await refreshHistory(runs);
      const latest=runs[0];
      if(latest&&latest.id!==runId){const run=await api(`/api/agent/runs/${latest.id}`);runId=latest.id;paint(run);if(['queued','running'].includes(run.status))next=3000;else await refreshMemories();}
    }
    monitorFailures=0;
  }catch(error){
    monitorFailures++;next=Math.min(60000,15000*monitorFailures);
    $('agent-status').textContent=`${error.message}${monitorFailures>=3?' 자동 조회를 중단했습니다. 연결 복구 후 새로고침을 누르세요.':''}`;
  }finally{monitorBusy=false;if(monitorFailures<3)scheduleMonitor(next);}
}
$('agent-follow-latest').addEventListener('change',()=>{if($('agent-follow-latest').checked){monitorFailures=0;scheduleMonitor(0);}else clearTimeout(monitorTimer);});
document.addEventListener?.('visibilitychange',()=>{if(document.hidden)clearTimeout(monitorTimer);else if(monitorFailures<3)scheduleMonitor(0);});
