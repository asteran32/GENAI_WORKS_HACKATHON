'use strict';
const http=require('node:http');
const port=Number(process.env.PORT||8766);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT must be between 1024 and 65535.');
const app=require('../cool-sydney/monitor-demo').createMonitorDemo({port});
const server=http.createServer(async(req,res)=>{
  try{
    const host=req.headers.host;
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)){res.writeHead(403);res.end();return;}
    const response=await app(new Request(`http://${host}${req.url}`,{method:req.method,headers:req.headers}));
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Could not read the recorded demo.');}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is in use. Try PORT=8767 node scripts/run_agent_monitor_demo.js`:error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Recorded Cool Sydney monitor: http://127.0.0.1:${port}/\nRead-only: no model, Docker, Zetaris, Meterless or API keys required.\nCtrl+C to stop.`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
