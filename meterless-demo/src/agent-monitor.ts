import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultProject=fileURLToPath(new URL('../../.publish/GENAI_WORKS_HACKATHON/',import.meta.url));
const assets=new Map([
  ['/agent-monitor',['agent-monitor.html','text/html; charset=utf-8']],
  ['/agent-monitor.mjs',['agent-monitor.mjs','text/javascript; charset=utf-8']],
  ['/agent-graph.mjs',['agent-graph.mjs','text/javascript; charset=utf-8']],
  ['/agent-monitor.css',['agent-monitor.css','text/css; charset=utf-8']],
]);
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'"};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});

// Fixed local upstream; never forward cookies, credentials, or an arbitrary URL.
export function createAgentMonitor(options:{projectRoot?:string;transport?:typeof fetch}={}){
  const root=options.projectRoot||process.env.COOL_SYDNEY_PROJECT_ROOT||defaultProject;
  const transport=options.transport||fetch;
  return async(request:Request,body?:Record<string,unknown>):Promise<Response>=>{
    const url=new URL(request.url),asset=assets.get(url.pathname);
    if(asset){
      if(!['GET','HEAD'].includes(request.method))return json({error:'지원하지 않는 요청입니다.'},405);
      try{return new Response(request.method==='HEAD'?null:fs.readFileSync(path.join(root,'cool-sydney/src',asset[0])),{headers:{...headers,'Content-Type':asset[1]}});}
      catch{return json({error:'모니터 화면 파일을 찾지 못했습니다. COOL_SYDNEY_PROJECT_ROOT를 확인하세요.'},503);}
    }
    const route=url.pathname.slice('/api/cool-sydney/'.length);
    const readable=/^(status|graph|catalog|memories|plans\/latest|runs|runs\/[a-f0-9-]{36}(?:\/plan)?)$/.test(route);
    const writable=/^runs(?:\/[a-f0-9-]{36}\/memory)?$/.test(route);
    if(!url.pathname.startsWith('/api/cool-sydney/')||!(request.method==='GET'&&readable||request.method==='POST'&&writable))return json({error:'지원하지 않는 모니터 경로입니다.'},404);
    try{
      const response=await transport(`http://127.0.0.1:8765/api/agent/${route}`,{
        method:request.method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,
        redirect:'error',signal:AbortSignal.timeout(12000)
      });
      return json(await response.json(),response.status);
    }catch{return json({error:'8765 에이전트 서버에 연결하지 못했습니다. Cool Sydney 서버를 실행하거나 재시작하세요.'},503);}
  };
}
