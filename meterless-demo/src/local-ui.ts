import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadHMEM } from "./engine.ts";
import { createAgentMonitor } from "./agent-monitor.ts";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);
const MAX_BODY_BYTES = 32 * 1024;
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

function text(value: unknown, name: string, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > limit) {
    throw new HttpError(400, `${name}: 1~${limit}자 사이로 입력하세요.`);
  }
  return value.trim();
}

function memoryInput(body: Record<string, unknown>) {
  const content = text(body.content, "조건", 4000);
  const source = text(body.source, "출처", 200);
  const confidence = body.confidence ?? 0.7;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new HttpError(400, "신뢰도는 0~1 사이의 숫자여야 합니다.");
  }
  const tags = body.tags ?? [];
  if (!Array.isArray(tags) || tags.length > 10 || tags.some(t => typeof t !== "string" || !t.trim() || t.length > 60)) {
    throw new HttpError(400, "태그는 60자 이내로 최대 10개까지 입력하세요.");
  }
  return { content, source, confidence, tags: [...new Set(tags.map(t => t.trim()))] };
}

function summary(record: any) {
  const { embedding, ...rest } = record;
  return rest;
}

async function readBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new HttpError(415, "JSON 요청만 지원합니다.");
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new HttpError(413, "요청 내용이 너무 큽니다.");
  const reader = request.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new HttpError(413, "요청 내용이 너무 큽니다."); }
      chunks.push(value);
    }
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch { throw new HttpError(400, "올바른 JSON 객체가 필요합니다."); }
}

export async function createApp(options: { persistDir: string; onError?: (error: unknown) => void; agentTransport?: typeof fetch }) {
  const monitor = createAgentMonitor({transport:options.agentTransport});
  const { HMEM } = await loadHMEM();
  const { embed } = await import("../vendor/hmem/src/embeddings.ts");
  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new HttpError(403, "로컬 주소로 접속하세요.");
      const origin = request.headers.get("origin");
      if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
        throw new HttpError(403, "같은 로컬 화면의 요청만 허용합니다.");
      }
      const route = url.pathname;
      if(['/agent-monitor','/agent-monitor.mjs','/agent-graph.mjs','/agent-monitor.css'].includes(route)||route.startsWith('/api/cool-sydney/')) {
        const body=request.method==='POST'?await readBody(request):undefined;
        return monitor(request,body);
      }
      if (staticFiles.has(route)) {
        if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "지원하지 않는 요청입니다.");
        const [filename, type] = staticFiles.get(route)!;
        return new Response(request.method === "HEAD" ? null : fs.readFileSync(path.join(publicDir, filename)), {
          headers: { ...headers, "Content-Type": type },
        });
      }
      if (!route.startsWith("/api/")) throw new HttpError(404, "페이지를 찾을 수 없습니다.");
      if (!["GET", "POST", "PATCH"].includes(request.method)) throw new HttpError(405, "지원하지 않는 요청입니다.");
      const body = request.method === "GET" ? null : await readBody(request);
      // Reload immediately before each synchronous operation so CLI changes are visible.
      const hmem = new HMEM({ persistDir: options.persistDir, actor: "local-ui" });
      if (route === "/api/memories" && request.method === "GET") {
        const memories = hmem.store.all().sort((a: any, b: any) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
        return json({ memories: memories.map(summary), engine: "H-MEM reference", ledgerCount: hmem.ledger.all().length });
      }
      if (route === "/api/memories" && request.method === "POST") {
        const memory = hmem.add({ ...memoryInput(body!), type: "preference", layer: "working" });
        return json({ memory: summary(memory) }, 201);
      }
      const match = route.match(/^\/api\/memories\/(mem-\d+)$/);
      if (match && request.method === "PATCH") {
        const current = hmem.store.get(match[1]);
        if (!current) throw new HttpError(404, "기억을 찾을 수 없습니다.");
        const input = memoryInput(body!);
        const expected = text(body!.expected, "기억 버전", 10000);
        if (JSON.stringify(summary(current)) !== expected) throw new HttpError(409, "다른 요청에서 기억이 바뀌었습니다. 새로고침 후 다시 수정하세요.");
        // Keep the memory id and let H-MEM record before/after snapshots.
        // Recompute retrieval metadata when the content changes.
        const domain = hmem.store.classifyDomain(input.content, input.tags, current.type);
        const memory = hmem.store.update(match[1], {
          ...input, embedding: embed(input.content), domain,
          namespace: `${domain}/${current.type === "preference" || current.type === "personal" ? "profile" : current.type === "factual" ? "facts" : "notes"}`,
          entities: hmem.store.extractEntities(input.content),
          provenance: { origin: "user_correction", learnedAt: Date.now(), label: input.source },
        });
        return json({ memory: summary(memory) });
      }
      if (route === "/api/search" && request.method === "POST") {
        const query = text(body!.query, "검색어", 1000);
        const mode = body!.mode ?? "ranked";
        if (mode !== "ranked" && mode !== "literal") throw new HttpError(400, "검색 방식을 확인하세요.");
        if (mode === "ranked" && !/[a-z0-9]{2}/i.test(query)) {
          throw new HttpError(400, "한국어는 ‘원문 포함’ 검색을 선택하세요. 참조 엔진의 순위 검색은 영문 키워드를 사용합니다.");
        }
        let results, trace;
        if (mode === "ranked") {
          const result = hmem.query(query, { threshold: 0.1, topN: 20 });
          results = result.memories.map((r: any) => ({ memory: summary(r.memory), relevance: r.relevance }));
          trace = result.trace;
        } else {
          const matches = hmem.store.all().filter((m: any) => m.content.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
          for (const memory of matches) {
            hmem.store.touch(memory.id);
            hmem.ledger.log(memory.id, "read", "local-ui", { details: { query, mode: "literal" } });
          }
          results = matches.map((memory: any) => ({ memory: summary(memory), relevance: null }));
          trace = { strategy: "literal", retrievalReason: "원문에 검색어가 포함된 기억" };
        }
        hmem.store.persist();
        return json({ results, mode, trace });
      }
      if (route === "/api/history" && request.method === "GET") {
        const id = url.searchParams.get("memoryId");
        if (id && !hmem.store.get(id)) throw new HttpError(404, "기억을 찾을 수 없습니다.");
        const entries = [...(id ? hmem.ledger.history(id) : hmem.ledger.all())].reverse();
        return json({ entries });
      }
      throw new HttpError(404, "요청을 찾을 수 없습니다.");
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      options.onError?.(error);
      return json({ error: "기억을 읽거나 저장하지 못했습니다. 터미널 로그를 확인하세요." }, 500);
    }
  };
}
