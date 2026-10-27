import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export function resolveProjectRoot(){
  if(process.env.COOL_SYDNEY_PROJECT_ROOT)return path.resolve(process.env.COOL_SYDNEY_PROJECT_ROOT);
  const near=fileURLToPath(new URL('../../',import.meta.url)),published=path.join(near,'.publish/GENAI_WORKS_HACKATHON');
  return fs.existsSync(path.join(published,'cool-sydney/agent.js'))?published:near;
}
const assets=new Map([
  ['/agent-monitor',['agent-monitor.html','text/html; charset=utf-8']],
  ['/agent-monitor.mjs',['agent-monitor.mjs','text/javascript; charset=utf-8']],
  ['/agent-graph.mjs',['agent-graph.mjs','text/javascript; charset=utf-8']],
  ['/agent-monitor.css',['agent-monitor.css','text/css; charset=utf-8']],
]);
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'"};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
export function createAgentMonitor(options:{projectRoot?:string;memoryTransport?:typeof fetch;agent?:any}={}){
  const root=options.projectRoot||resolveProjectRoot();let agent=options.agent;
  function instance(){
    if(!agent){
      require(path.join(root,'cool-sydney/config-env.js')).loadProjectEnv(root);
      const {createMemory}=require(path.join(root,'cool-sydney/agent-connectors.js'));
      agent=require(path.join(root,'cool-sydney/agent.js')).createAgent({root:path.join(root,'data/cool-sydney'),env:process.env,
        memory:createMemory({METERLESS_BASE_URL:'http://127.0.0.1:8766'},options.memoryTransport)});
    }
    return agent;
  }
  const handle=async(request:Request,body?:Record<string,unknown>):Promise<Response>=>{
    const url=new URL(request.url),asset=assets.get(url.pathname);
    if(asset){
      if(!['GET','HEAD'].includes(request.method))return json({error:'Method not allowed.'},405);
      try{return new Response(request.method==='HEAD'?null:fs.readFileSync(path.join(root,'cool-sydney/src',asset[0])),{headers:{...headers,'Content-Type':asset[1]}});}
      catch{return json({error:'Monitor assets unavailable. Check COOL_SYDNEY_PROJECT_ROOT.'},503);}
    }
    const route=url.pathname.replace(/^\/api\/(?:cool-sydney|agent)\//,'');
    const readable=/^(status|graph|catalog|memories|plans\/latest|runs|runs\/[a-f0-9-]{36}(?:\/plan)?)$/.test(route);
    const writable=/^runs(?:\/[a-f0-9-]{36}\/memory)?$/.test(route);
    if(!/^\/api\/(cool-sydney|agent)\//.test(url.pathname)||!(request.method==='GET'&&readable||request.method==='POST'&&writable))return json({error:'Unknown agent route.'},404);
    try{
      const a=instance();
      if(request.method==='GET'){
        if(route==='status')return json({...a.status(),server_port:8766});
        if(route==='graph')return json(await a.graph());
        if(route==='catalog')return json(a.catalog());
        if(route==='memories')return json(await a.memories());
        if(route==='plans/latest')return json({plan:a.latestPlan()});
        if(route==='runs')return json(a.list());
        const match=route.match(/^runs\/([a-f0-9-]{36})(\/plan)?$/)!;
        const result=match[2]?a.plan(match[1]):a.get(match[1]);
        return result?json(result):json({error:'No plan for this run.'},404);
      }
      if(route==='runs')return json(await a.start(body),202);
      return json(await a.remember(route.split('/')[1],body));
    }catch(error){return json({error:error instanceof Error?error.message:'Agent request failed.'},422);}
  };
  return Object.assign(handle,{close:()=>agent?.close()});
}
