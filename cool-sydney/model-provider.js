'use strict';
function modelConfig(env=process.env, selected) {
  const provider=selected || env.MODEL_PROVIDER || 'gemini';
  if(!['gemini','nvidia'].includes(provider))throw new Error('모델 공급자는 gemini 또는 nvidia여야 합니다.');
  const gemini=provider==='gemini';
  return {provider,label:gemini?'Gemini':'NVIDIA',key:gemini?env.GEMINI_API_KEY:env.MODEL_API_KEY,
    base:gemini?'https://generativelanguage.googleapis.com/v1beta/openai':env.MODEL_BASE_URL||'https://integrate.api.nvidia.com/v1',
    model:gemini?env.GEMINI_MODEL||'gemini-3.8-flash':env.NEMOTRON_MODEL||'nvidia/nemotron-3-super-120b-a12b',
    options:gemini?{reasoning_effort:'low'}:{chat_template_kwargs:{enable_thinking:false}}};
}
function providers(env) {return Object.fromEntries(['gemini','nvidia'].map(p=>{const c=modelConfig(env,p);return [p,{model:c.model,configured:!!c.key?.trim()}];}));}
module.exports={modelConfig,providers};
