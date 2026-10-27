import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const dist=fileURLToPath(new URL('./dist/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.geojson':'application/geo+json','.svg':'image/svg+xml','.png':'image/png','.gif':'image/gif','.txt':'text/plain; charset=utf-8'};
export function createFrontendApp({port=4173,transport=fetch}={}){
  const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
  return async request=>{
    const url=new URL(request.url);
    const reply=(body,status=200,type='application/json; charset=utf-8')=>new Response(request.method==='HEAD'?null:(type.startsWith('application/json')?JSON.stringify(body):body),{status,headers:{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}});
    if(!hosts.has(url.host)||(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'Open Mist on its local address.'},403);
    if(url.pathname.startsWith('/api/')){
      const readable=/^\/api\/agent\/(?:status|runs\/[a-f0-9-]{36}(?:\/plan)?)$/.test(url.pathname);
      const writable=url.pathname==='/api/agent/runs';
      if(!(request.method==='GET'&&readable||request.method==='POST'&&writable)||url.search)return reply({error:'Unknown agent route.'},404);
      let body;
      if(request.method==='POST'){
        if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Send JSON.'},415);
        body=await request.text();if(Buffer.byteLength(body)>16384)return reply({error:'Message too large.'},413);
        try{JSON.parse(body);}catch{return reply({error:'Invalid JSON.'},400);}
      }
      try{
        const response=await transport(`http://127.0.0.1:8766${url.pathname}`,{method:request.method,headers:body?{'Content-Type':'application/json'}:{},body,redirect:'error',signal:AbortSignal.timeout(15000)});
        return reply(await response.json(),response.status);
      }catch{return reply({error:'The planning service is unavailable. Start the Cool Sydney backend on port 8766, then try again.'},503);}
    }
    if(!['GET','HEAD'].includes(request.method))return reply({error:'Method not allowed.'},405);
    try{
      const pathname=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
      if(pathname.split('/').some(part=>part.startsWith('.'))||pathname.includes('\\'))return reply({error:'Not found.'},404);
      const file=await fs.realpath(path.join(dist,pathname)),type=types[path.extname(file)];
      if(!file.startsWith(dist)||!type)return reply({error:'Not found.'},404);
      const content=await fs.readFile(file);
      return new Response(request.method==='HEAD'?null:content,{headers:{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }catch{return reply({error:'Not found.'},404);}
  };
}
export function start(){
  const port=4173,app=createFrontendApp({port});
  const server=http.createServer(async(req,res)=>{
    try{
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>16384){res.writeHead(413);res.end('Message too large.');return;}chunks.push(chunk);}
      const body=chunks.length?Buffer.concat(chunks):undefined;
      const response=await app(new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(body?{body}:{})}));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch{res.writeHead(400);res.end('Invalid request.');}
  });
  server.requestTimeout=20000;server.headersTimeout=10000;
  server.on('error',error=>{console.error(`Mist could not start: ${error.code}. Stop the previous server on port 4173, then run npm start again.`);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log('Mist: http://127.0.0.1:4173\nAgent requests → existing Cool Sydney backend on 8766.\nCtrl+C to stop.'));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))start();
