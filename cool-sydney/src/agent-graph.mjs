const NS='http://www.w3.org/2000/svg';
const titles={__start__:'START',load_context:'메타·기억 준비',model:'질의 작성 · 결과 해석',tools:'SQL 조회 · 계산',finish:'운영안 답변',__end__:'END'};
Object.assign(titles,{load_catalog:'메타 카탈로그 로드',recall_memory:'Meterless 기억 조회',compose_prompt:'LLM 프롬프트 조립',route_tools:'요청 분기',execute_sql:'SQL 검증·실행',query_forecast:'보행량 예측 조회',allocate_devices:'포그 배분 계산',simulate_cooling:'냉각 효과 계산',inspect_catalog:'메타 상세 확인',reject_tool:'미지원 요청 처리'});
const executionNodeIds=['execute_sql','query_forecast','allocate_devices','simulate_cooling','inspect_catalog','reject_tool'];
const descriptions={__start__:'그래프 시작',load_context:'카탈로그 파일 로드 · Meterless 기억 조회 · 프롬프트 조립 (LLM 호출 전)',model:'SQL / 함수 호출 작성 → 실행 결과를 받은 후 재판단',tools:'검증된 SQL 실행 · 실제 반환 행 · 계산 입력과 출력',finish:'최종 답변 반환',__end__:'LangGraph 종료. 기억 저장은 이후 후처리입니다.'};
Object.assign(descriptions,{load_catalog:'등록된 테이블·컬럼 카탈로그 준비',recall_memory:'지역별 운영 기억과 출처 조회',compose_prompt:'시스템 지침 + 메타 + 질문 + 기억으로 실제 입력 메시지 조립',route_tools:'LLM이 요청한 함수를 하나씩 실행할 노드로 연결'});
const positions={__start__:[70,210],load_context:[260,210],model:[500,210],tools:[760,80],finish:[760,340],__end__:[980,340]};
const detailedPositions={__start__:[60,70],load_catalog:[250,70],recall_memory:[490,70],compose_prompt:[730,70],model:[1000,70],route_tools:[1000,250],execute_sql:[170,450],query_forecast:[410,450],allocate_devices:[650,450],simulate_cooling:[890,450],inspect_catalog:[1130,450],reject_tool:[1130,620],finish:[650,250],__end__:[410,250]};
const eventGroups={load_context:['catalog','memory','operating_conditions','context_prompt'],model:['model_request','model'],tools:['tool_call','sql_request','tool_result','tool_error','forecast_read','forecast_cache_hit'],finish:['answer']};
const edgeKey=(a,b)=>`${a}->${b}`;

