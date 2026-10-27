import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/local-ui.ts";
import { loadHMEM } from "../src/engine.ts";

const base = "http://127.0.0.1:8766";
async function fixture(t: any) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hmem-ui-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = await createApp({ persistDir: dir });
  const request = (route: string, method = "GET", body?: unknown) => app(new Request(base + route, {
    method, headers: body === undefined ? {} : { "Content-Type": "application/json", Origin: base },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { dir, app, request };
}
const condition = { content: "Only wheelchair-accessible facilities within a 10-minute walk", source: "user:accessibility", confidence: 0.8, tags: ["accessibility"] };

test("UI reads existing CLI memory, saves corrections with before/after history, and persists across restarts", async t => {
  const { dir, request } = await fixture(t);
  const { HMEM } = await loadHMEM();
  const cli = new HMEM({ persistDir: dir });
  cli.add({ ...condition, type: "general" });
  let response = await request("/api/memories");
  let { memories } = await response.json();
  assert.equal(memories[0].id, "mem-1");
  assert.equal(memories[0].embedding, undefined);
  const created = await request("/api/memories", "POST", { ...condition, content: "예산은 1만 달러 이내" });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).memory.id, "mem-2");
  const revised = { ...condition, content: "Only wheelchair-accessible facilities within a 5-minute walk", expected: JSON.stringify(memories[0]) };
  response = await request("/api/memories/mem-1", "PATCH", revised);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).memory.content, revised.content);
  const restarted = await createApp({ persistDir: dir });
  const data = await (await restarted(new Request(base + "/api/memories"))).json();
  assert.equal(data.memories.length, 2);
  assert.equal(data.memories.find((m: any) => m.id === "mem-1").content, revised.content);
  const { entries } = await (await request("/api/history?memoryId=mem-1")).json();
  assert.equal(entries[0].action, "update");
  assert.equal(entries[0].previousState.content, condition.content);
  assert.equal(entries[0].newState.content, revised.content);
  assert.equal(entries[0].actor, "local-ui");
  // Stale browser edits cannot silently overwrite a more recent change.
  assert.equal((await request("/api/memories/mem-1", "PATCH", revised)).status, 409);
});

test("H-MEM ranked search and Korean literal search keep provenance and durable read counts", async t => {
  const { request, dir } = await fixture(t);
  await request("/api/memories", "POST", condition);
  await request("/api/memories", "POST", { ...condition, content: "휠체어 접근 가능 시설만, 도보 10분 이내" });
  const ranked = await (await request("/api/search", "POST", { query: "What accessibility constraints should we apply?", mode: "ranked" })).json();
  assert.ok(ranked.results.some((r: any) => r.memory.id === "mem-1"));
  assert.equal(ranked.results[0].memory.source, condition.source);
  assert.equal(typeof ranked.results[0].relevance, "number");
  const literal = await (await request("/api/search", "POST", { query: "휠체어", mode: "literal" })).json();
  assert.equal(literal.results.length, 1);
  assert.equal(literal.results[0].memory.id, "mem-2");
  assert.equal(literal.results[0].relevance, null);
  const history = await (await request("/api/history?memoryId=mem-2")).json();
  assert.equal(history.entries[0].action, "read");
  assert.deepEqual(history.entries[0].details, { query: "휠체어", mode: "literal" });
  const persisted = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  assert.ok(persisted.records.find((m: any) => m.id === "mem-2").accessCount >= 1);
  const empty = await (await request("/api/search", "POST", { query: "존재하지않는조건", mode: "literal" })).json();
  assert.deepEqual(empty.results, []);
  assert.equal((await request("/api/search", "POST", { query: "휠체어", mode: "ranked" })).status, 400);
});

test("invalid input, missing ids, large bodies and foreign origins do not modify the notebook", async t => {
  const { app, request } = await fixture(t);
  for (const bad of [{ ...condition, content: " " }, { ...condition, source: "" }, { ...condition, confidence: "0.8" }, { ...condition, confidence: 2 }, { ...condition, tags: [12] }, { ...condition, content: "x".repeat(4001) }]) {
    assert.equal((await request("/api/memories", "POST", bad)).status, 400);
  }
  assert.equal((await request("/api/memories/mem-9", "PATCH", condition)).status, 404);
  assert.equal((await request("/api/history?memoryId=mem-9")).status, 404);
  assert.equal((await request("/api/memories", "POST", { ...condition, content: "x".repeat(33000) })).status, 413);
  assert.equal((await request("/api/memories", "DELETE")).status, 405);
  assert.equal((await app(new Request(base + "/api/memories", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify(condition) }))).status, 403);
  assert.equal((await app(new Request("http://evil.example/api/memories"))).status, 403);
  assert.equal((await app(new Request(base + "/api/memories", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(condition) }))).status, 415);
  assert.equal((await app(new Request(base + "/api/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).status, 400);
  assert.deepEqual((await (await request("/api/memories")).json()).memories, []);
});

test("only allowlisted UI assets are served; persisted markup stays data", async t => {
  const { request } = await fixture(t);
  for (const asset of ["/", "/styles.css", "/app.js"]) {
    const response = await request(asset);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("Content-Security-Policy")?.includes("script-src 'self'"));
    assert.ok((await response.text()).length > 100);
  }
  for (const route of ["/.notebook/state.json", "/.env", "/src/engine.ts", "/%2e%2e/package.json"]) assert.equal((await request(route)).status, 404);
  const input = { ...condition, content: '<img src=x onerror="alert(1)">' };
  const saved = await (await request("/api/memories", "POST", input)).json();
  assert.equal(saved.memory.content, input.content);
  assert.equal((await request("/api/memories")).headers.get("Content-Type"), "application/json; charset=utf-8");
});

test('8766 handles frontend and monitor routes with the same in-process agent',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const calls:any[]=[];
  const id='12345678-1234-1234-1234-123456789abc';
  const agent={list:()=>[{id,status:'completed'}],status:()=>({framework:'LangGraph'}),get:(runId:string)=>({id:runId,status:'completed'}),start:async(body:any)=>{calls.push(body);return {id};},close:()=>{calls.push('closed');}};
  const app=await createApp({persistDir:dir,agent});
  const runs=await app(new Request(base+'/api/cool-sydney/runs'));
  assert.equal(runs.status,200);assert.equal((await runs.json())[0].id,id);
  const direct=await app(new Request(base+'/api/agent/runs/'+id));assert.equal((await direct.json()).id,id);
  const payload={question:'Find the busiest segments',date:'2025-12-19',fresh_start:true,remember_request:true};
  const started=await app(new Request(base+'/api/agent/runs',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(payload)}));
  assert.equal(started.status,202);assert.deepEqual(calls[0],payload);
  const foreign=await app(new Request(base+'/api/cool-sydney/runs',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'}));
  assert.equal(foreign.status,403);assert.equal(calls.length,1);
  assert.equal((await app(new Request(base+'/api/cool-sydney/anything-else'))).status,404);
  const monitor=await app(new Request(base+'/agent-monitor'));assert.equal(monitor.status,200);assert.match(monitor.headers.get('Content-Security-Policy')!,/frame-ancestors 'self'/);
  assert.match(await monitor.text(),/agent-workflow/);
  const status=await app(new Request(base+'/api/agent/status'));assert.equal((await status.json()).server_port,8766);
  app.close();assert.equal(calls.at(-1),'closed');
});
