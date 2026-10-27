import {UI} from './i18n.js';
import {createAgentChat} from './agent-client.js';
import {createPlanPanel,publishFogPlan} from './fog-plan.js';

export function initialiseChat(root=document){
  const $=id=>root.getElementById(id),launcher=$('chat-launcher'),panel=$('chat-panel'),input=$('chat-input');
  const form=$('chat-form'),send=$('chat-send'),clear=$('chat-clear'),resume=$('chat-resume');
  const welcome=$('chat-welcome'),messages=$('chat-messages'),scroll=$('chat-scroll'),status=$('chat-status');
  for(const attribute of ['data-i18n','data-i18n-label','data-i18n-title','data-i18n-placeholder'])for(const el of [launcher,panel,...panel.querySelectorAll(`[${attribute}]`)]){
    const name=el.getAttribute(attribute);if(!name)continue;
    if(attribute==='data-i18n')el.textContent=UI[name];else el.setAttribute({'data-i18n-label':'aria-label','data-i18n-title':'title','data-i18n-placeholder':'placeholder'}[attribute],UI[name]);
  }
  createPlanPanel(root);
  let storage;try{storage=window.sessionStorage;}catch{}
  let state={turns:[],busy:false},rendered='';
  const client=createAgentChat({storage,onPlan:publishFogPlan,onChange:paint});
  function updateComposer(){
    send.disabled=state.busy||!!state.active_run_id||!input.value.trim();clear.disabled=state.busy||!!state.active_run_id||!state.turns.length;
    input.style.height='auto';input.style.height=Math.min(112,Math.max(48,input.scrollHeight))+'px';
  }
  function bubble(role,text){
    const article=root.createElement('article');article.className='chat-message chat-message-'+role;
    const speaker=root.createElement('span');speaker.className='chat-message-speaker';speaker.textContent=role==='user'?UI.chatYou:'Mist';
    const body=root.createElement('p');body.textContent=text;article.append(speaker,body);messages.append(article);
  }
  function paint(next){
    state=next;const version=JSON.stringify(state.turns);
    if(version!==rendered){
      messages.replaceChildren();for(const turn of state.turns){bubble('user',turn.question);bubble('assistant',turn.answer||'Reviewing the data and preparing a response…');}
      rendered=version;scroll.scrollTop=scroll.scrollHeight;
    }
    welcome.hidden=!!state.turns.length;
    status.textContent=state.error||(state.busy?'Working on your request…':state.notice);
    $('chat-mode-label').textContent=state.busy?'Planning…':state.error?'Connection or request needs attention':'Planning assistant';
    resume.hidden=!state.active_run_id||state.busy;resume.disabled=state.busy;
    updateComposer();
  }
  launcher.addEventListener('click',()=>{
    if(panel.open){panel.close();return;}
    panel.showModal();launcher.setAttribute('aria-expanded','true');updateComposer();input.focus({preventScroll:true});
    if(!state.busy)client.status().catch(e=>{status.textContent=e.message;$('chat-mode-label').textContent='Service unavailable';});
  });
  $('chat-close').addEventListener('click',()=>panel.close());
  panel.addEventListener('close',()=>{launcher.setAttribute('aria-expanded','false');launcher.focus({preventScroll:true});});
  panel.addEventListener('click',event=>{if(event.target!==panel)return;const r=panel.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)panel.close();});
  input.addEventListener('input',updateComposer);
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();if(!send.disabled)form.requestSubmit();}});
  panel.querySelectorAll('[data-chat-prompt]').forEach(button=>button.addEventListener('click',()=>{input.value=UI[button.dataset.chatPrompt];updateComposer();input.focus({preventScroll:true});}));
  form.addEventListener('submit',async event=>{
    event.preventDefault();const question=input.value.trim();if(send.disabled||!question)return;
    const previousId=state.turns.at(-1)?.run_id;
    input.value='';await client.send(question);
    const last=state.turns.at(-1);
    if(state.error&&!state.active_run_id&&!input.value&&(last?.run_id===previousId||last?.status==='failed'))input.value=question;
    updateComposer();input.focus({preventScroll:true});
  });
  clear.addEventListener('click',()=>{if(client.reset()){input.value='';updateComposer();input.focus({preventScroll:true});}});
  resume.addEventListener('click',()=>client.resume());
  client.initialise();return client;
}
initialiseChat();