export function graphExecution(graph,run,now=Date.now()){
  const nodes=Object.fromEntries(graph.nodes.map(n=>[n.id,{state:'idle',visits:0,duration_ms:0,events:[]}]));
  const edges=Object.fromEntries(graph.edges.map(e=>[edgeKey(e.source,e.target),0]));
  const increment=(a,b)=>{const key=edgeKey(a,b);if(key in edges)edges[key]++;};
  let previous='__start__',activeNode=null;const opened=new Map();
  for(const event of run?.events||[]){
    const node=nodes[event.node];
    if(event.type==='node_start'&&node){
      increment(previous,event.node);previous=event.node;activeNode=event.node;node.state='running';node.visits++;
      opened.set(event.node,Date.parse(event.at));node.events.push(event);
      if(nodes.__start__){nodes.__start__.state='done';nodes.__start__.visits=1;}
    }else if(['node_end','node_error'].includes(event.type)&&node){
      const start=opened.get(event.node),end=Date.parse(event.at);
      if(Number.isFinite(start)&&Number.isFinite(end))node.duration_ms+=Math.max(0,end-start);
      opened.delete(event.node);node.state=event.type==='node_error'?'error':'done';node.events.push(event);activeNode=null;
      if(event.node==='finish'&&event.type==='node_end'&&nodes.__end__){increment('finish','__end__');nodes.__end__.state='done';nodes.__end__.visits=1;}
    }else{
      if(activeNode&&nodes[activeNode])nodes[activeNode].events.push(event);
      else for(const [id,types] of Object.entries(eventGroups))if(nodes[id]&&types.includes(event.type))nodes[id].events.push(event);
    }
  }
  for(const [id,start] of opened){
    const end=run?.finished_at?Date.parse(run.finished_at):now;
    if(Number.isFinite(start)&&Number.isFinite(end))nodes[id].duration_ms+=Math.max(0,end-start);
    if(['failed','completed'].includes(run?.status))nodes[id].state=run.status==='failed'?'error':'unknown';
  }
  return {nodes,edges,has_trace:(run?.events||[]).some(e=>e.type==='node_start')};
}
function svgElement(tag,attrs={},text){const el=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,String(v));if(text!==undefined)el.textContent=text;return el;}
function geometry(edge,coords){
  const [x,y]=coords[edge.source],[tx,ty]=coords[edge.target];
  const terminal=id=>id.startsWith('__')?40:95;
  if(coords.route_tools){
    if(Math.abs(ty-y)>90){const sign=ty>y?1:-1,offset=edge.source==='route_tools'?-16:16,start=y+sign*44,end=ty-sign*44;return {path:`M ${x+offset} ${start} C ${x+offset} ${(start+end)/2}, ${tx+offset} ${(start+end)/2}, ${tx+offset} ${end}`,label:[(x+tx)/2+offset,(start+end)/2]};}
    const sign=tx>x?1:-1,start=x+sign*terminal(edge.source),end=tx-sign*terminal(edge.target);return {path:`M ${start} ${y} C ${(start+end)/2} ${y}, ${(start+end)/2} ${ty}, ${end} ${ty}`,label:[(start+end)/2,(y+ty)/2-12]};
  }
  if(edge.source==='tools'&&edge.target==='model')return {path:`M ${x-95} ${y+18} C ${x-175} ${y+18}, ${tx+165} ${ty+20}, ${tx+95} ${ty+20}`,label:[625,174]};
  const start=x+terminal(edge.source),end=tx-terminal(edge.target);
  return {path:`M ${start} ${y} C ${(start+end)/2} ${y}, ${(start+end)/2} ${ty}, ${end} ${ty}`,label:[(start+end)/2,(y+ty)/2-16]};
}
function traceElement(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
function prettyTrace(value){if(typeof value==='string'){try{return JSON.stringify(JSON.parse(value),null,2);}catch{return value;}}return JSON.stringify(value,null,2);}
function traceBlock(title,value,open=true){const box=traceElement('details');box.open=open;box.append(traceElement('summary',title),traceElement('pre',prettyTrace(value)));return box;}
function traceMessages(messages){
  const box=traceElement('div',undefined,'trace-messages');
  for(const [i,message]of messages.entries()){
    const card=traceElement('section',undefined,'trace-message');
    card.append(traceElement('h5',`${i+1}. ${message.role}${message.tool_call_id?' · '+message.tool_call_id:''}`));
    if(message.content!=null)card.append(traceBlock('메시지 본문',message.content,message.role!=='system'));
    if(message.tool_calls?.length)card.append(traceBlock('모델이 작성한 함수 호출 / SQL 인수',message.tool_calls));
    box.append(card);
  }
  return box;
}
function traceTable(columns,data){
  const wrapper=traceElement('div',undefined,'trace-table');
  wrapper.append(traceElement('p',`실제 반환 ${data.length}행 · ${columns.length}개 컬럼 (쿼리 LIMIT 적용 결과)`));
  if(!data.length){wrapper.append(traceElement('p','반환된 행이 없습니다.'));return wrapper;}
  const table=traceElement('table'),head=traceElement('thead'),header=traceElement('tr'),body=traceElement('tbody');
  for(const column of columns)header.append(traceElement('th',column));head.append(header);
  for(const row of data){const tr=traceElement('tr');for(const value of row)tr.append(traceElement('td',value===null?'NULL':typeof value==='object'?JSON.stringify(value):String(value)));body.append(tr);}
  table.append(head,body);wrapper.append(table);return wrapper;
}
export function executionSteps(run){
  const events=run?.events||[],steps=[];
  const active=['queued','running'].includes(run?.status);
  let activeNode=null;
  for(let i=0;i<events.length;i++){
    const event=events[i];let node=event.node,title,group;
    if(event.type==='node_start')activeNode=event.node;
    if(event.type==='node_start'&&['load_context','load_catalog','recall_memory','compose_prompt','model','finish'].includes(node)){
      let end=i+1;while(end<events.length&&events[end].type!=='node_start'){if(['node_end','node_error'].includes(events[end].type)&&events[end].node===node){end++;break;}end++;}
      group=events.slice(i,end);
      const call=group.find(e=>e.type==='model_request'||e.type==='model')?.call;
      title=node==='model'?`모델 ${call||steps.filter(s=>s.node==='model').length+1}`:node==='finish'?'최종 답변':titles[node];
    }else if(event.type==='tool_call'){
      node=activeNode||'tools';let end=i+1;while(end<events.length&&events[end].type!=='tool_call'&&events[end].type!=='node_start'&&events[end].type!=='node_end')end++;
      group=events.slice(i,end);
      const names={execute_readonly_sql:'SQL 조회',get_pedestrian_forecast:'보행량 예측 조회',allocate_fog:'포그 배분 계산',simulate_fog:'냉각 효과 계산',catalog_details:'메타 상세 확인'};
      title=`${names[event.name]||event.name} ${steps.filter(s=>s.tool===event.name).length+1}`;
    }else if(event.type==='memory_save_start'||event.type==='memory_saved'&&!events.some(e=>e.type==='memory_save_start'&&e.seq<event.seq)){
      node='memory';group=events.slice(i).filter(e=>['memory_save_start','memory_saved','memory_save_error'].includes(e.type));title='운영 기억 저장';
    }else continue;
    const failed=group.some(e=>['node_error','tool_error','memory_save_error'].includes(e.type));
    const complete=group.some(e=>['node_end','tool_result','memory_saved'].includes(e.type));
    const state=failed?'error':complete?'done':active?'running':'error';
    const end=group.findLast(e=>['node_end','node_error','tool_result','tool_error','memory_saved','memory_save_error'].includes(e.type));
    const duration=Date.parse(end?.at)-Date.parse(event.at);
    steps.push({key:String(event.seq),node,title,tool:event.name,state,events:group,duration_ms:Number.isFinite(duration)?Math.max(0,duration):null});
  }
  return steps;
}
export function renderNodeTrace(container,id,events,run){
  if(id==='load_catalog'){
    container.append(traceElement('p','에이전트에 제공한 등록 카탈로그입니다. 이 단계에서는 LLM을 호출하지 않습니다.'));
    const snapshot=events.find(e=>e.type==='catalog_snapshot');if(snapshot)container.append(traceBlock('테이블 · 컬럼 · 데이터 의미',snapshot.catalog));
  }else if(id==='recall_memory'){
    const memory=events.find(e=>e.type==='memory');if(memory)container.append(traceBlock('Meterless 조회 응답 · 실제 기억과 출처',memory));
  }else if(id==='route_tools'){
    const route=events.find(e=>e.type==='tool_route');if(route)container.append(traceBlock('다음 실행 노드와 남은 요청 수',route));
  }else if(id==='load_context'||id==='compose_prompt'){
    const prompt=events.find(e=>e.type==='context_prompt');
    if(prompt){
      container.append(traceElement('p','이 단계는 LLM을 호출하지 않고 다음 모델 호출에 전달할 프롬프트를 조립합니다.'));
      for(const m of prompt.messages)container.append(traceBlock(m.role==='system'?'System prompt · 지침 + 전체 메타 카탈로그':'User context · 질문 + 기억 + 적용 조건',m.content));
      container.append(traceBlock('사용 가능한 도구 정의',prompt.tools,false));
    }else container.append(traceElement('p','이 실행에는 조립된 프롬프트가 기록되지 않았습니다. 서버 재시작 후 새 요청부터 확인할 수 있습니다.'));
    for(const e of events.filter(e=>['catalog','memory','operating_conditions'].includes(e.type)))container.append(traceBlock(`${e.type} · 이벤트 ${e.seq}`,e,false));
  }else if(id==='model'){
    const requests=events.filter(e=>e.type==='model_request');
    if(!requests.length)container.append(traceElement('p','이 실행에는 모델 입력 메시지가 기록되지 않았습니다. 새 요청부터 확인할 수 있습니다.'));
    for(const request of requests){
      const response=events.find(e=>e.type==='model'&&(e.request_event===request.seq||e.call===request.call));
      const card=traceElement('details',undefined,'trace-call');card.open=request===requests.at(-1);
      card.append(traceElement('summary',`모델 호출 ${request.call} · ${run?.provider||'AI'} / ${run?.model||'모델 미기록'} · ${response?'응답 수신':'응답 대기 또는 실패'}`));
      card.append(traceElement('h5',`입력 · 메시지 ${request.messages.length}개 · tool_choice=${request.tool_choice}`),traceMessages(request.messages),traceBlock('전달한 도구 정의',request.tools,false));
      card.append(traceElement('h5','출력 · 모델 응답'));
      if(response?.message)card.append(traceMessages([response.message]),traceBlock('토큰 사용량',response.usage||{},false));
      else {const error=events.find(e=>e.type==='node_error'&&e.seq>request.seq);card.append(traceElement('p',error?error.error:'응답이 아직 기록되지 않았습니다.'));}
      container.append(card);
    }
  }else if(id==='tools'||executionNodeIds.includes(id)){
    const calls=events.filter(e=>e.type==='tool_call');
    if(!calls.length)container.append(traceElement('p','상세 함수 호출 기록이 없습니다. 아래 원본 이벤트를 확인하거나 새 요청을 실행하세요.'));
    for(const call of calls){
      const card=traceElement('details',undefined,'trace-call');card.open=true;
      card.append(traceElement('summary',`${call.name} · 모델 호출 ${call.model_call} · ${call.tool_call_id}`),traceBlock('입력 · 함수 인수',call.arguments));
      const matching=events.filter(e=>e.tool_event===call.seq),output=matching.find(e=>['tool_result','tool_error'].includes(e.type));
      const queries=matching.filter(e=>e.type==='sql_request');
      for(const hit of matching.filter(e=>e.type==='forecast_cache_hit')){
        card.append(traceElement('p',`이 실행에서 앞서 조회한 SQL 결과를 재사용했습니다. SQL 이벤트 ${hit.sql_event}`));
        const original=(run?.events||[]).find(e=>e.seq===hit.sql_event&&e.type==='sql_request');if(original)queries.push(original);
      }
      for(const query of queries){
        card.append(traceBlock(`실행 SQL · 이벤트 ${query.seq}`,query.sql));
        const raw=(run?.events||events).find(e=>e.type==='forecast_read'&&e.sql_event===query.seq);
        const result=raw||((output?.result?.sql_event===query.seq)?output.result:null);
        if(result?.columns&&result?.data)card.append(traceTable(result.columns,result.data));
        else card.append(traceElement('p','이 SQL의 반환 데이터가 아직 없거나 실행이 실패했습니다.'));
      }
      if(output?.type==='tool_error')card.append(traceBlock('실행 오류',output.error));
      else if(output)card.append(traceBlock('출력 · 다음 모델 호출에 전달한 도구 결과',output.result,!queries.length));
      else card.append(traceElement('p','실행 중 · 결과 대기'));
      container.append(card);
    }
  }else if(id==='finish'){
    const answer=events.find(e=>e.type==='answer');if(answer)container.append(traceBlock('사용자에게 반환한 최종 답변',answer.text));
  }
  if(events.length)container.append(traceBlock('원본 이벤트 JSON',events,false));
}
export function createGraphView({svg,detail,status,mermaid,postGraph,flow}){
  let currentGraph,currentRun,selected='load_context',detailVersion='',stepKey=null,selectionRun=null,steps=[],manualSelection=false,flowVersion='';
  function paintSteps(){
    if(!flow)return;
    const version=JSON.stringify([currentRun?.id,steps.map(s=>[s.key,s.state,s.duration_ms]),stepKey]);if(version===flowVersion)return;flowVersion=version;
    flow.replaceChildren();
    if(!steps.length){flow.append(traceElement('p',currentRun?'이 실행에는 단계별 추적 기록이 없습니다. 새 요청을 실행하세요.':'상단에서 질문을 보내면 실제 실행 순서가 여기에 나타납니다.','trace-empty'));return;}
    for(const [i,step]of steps.entries()){
      const button=traceElement('button',undefined,'execution-step');button.type='button';button.dataset.state=step.state;button.setAttribute('aria-pressed',String(step.key===stepKey));
      button.append(traceElement('span',String(i+1),'step-number'),traceElement('strong',step.title),traceElement('span',`${{done:'완료',running:'실행 중',error:'오류'}[step.state]}${step.duration_ms!=null?' · '+(step.duration_ms/1000).toFixed(2)+'초':''}`,'step-state'));
      button.addEventListener('click',()=>{stepKey=step.key;selected=step.node;manualSelection=true;showDetails();paintSteps();});flow.append(button);
    }
  }
  function showDetails(){
    if(!currentGraph)return;
    const view=graphExecution(currentGraph,currentRun),step=steps.find(s=>s.key===stepKey),node=view.nodes[selected];if(!node&&!step)return;
    const events=step?.events||node.events;
    const heading=document.createElement('h4');heading.textContent=step?step.title:`${titles[selected]||selected} · 모든 호출`;
    const paragraph=document.createElement('p');paragraph.className='hint';paragraph.textContent=step?`${step.node==='memory'?'그래프 종료 후 처리':step.node} · ${step.duration_ms==null?'처리 중':(step.duration_ms/1000).toFixed(2)+'초'}`:descriptions[selected]||titles[selected];
    const version=JSON.stringify([currentRun?.id,selected,stepKey,events.map(e=>e.seq),currentRun?.status]);
    if(version!==detailVersion){detailVersion=version;detail.replaceChildren(heading,paragraph);if(selected==='memory')detail.append(traceBlock('저장 결과',events));else renderNodeTrace(detail,selected,events,currentRun);}
    svg.querySelectorAll('[data-node]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.node===selected)));
  }
  return {paint(graph,run){
    if(!graph)return;currentGraph=graph;currentRun=run;
    if(!graph.nodes.some(n=>n.id===selected)&&selected!=='memory')selected=graph.nodes.some(n=>n.id==='compose_prompt')?'compose_prompt':'load_context';
    if(selectionRun!==run?.id){selectionRun=run?.id;manualSelection=false;stepKey=null;}
    steps=executionSteps(run);
    if(steps.length&&!manualSelection){const step=steps.at(-1);stepKey=step.key;selected=step.node;}
    paintSteps();
    const view=graphExecution(graph,run),coords={};
    const layout=graph.nodes.some(n=>n.id==='route_tools')?detailedPositions:positions;
    svg.setAttribute('data-layout',layout===detailedPositions?'detailed':'legacy');
    svg.setAttribute('viewBox',layout===detailedPositions?'0 0 1260 700':'0 0 1060 440');
    graph.nodes.forEach((n,i)=>{coords[n.id]=layout[n.id]||[150+i*200,440];});
    const defs=svgElement('defs'),marker=svgElement('marker',{id:'graph-arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'});
    marker.append(svgElement('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#80978b'}));defs.append(marker);svg.replaceChildren(defs);
    for(const edge of graph.edges){
      const count=view.edges[edgeKey(edge.source,edge.target)],{path,label}=geometry(edge,coords);
      const group=svgElement('g',{'class':`graph-edge ${count?'visited':''}`});
      group.append(svgElement('path',{d:path,'marker-end':'url(#graph-arrow)','class':edge.conditional?'conditional':''}));
      const name=layout===detailedPositions?(edge.source==='model'?(edge.target==='route_tools'?'실행 요청':'최종 답변'):edge.source==='route_tools'&&edge.target==='model'?'결과로 재판단':''):edge.source==='model'?(edge.target==='tools'?'작성한 SQL / 계산 실행':'운영안 확정'):edge.source==='tools'?'조회 행 · 계산값 해석':edge.source==='load_context'?'테이블·컬럼·기억 전달':'';
      if(name||count)group.append(svgElement('text',{x:label[0],y:label[1],'text-anchor':'middle'},`${name}${count?' · '+count+'회':''}`));
      svg.append(group);
    }
    for(const node of graph.nodes){
      const id=node.id,s=view.nodes[id],[x,y]=coords[id],terminal=id.startsWith('__'),w=terminal?80:190,h=terminal?44:88;
      const group=svgElement('g',{'class':`graph-node ${s.state}`,'data-node':id,role:'button',tabindex:0,'aria-label':`${id}: ${s.state}, ${s.visits} visits`,'aria-pressed':String(selected===id)});
      group.append(svgElement('rect',{x:x-w/2,y:y-h/2,width:w,height:h,rx:terminal?22:12}));
      group.append(svgElement('text',{x,y:terminal?y+5:y-15,'text-anchor':'middle','class':'node-title'},titles[id]||id));
      if(!terminal){group.append(svgElement('text',{x,y:y+6,'text-anchor':'middle','class':'node-id'},id));group.append(svgElement('text',{x,y:y+28,'text-anchor':'middle','class':'node-count'},`${{idle:'대기',running:'실행 중',done:'완료',error:'오류',unknown:'상태 미확인'}[s.state]} · ${s.visits}회 · ${(s.duration_ms/1000).toFixed(1)}초`));}
      const choose=()=>{selected=id;stepKey=null;manualSelection=true;showDetails();paintSteps();};group.addEventListener('click',choose);group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}});svg.append(group);
    }
    status.textContent=run?(view.has_trace?(graph.schema_version===2?'실제 분리된 노드의 실행 경로입니다. 노드를 클릭하면 입력과 결과를 볼 수 있습니다.':'선택한 실행은 이전 공통 도구 노드 구조입니다. 새 서버에서 실행한 요청부터 분리된 노드가 표시됩니다.'):'이전 실행에는 노드 추적 기록이 없습니다. 구조만 표시합니다.'):'컴파일된 LangGraph 구조입니다. 사용자 요청이 들어오면 실행 경로가 표시됩니다.';
    mermaid.textContent=graph.mermaid||'';
    const save=(run?.events||[]).filter(e=>['memory_save_start','memory_saved','memory_save_error'].includes(e.type)).at(-1);
    postGraph.textContent=`그래프 종료 후 처리 · Meterless 기억 저장: ${save?(save.type==='memory_saved'?'완료 · '+save.memory_id:save.type==='memory_save_error'?'실패 · '+save.error:'저장 중'):run?.remember_request===false?'선택 안 함':'대기'}`;
    showDetails();
  }};
}
