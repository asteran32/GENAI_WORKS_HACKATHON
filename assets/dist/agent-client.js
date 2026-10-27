import {checkedPlan} from './fog-plan.js';
const key='mist.agent.conversation.v1',uuid=/^[a-f0-9-]{36}$/;
const empty=()=>({previous_run_id:null,active_run_id:null,turns:[],plan:null});
export function createAgentChat({transport=fetch,storage=null,onChange=()=>{},onPlan=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms)),pollInterval=2500,maxPolls=80}={}){
  let state=empty(),busy=false,error='',notice='';
  try{
    const saved=JSON.parse(storage?.getItem(key)||'null');
    if(saved&&Array.isArray(saved.turns)&&saved.turns.length<=30&&(!saved.previous_run_id||uuid.test(saved.previous_run_id))&&(!saved.active_run_id||uuid.test(saved.active_run_id))){
      state={...empty(),...saved};if(state.plan)state.plan=checkedPlan(state.plan);
    }
  }catch{state=empty();}
  const snapshot=()=>structuredClone({...state,busy,error,notice});
  function update(){try{storage?.setItem(key,JSON.stringify(state));}catch{}onChange(snapshot());}
  async function api(route,body){
    let response;
    try{response=await transport('/api/agent/'+route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(18000)});}
    catch{throw new Error('Could not reach the planning service. Check the connection and try again.');}
    let result;try{result=await response.json();}catch{throw new Error('This page needs the Mist app server. Restart it with npm start, then reload.');}
    if(!response.ok)throw new Error(result.error||'The planning service could not process this request.');
    return result;
  }
  async function status(){
    const data=await api('status');
    if(!data.fresh_start_supported)throw new Error('Restart the Cool Sydney backend to enable new conversations.');
    if(!data.dependency_installed||!data.catalog_ready||!data.providers?.gemini?.configured)throw new Error('The planning service is not ready. Check its data and Gemini configuration.');
    notice=`Planning date: ${data.date} · Sydney. Operating conditions are remembered for this conversation.`;update();return data;
  }
  async function poll(){
    let failures=0;
    const id=state.active_run_id,turn=state.turns.find(t=>t.run_id===id);
    if(!id||!turn)throw new Error('No pending response to retrieve.');
    for(let attempt=0;attempt<maxPolls;attempt++){
      let run;
      try{run=await api('runs/'+id);if(run.id!==id)throw new Error('Response does not match this conversation.');failures=0;}
      catch(e){if(++failures>=3)throw e;await sleep(pollInterval);continue;}
      if(run.status==='completed'){
        turn.status='completed';turn.answer=run.answer||'The request is complete.';state.previous_run_id=id;state.active_run_id=null;
        if(run.plan){
          try{if(run.plan.run_id!==id)throw new Error('Plan does not match the response.');state.plan=checkedPlan(run.plan);onPlan(state.plan);}
          catch{error='The answer is ready, but the placement plan could not be verified. The previous plan is still shown.';}
        }
        update();return run;
      }
      if(run.status==='failed'){
        turn.status='failed';turn.answer=run.error||'The request could not be completed. Please try again.';state.active_run_id=null;update();return run;
      }
      if(!['queued','running'].includes(run.status))throw new Error('Unknown response status.');
      turn.status='running';update();if(attempt<maxPolls-1)await sleep(pollInterval);
    }
    throw new Error('The response is taking longer than expected. Check response to reconnect without sending the question again.');
  }
  async function resume(){
    if(busy||!state.active_run_id)return;
    busy=true;error='';update();
    try{return await poll();}catch(e){error=e.message;update();}finally{busy=false;update();}
  }
  async function send(question){
    question=question.trim();if(busy||state.active_run_id||!question)return;
    if(question.length>3000){error='Please keep your message under 3,000 characters.';update();return;}
    busy=true;error='';update();let turn;
    try{
      const config=await status();
      turn={question,answer:'',status:'starting',run_id:null};state.turns.push(turn);state.turns=state.turns.slice(-30);update();
      const job=await api('runs',{question,date:config.date,provider:'gemini',devices:null,remember_request:true,previous_run_id:state.previous_run_id,fresh_start:!state.previous_run_id});
      if(!uuid.test(job.id))throw new Error('The service did not return a request ID.');
      turn.run_id=job.id;turn.status='running';state.active_run_id=job.id;update();return await poll();
    }catch(e){error=e.message;if(turn&&!turn.run_id){turn.status='failed';turn.answer='The request could not be confirmed. Check the service before sending it again.';}update();}
    finally{busy=false;update();}
  }
  return {send,resume,status,snapshot,reset(){if(busy||state.active_run_id)return false;state=empty();error='';notice='New conversation. Earlier operating conditions will not be used.';onPlan(null);update();return true;},
    initialise(){onPlan(state.plan);update();if(state.active_run_id)return resume();}};
}
