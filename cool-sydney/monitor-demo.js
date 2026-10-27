'use strict';
const fs=require('node:fs'),path=require('node:path');
function createMonitorDemo({projectRoot=path.resolve(__dirname,'..'),port=8766}={}){
  const folder=path.join(projectRoot,'shared/demo/agent-monitor');
  const read=name=>JSON.parse(fs.readFileSync(path.join(folder,name),'utf8'));
  const manifest=read('manifest.json'),ids=new Set(manifest.runs.map(r=>r.id));
  const assets=new Map([['/','agent-monitor.html'],['/agent-monitor','agent-monitor.html'],['/agent-monitor.mjs','agent-monitor.mjs'],['/agent-monitor.css','agent-monitor.css']]);
  return async request=>{
    const url=new URL(request.url);
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'"};
    const respond=(data,status=200,type='application/json; charset=utf-8')=>new Response(request.method==='HEAD'?null:type.startsWith('application/json')?JSON.stringify(data):data,{status,headers:{...headers,'Content-Type':type}});
    if(![`localhost:${port}`,`127.0.0.1:${port}`].includes(url.host)||(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site')return respond({error:'Open the demo on its local address.'},403);
    if(!['GET','HEAD'].includes(request.method))return respond({error:'Recorded demo is read-only. Start the live services to send new questions.'},405);
    try{
      if(assets.has(url.pathname)){const file=assets.get(url.pathname),type=file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8';return respond(fs.readFileSync(path.join(projectRoot,'cool-sydney/src',file)),200,type);}
      const route=url.pathname.replace(/^\/api\/(?:cool-sydney|agent)\//,'');
      if(!url.pathname.startsWith('/api/cool-sydney/')&&!url.pathname.startsWith('/api/agent/'))return respond({error:'Not found.'},404);
      if(route==='status')return respond({framework:'Recorded LangGraph',trace_version:5,conversation_supported:false,plan_export_supported:false,replay_mode:true,dependency_installed:false,model_configured:false,providers:{gemini:{configured:false},nvidia:{configured:false}},catalog_ready:true,date:manifest.analysis_date,database:read('catalog.json').database,snapshot:manifest});
      if(route==='graph')return respond(read('graph.json'));
      if(route==='catalog')return respond(read('catalog.json'));
      if(route==='memories')return respond(read('memories.json'));
      if(route==='runs')return respond(manifest.runs);
      if(route==='plans/latest')return respond({plan:manifest.latest_plan_id?read(`plans/${manifest.latest_plan_id}.json`):null});
      const match=route.match(/^runs\/([a-f0-9-]{36})(\/plan)?$/);
      if(match&&ids.has(match[1]))return respond(read(`${match[2]?'plans':'runs'}/${match[1]}.json`));
      return respond({error:'No recorded data for this route.'},404);
    }catch{return respond({error:'Demo snapshot file unavailable. Check the committed shared/demo/agent-monitor files.'},404);}
  };
}
module.exports={createMonitorDemo};
