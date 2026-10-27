'use strict';
const fs=require('node:fs'),path=require('node:path');
const {parseEnv}=require('node:util');
function snapshotRedactor(secrets=[],paths=[]){
  let redactions=0;
  function text(value){
    for(const secret of secrets.filter(s=>typeof s==='string'&&s.length>=8))if(value.includes(secret)){redactions++;value=value.split(secret).join('[REDACTED]');}
    for(const [prefix,label]of paths)if(prefix)value=value.split(prefix).join(label);
    return value.replace(/\b(?:nvapi-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{30,}|sk-[A-Za-z0-9_-]{20,})\b/g,()=>{redactions++;return '[REDACTED]';});
  }
  function clean(value){
    if(typeof value==='string')return text(value);
    if(Array.isArray(value))return value.map(clean);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['reasoning_content','thought_signature','embedding','extra_content'].includes(key)).map(([key,v])=>{
      if(/^(authorization|api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token)$/i.test(key)){redactions++;return [key,'[REDACTED]'];}
      return [key,clean(v)];
    }));
    return value;
  }
  return {clean,count:()=>redactions};
}
function exportSnapshot({projectRoot,memoryFile}){
  const root=path.join(projectRoot,'data/cool-sydney'),target=path.join(projectRoot,'shared/demo/agent-monitor');
  const {loaded_files}=require('./config-env').loadProjectEnv(projectRoot,{});
  const values=Object.assign({},...loaded_files.map(file=>parseEnv(fs.readFileSync(file,'utf8'))));
  const secrets=Object.entries(values).filter(([key])=>/KEY|TOKEN|PASSWORD|SECRET/i.test(key)).map(([,value])=>value);
  const workspace=path.basename(path.dirname(projectRoot))==='.publish'?path.resolve(projectRoot,'../..'):null;
  const redactor=snapshotRedactor(secrets,[[projectRoot,'<project>'],[workspace,'<workspace>'],[process.env.HOME,'<home>']]);
  const runs=fs.readdirSync(path.join(root,'agent-runs')).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name))
    .map(name=>JSON.parse(fs.readFileSync(path.join(root,'agent-runs',name),'utf8'))).filter(run=>run.status==='completed')
    .sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,30);
  if(!runs.length)throw new Error('No completed runs to export.');
  const memories=new Map();
  const remember=memory=>{if(memory?.content?.startsWith('[cool-sydney:'))memories.set(memory.id,redactor.clean(memory));};
  for(const run of [...runs].reverse())for(const event of run.events||[])if(event.type==='memory')for(const memory of event.memories||[])remember(memory);
  if(memoryFile&&fs.existsSync(memoryFile)){
    const state=JSON.parse(fs.readFileSync(memoryFile,'utf8'));
    for(const memory of state.records||[])remember(memory);
  }
  fs.mkdirSync(path.join(target,'runs'),{recursive:true});
  fs.mkdirSync(path.join(target,'plans'),{recursive:true});
  const write=(name,value)=>fs.writeFileSync(path.join(target,name),JSON.stringify(redactor.clean(value),null,2)+'\n');
  for(const run of runs){write(`runs/${run.id}.json`,run);if(run.plan)write(`plans/${run.id}.json`,run.plan);}
  const catalog=require('./agent-catalog').catalogSummary(require('./agent-catalog').readCatalog(root));
  write('catalog.json',catalog);write('graph.json',runs[0].graph);
  write('memories.json',{status:'connected',mode:'recorded-snapshot',scope:'cool-sydney',checked_at:new Date().toISOString(),memories:[...memories.values()].sort((a,b)=>(b.timestamp||0)-(a.timestamp||0))});
  const manifest={schema_version:1,captured_at:new Date().toISOString(),analysis_date:catalog.analysis_date,latest_plan_id:runs.find(run=>run.plan)?.id||null,
    runs:runs.map(({id,question,date,status,created_at,provider,previous_run_id,conversation_id})=>({id,question,date,status,created_at,provider,previous_run_id,conversation_id:conversation_id||id})),
    mode:'recorded-replay',redactions:redactor.count(),
    notes:['Recorded executions, not fresh model or SQL calls. No credentials or live services are required to view them.',
      'Original model responses are retained for debugging, including historical mistakes. Displayed plan numbers are derived from stored calculation rows.',
      'The recorded commute-priority request was not recognized by the older parser. These historical runs retain commute_priority=false; new code fixes the parser.']};
  write('manifest.json',manifest);
  return {directory:target,runs:runs.length,plans:runs.filter(r=>r.plan).length,memories:memories.size,redactions:redactor.count()};
}
module.exports={snapshotRedactor,exportSnapshot};
