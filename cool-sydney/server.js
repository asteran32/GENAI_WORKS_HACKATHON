'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createService, ApiError } = require('./service');
const ROOT = path.resolve(__dirname, '..');
function createHandler(service, port) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return async function handle(req, res) {
    const respond = (status, body, type = 'application/json; charset=utf-8') => {
      const bytes = Buffer.from(type.startsWith('application/json') ? JSON.stringify(body) : body);
      res.writeHead(status, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY' }); res.end(req.method === 'HEAD' ? undefined : bytes);
    };
    try {
      if (!hosts.has(req.headers.host)) throw new ApiError(403, '로컬 호스트에서만 접근할 수 있습니다.');
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new ApiError(403, '다른 출처의 요청은 허용되지 않습니다.');
      const url = new URL(req.url, `http://${req.headers.host}`);
      if ((req.method === 'GET' || req.method === 'HEAD') && ['/', '/index.html'].includes(url.pathname)) return respond(200, fs.readFileSync(path.join(__dirname, 'public', 'index.html')), 'text/html; charset=utf-8');
      const assets = { '/city.css': 'text/css; charset=utf-8', '/city-app.mjs': 'text/javascript; charset=utf-8', '/city-scene.mjs': 'text/javascript; charset=utf-8', '/sun.mjs': 'text/javascript; charset=utf-8', '/vendor/scene-vendor.mjs': 'text/javascript; charset=utf-8' };
      if ((req.method === 'GET' || req.method === 'HEAD') && assets[url.pathname]) return respond(200, fs.readFileSync(path.join(__dirname, 'public', url.pathname.slice(1))), assets[url.pathname]);
      if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (!url.pathname.startsWith('/api/')) throw new ApiError(404, '페이지를 찾을 수 없습니다.');
      if (!['GET', 'POST'].includes(req.method)) throw new ApiError(405, '지원하지 않는 요청 방식입니다.');
      let body;
      if (req.method === 'POST') {
        if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new ApiError(415, 'JSON 요청이 필요합니다.');
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 16384) throw new ApiError(413, '입력이 너무 큽니다.'); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new ApiError(400, 'JSON 형식이 올바르지 않습니다.'); }
      }
      const result = await service.dispatch(req.method, url.pathname, body);
      return respond(req.method === 'POST' && /\/runs$/.test(url.pathname) ? 202 : 200, result);
    } catch (e) { if (!res.headersSent) respond(e instanceof ApiError ? e.status : 500, { error: e instanceof ApiError ? e.message : '서버에서 요청을 처리하지 못했습니다.' }); }
  };
}
function start() {
  const envFile = path.join(ROOT, '.env'); if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const port = Number(process.env.COOL_SYDNEY_PORT || 8765);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('COOL_SYDNEY_PORT must be an integer from 1024 to 65535.');
  require('./build').build();
  const service = createService(), server = http.createServer(createHandler(service, port));
  server.requestTimeout = 65000; server.headersTimeout = 10000;
  server.on('error', err => { console.error(`Cool Sydney 실행 실패: ${err.code}. 포트 사용 여부와 이 터미널의 네트워크 권한을 확인하세요.`); service.close(); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Cool Sydney dashboard: http://127.0.0.1:${port}\nLocal data: ${service.root}\nCtrl+C to stop.`));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { service.close(); server.close(() => process.exit(0)); });
  return server;
}
if (require.main === module) start();
module.exports = { createHandler, start };
