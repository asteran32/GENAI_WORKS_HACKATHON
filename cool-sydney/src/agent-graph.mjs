const NS='http://www.w3.org/2000/svg';
const titles={__start__:'START',load_context:'Load context',model:'Model decision',tools:'Execute tools',finish:'Return plan',__end__:'END'};
Object.assign(titles,{load_catalog:'Load catalog',recall_memory:'Recall Meterless',compose_prompt:'Compose prompt',route_tools:'Route tools',execute_sql:'Validate & run SQL',query_forecast:'Query forecast',allocate_devices:'Allocate fog',simulate_cooling:'Simulate cooling',inspect_catalog:'Inspect catalog',reject_tool:'Reject unknown tool',export_plan:'Export plan JSON'});
const executionNodeIds=['execute_sql','query_forecast','allocate_devices','simulate_cooling','inspect_catalog','reject_tool'];
const descriptions={__start__:'Graph start',load_context:'Load catalog, recall memory and assemble the prompt before calling the model.',model:'Generate SQL or tool calls, then interpret their results.',tools:'Validated SQL, returned rows, calculation inputs and outputs.',finish:'Return final answer',__end__:'Graph ends. Memory is saved afterward.'};
Object.assign(descriptions,{load_catalog:'Load registered tables and columns.',recall_memory:'Recall operating memories and their sources.',compose_prompt:'Assemble instructions, catalog, conversation, question and memory.',route_tools:'Route each requested function to its execution node.'});
const positions={__start__:[70,210],load_context:[260,210],model:[500,210],tools:[760,80],finish:[760,340],__end__:[980,340]};
const detailedPositions={__start__:[60,70],load_catalog:[250,70],recall_memory:[490,70],compose_prompt:[730,70],model:[1000,70],route_tools:[1000,250],execute_sql:[170,450],query_forecast:[410,450],allocate_devices:[650,450],simulate_cooling:[890,450],inspect_catalog:[1130,450],reject_tool:[1130,620],finish:[720,250],export_plan:[470,250],__end__:[220,250]};
const eventGroups={load_context:['catalog','memory','operating_conditions','context_prompt'],model:['model_request','model'],tools:['tool_call','sql_request','tool_result','tool_error','forecast_read','survey_read','forecast_cache_hit','candidates_selected'],finish:['answer']};
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
      if(graph.edges.some(edge=>edge.source===event.node&&edge.target==='__end__')&&event.type==='node_end'&&nodes.__end__){increment(event.node,'__end__');nodes.__end__.state='done';nodes.__end__.visits=1;}
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
    if(message.content!=null)card.append(traceBlock('Message body',message.content,message.role!=='system'));
    if(message.tool_calls?.length)card.append(traceBlock('Generated tool calls / SQL arguments',message.tool_calls));
    box.append(card);
  }
  return box;
}
function traceTable(columns,data){
  const wrapper=traceElement('div',undefined,'trace-table');
  wrapper.append(traceElement('p',`Returned ${data.length} rows · ${columns.length} columns (query LIMIT applied)`));
  if(!data.length){wrapper.append(traceElement('p','No rows returned.'));return wrapper;}
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
    if(event.type==='node_start'&&['load_context','load_catalog','recall_memory','compose_prompt','model','finish','export_plan'].includes(node)){
      let end=i+1;while(end<events.length&&events[end].type!=='node_start'){if(['node_end','node_error'].includes(events[end].type)&&events[end].node===node){end++;break;}end++;}
      group=events.slice(i,end);
      const call=group.find(e=>e.type==='model_request'||e.type==='model')?.call;
      title=node==='model'?`Model ${call||steps.filter(s=>s.node==='model').length+1}`:node==='finish'?'Final answer':titles[node];
    }else if(event.type==='tool_call'){
      node=activeNode||'tools';let end=i+1;while(end<events.length&&events[end].type!=='tool_call'&&events[end].type!=='node_start'&&events[end].type!=='node_end')end++;
      group=events.slice(i,end);
      const names={execute_readonly_sql:'Query SQL',get_pedestrian_forecast:'Query forecast',allocate_fog:'Allocate fog',simulate_fog:'Simulate cooling',catalog_details:'Inspect catalog'};
      title=`${names[event.name]||event.name} ${steps.filter(s=>s.tool===event.name).length+1}`;
    }else if(event.type==='memory_save_start'||event.type==='memory_saved'&&!events.some(e=>e.type==='memory_save_start'&&e.seq<event.seq)){
      node='memory';group=events.slice(i).filter(e=>['memory_save_start','memory_saved','memory_save_error'].includes(e.type));title='Save operating memory';
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
    container.append(traceElement('p','Registered catalog provided to the agent. This step does not call the model.'));
    const snapshot=events.find(e=>e.type==='catalog_snapshot');if(snapshot)container.append(traceBlock('Tables · Columns · Data semantics',snapshot.catalog));
  }else if(id==='recall_memory'){
    const memory=events.find(e=>e.type==='memory');if(memory)container.append(traceBlock('Meterless response · Retrieved memories and sources',memory));
  }else if(id==='route_tools'){
    const route=events.find(e=>e.type==='tool_route');if(route)container.append(traceBlock('Next execution node and pending calls',route));
  }else if(id==='load_context'||id==='compose_prompt'){
    const prompt=events.find(e=>e.type==='context_prompt');
    if(prompt){
      container.append(traceElement('p','This step assembles the messages for the next model call.'));
      for(const m of prompt.messages)container.append(traceBlock(m.role==='system'?'System prompt · Instructions + catalog':m.role==='assistant'?'Previous assistant answer':'Conversation / user context',m.content));
      container.append(traceBlock('Available tool definitions',prompt.tools,false));
    }else container.append(traceElement('p','This older run has no recorded prompt. Restart the server and submit a new request.'));
    for(const e of events.filter(e=>['catalog','memory','operating_conditions','conversation_context'].includes(e.type)))container.append(traceBlock(`${e.type} · Event ${e.seq}`,e,false));
  }else if(id==='model'){
    const requests=events.filter(e=>e.type==='model_request');
    if(!requests.length)container.append(traceElement('p','This run has no recorded model input. New requests include it.'));
    for(const request of requests){
      const response=events.find(e=>e.type==='model'&&(e.request_event===request.seq||e.call===request.call));
      const card=traceElement('details',undefined,'trace-call');card.open=request===requests.at(-1);
      card.append(traceElement('summary',`Model call ${request.call} · ${run?.provider||'AI'} / ${run?.model||'Model not recorded'} · ${response?'Response received':'Awaiting response or failed'}`));
      card.append(traceElement('h5',`Input · Messages ${request.messages.length} · tool_choice=${request.tool_choice}`),traceMessages(request.messages),traceBlock('Tool definitions sent',request.tools,false));
      card.append(traceElement('h5','Output · Model response'));
      if(response?.message)card.append(traceMessages([response.message]),traceBlock('Token usage',response.usage||{},false));
      else {const error=events.find(e=>e.type==='node_error'&&e.seq>request.seq);card.append(traceElement('p',error?error.error:'No response recorded yet.'));}
      container.append(card);
    }
  }else if(id==='tools'||executionNodeIds.includes(id)){
    const calls=events.filter(e=>e.type==='tool_call');
    if(!calls.length)container.append(traceElement('p','No detailed tool call recorded. Inspect raw events or submit a new request.'));
    for(const call of calls){
      const card=traceElement('details',undefined,'trace-call');card.open=true;
      card.append(traceElement('summary',`${call.name} · Model call ${call.model_call} · ${call.tool_call_id}`),traceBlock('Input · Tool arguments',call.arguments));
      const matching=events.filter(e=>e.tool_event===call.seq),output=matching.find(e=>['tool_result','tool_error'].includes(e.type));
      const queries=matching.filter(e=>e.type==='sql_request');
      for(const hit of matching.filter(e=>e.type==='forecast_cache_hit')){
        card.append(traceElement('p',`Reused SQL results from this run. SQL event ${hit.sql_event}`));
        const original=(run?.events||[]).find(e=>e.seq===hit.sql_event&&e.type==='sql_request');if(original)queries.push(original);
      }
      for(const query of queries){
        card.append(traceBlock(`Executed SQL · Event ${query.seq}`,query.sql));
        const raw=(run?.events||events).find(e=>['forecast_read','survey_read'].includes(e.type)&&e.sql_event===query.seq);
        const result=raw||((output?.result?.sql_event===query.seq)?output.result:null);
        if(result?.columns&&result?.data)card.append(traceTable(result.columns,result.data));
        else card.append(traceElement('p','No rows recorded yet, or this query failed.'));
      }
      if(output?.type==='tool_error')card.append(traceBlock('Execution error',output.error));
      else if(output)card.append(traceBlock('Output · Tool result sent to the next model call',output.result,!queries.length));
      else card.append(traceElement('p','Running · Awaiting result'));
      container.append(card);
    }
  }else if(id==='export_plan'){
    const input=events.find(e=>e.type==='plan_export_input');if(input)container.append(traceBlock('Validated calculation input',input.allocation,false));
    for(const query of events.filter(e=>e.type==='sql_request')){
      container.append(traceBlock('Reference position SQL',query.sql));
      const rows=events.find(e=>e.type==='plan_positions'&&e.sql_event===query.seq);if(rows)container.append(traceTable(rows.columns,rows.data));
    }
    const output=events.find(e=>e.type==='plan_exported');
    if(output){container.append(traceBlock('Frontend JSON output',output.plan));const link=traceElement('a','Download plan JSON');link.href=output.url.replace('/api/agent/','/api/cool-sydney/');link.target='_blank';link.rel='noopener';link.download=output.plan.plan_id+'.json';container.append(link);}
    const skipped=events.find(e=>e.type==='plan_export_skipped');if(skipped)container.append(traceElement('p',skipped.reason));
  }else if(id==='finish'){
    const answer=events.find(e=>e.type==='answer');if(answer)container.append(traceBlock('Final answer returned to the user',answer.text));
  }
  if(events.length)container.append(traceBlock('Raw event JSON',events,false));
}
export function createGraphView({svg,detail,status,mermaid,postGraph,flow}){
  let currentGraph,currentRun,selected='load_context',detailVersion='',stepKey=null,selectionRun=null,steps=[],manualSelection=false,flowVersion='';
  function paintSteps(){
    if(!flow)return;
    const version=JSON.stringify([currentRun?.id,steps.map(s=>[s.key,s.state,s.duration_ms]),stepKey]);if(version===flowVersion)return;flowVersion=version;
    flow.replaceChildren();
    if(!steps.length){flow.append(traceElement('p',currentRun?'No step trace in this older run. Submit a new request.':'Send a question above to see the execution timeline.','trace-empty'));return;}
    for(const [i,step]of steps.entries()){
      const button=traceElement('button',undefined,'execution-step');button.type='button';button.dataset.state=step.state;button.setAttribute('aria-pressed',String(step.key===stepKey));
      button.append(traceElement('span',String(i+1),'step-number'),traceElement('strong',step.title),traceElement('span',`${{done:'Complete',running:'Running',error:'Error'}[step.state]}${step.duration_ms!=null?' · '+(step.duration_ms/1000).toFixed(2)+'s':''}`,'step-state'));
      button.addEventListener('click',()=>{stepKey=step.key;selected=step.node;manualSelection=true;showDetails();paintSteps();});flow.append(button);
    }
  }
  function showDetails(){
    if(!currentGraph)return;
    const view=graphExecution(currentGraph,currentRun),step=steps.find(s=>s.key===stepKey),node=view.nodes[selected];if(!node&&!step)return;
    const events=step?.events||node.events;
    const heading=document.createElement('h4');heading.textContent=step?step.title:`${titles[selected]||selected} · All calls`;
    const paragraph=document.createElement('p');paragraph.className='hint';paragraph.textContent=step?`${step.node==='memory'?'After the graph':step.node} · ${step.duration_ms==null?'Running':(step.duration_ms/1000).toFixed(2)+'s'}`:descriptions[selected]||titles[selected];
    const version=JSON.stringify([currentRun?.id,selected,stepKey,events.map(e=>e.seq),currentRun?.status]);
    if(version!==detailVersion){detailVersion=version;detail.replaceChildren(heading,paragraph);if(selected==='memory')detail.append(traceBlock('Save result',events));else renderNodeTrace(detail,selected,events,currentRun);}
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
      const name=layout===detailedPositions?(edge.source==='model'?(edge.target==='route_tools'?'Tool calls':'Final answer'):edge.source==='route_tools'&&edge.target==='model'?'Interpret results':''):edge.source==='model'?(edge.target==='tools'?'Execute SQL / calculations':'Finalize plan'):edge.source==='tools'?'Interpret results':edge.source==='load_context'?'Pass catalog and memory':'';
      if(name||count)group.append(svgElement('text',{x:label[0],y:label[1],'text-anchor':'middle'},`${name}${count?' · '+count+' visits':''}`));
      svg.append(group);
    }
    for(const node of graph.nodes){
      const id=node.id,s=view.nodes[id],[x,y]=coords[id],terminal=id.startsWith('__'),w=terminal?80:190,h=terminal?44:88;
      const group=svgElement('g',{'class':`graph-node ${s.state}`,'data-node':id,role:'button',tabindex:0,'aria-label':`${id}: ${s.state}, ${s.visits} visits`,'aria-pressed':String(selected===id)});
      group.append(svgElement('rect',{x:x-w/2,y:y-h/2,width:w,height:h,rx:terminal?22:12}));
      group.append(svgElement('text',{x,y:terminal?y+5:y-15,'text-anchor':'middle','class':'node-title'},titles[id]||id));
      if(!terminal){group.append(svgElement('text',{x,y:y+6,'text-anchor':'middle','class':'node-id'},id));group.append(svgElement('text',{x,y:y+28,'text-anchor':'middle','class':'node-count'},`${{idle:'Pending',running:'Running',done:'Complete',error:'Error',unknown:'Unknown'}[s.state]} · ${s.visits} visits · ${(s.duration_ms/1000).toFixed(1)}s`));}
      const choose=()=>{selected=id;stepKey=null;manualSelection=true;showDetails();paintSteps();};group.addEventListener('click',choose);group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}});svg.append(group);
    }
    status.textContent=run?(view.has_trace?(graph.schema_version>=2?'Actual node execution path. Click a node to inspect inputs and outputs.':'This older run used a shared tool node. New runs use separate tool nodes.'):'No node trace for this older run. Showing structure only.'):'Compiled LangGraph structure. Submit a request to see the execution path.';
    mermaid.textContent=graph.mermaid||'';
    const save=(run?.events||[]).filter(e=>['memory_save_start','memory_saved','memory_save_error'].includes(e.type)).at(-1);
    postGraph.textContent=`After the graph · Save to Meterless: ${save?(save.type==='memory_saved'?'Complete · '+save.memory_id:save.type==='memory_save_error'?'Failed · '+save.error:'Saving'):run?.remember_request===false?'Not selected':'Pending'}`;
    showDetails();
  }};
}
