import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { createApp } from "./src/local-ui.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8766);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535");
const app = await createApp({ persistDir: path.join(here, ".notebook"), onError: console.error });
const server = http.createServer(async (incoming, outgoing) => {
  try {
    const host = incoming.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      outgoing.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      outgoing.end("로컬 주소로 접속하세요.");
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    const method = incoming.method ?? "GET";
    const init: RequestInit & { duplex?: string } = { method, headers };
    if (method !== "GET" && method !== "HEAD") {
      init.body = Readable.toWeb(incoming) as ReadableStream;
      init.duplex = "half";
    }
    const response = await app(new Request(`http://${host}${incoming.url ?? "/"}`, init));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    if (!outgoing.headersSent) outgoing.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    outgoing.end("요청 처리 중 오류가 발생했습니다.");
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(error.code === "EADDRINUSE" ? `포트 ${port}가 사용 중입니다. PORT=8767 npm start로 실행하세요.` : error);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => console.log(`H-MEM 로컬 UI: http://127.0.0.1:${port}\n기억 저장 위치: ${path.join(here, ".notebook")}\n종료: Ctrl+C`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close());
