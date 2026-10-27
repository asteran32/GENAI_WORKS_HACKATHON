# Agentathon Starter: The Research Notebook Agent

## 팀원용 조회 전용 데모

실행 기록만 보려면 저장소 루트에서 `node scripts/run_agent_monitor_demo.js`를 실행하고 **http://127.0.0.1:8766/**을 여세요. 커밋된 `shared/demo/agent-monitor/`를 읽으므로 npm 설치·H-MEM 엔진·8765 서버·API 키가 필요하지 않습니다. 새 질문과 기억 수정은 지원하지 않습니다. 기존 실행의 프롬프트, SQL, 도구 결과, 기억, 배분 JSON을 조회합니다.

영어 대화 5단계(상위 10곳 조회 → 50대 배치 → 출퇴근 우선 → 30대로 축소 → 물 1,500L로 축소)가 포함되어 있습니다. Run history에서 **Across all pedestrian survey sites…**부터 순서대로 확인할 수 있습니다.

## 통합 에이전트·기억·모니터링 서버

기억 목록, 조건 저장·수정, 검색, 기억별·전체 변경 이력을 브라우저에서 확인할 수 있습니다. 공식 H-MEM 참조 엔진을 호출하며 CLI와 같은 `.notebook/` 데이터를 사용합니다. Node.js 22.19 이상을 사용하세요. 최초에는 저장소 루트에서 `npm --prefix meterless-demo ci`와 `npm --prefix meterless-demo run setup`으로 엔진을 준비합니다. 엔진이 준비되면 기억 기능에는 API 키가 필요하지 않습니다. 실시간 에이전트 질문은 저장소 `.env`의 Gemini/NVIDIA 설정을 사용합니다. 이 서버 하나가 에이전트 실행, 기억, 모니터링을 처리합니다. 4173 사용자 UI는 `/api/agent/*`로 요청하며 모니터도 같은 실행을 조회합니다. 8765 서버는 필요하지 않습니다.

```bash
COOL_SYDNEY_PROJECT_ROOT="$PWD" npm --prefix meterless-demo start
```

브라우저에서 **http://127.0.0.1:8766**을 여세요. 기존에 저장한 기억도 목록에 표시됩니다. 새 설치에는 아직 기억이 없습니다. 종료는 `Ctrl+C`, 포트가 사용 중이면 `PORT=8767 npm start`로 실행합니다.

- **기억 목록:** 기억을 선택하면 내용·출처·신뢰도·태그와 이력이 열립니다.
- **조건 저장:** ‘새 기억’에서 조건과 출처를 입력합니다. 기존 기억을 선택해 수정하면 이전 값과 변경 값이 이력에 남습니다.
- **검색:** ‘H-MEM 순위 검색’은 공식 참조 엔진의 해시 임베딩과 순위 공식을 사용합니다. 실제 언어 모델이나 의미 임베딩은 사용하지 않습니다. 한국어는 **원문 포함** 검색을 선택하세요. 이 방식은 UI 어댑터의 문자열 검색이며 조회 이력은 H-MEM에 남깁니다.
- **변경 이력:** 오른쪽 패널은 선택한 기억의 이력, ‘전체 이력’은 모든 기억의 생성·조회·변경 기록입니다.

### Cool Sydney 실행 모니터

같은 서비스의 **http://127.0.0.1:8766/agent-monitor**에서 그래프·실행 타임라인·모델과 SQL 입출력을 확인합니다. Cool Sydney 서버도 기본 포트 8765에서 실행해야 합니다. 모니터 파일 위치는 위 명령의 `COOL_SYDNEY_PROJECT_ROOT`로 지정하며, API 프록시는 로컬 `127.0.0.1:8765`로 고정되어 있습니다. 이 값은 모델 API 키가 아닙니다.

기억은 새로고침과 서버 재시작 후에도 남습니다. CLI에서 변경한 내용은 ‘새로고침’으로 반영됩니다. 같은 기억의 오래된 화면에서 저장하면 덮어쓰기 대신 새로고침을 안내합니다. 참조 엔진의 JSON 저장소는 단일 사용자 데모용이므로 CLI와 UI에서 동시에 쓰지 마세요. 엔진을 새로 받는 환경에서는 아래 `npm run setup`을 먼저 실행합니다.

```bash
npm test
```

기존 기억 읽기, 수정 전후 이력, 재시작 후 복구, 영문 순위 검색·한국어 원문 검색, 잘못된 입력과 외부 요청 차단을 임시 저장소에서 검증합니다. 실제 `.notebook/`은 테스트로 변경하지 않습니다.

---

A CLI agent whose memory is real H-MEM: it mines what you tell it, ranks what it recalls, explains where every answer came from, and remembers across runs. Zero API keys. Your hackathon project starts by replacing the CLI with your own surface and keeping the memory spine.

<img src="images/notebook-loop.svg" alt="Animated: notebook commands run in a terminal while each one maps to a named H-MEM service: remember to MemoryMiningService, ask to MemoryRetrievalService, audit to TrustLedgerService, sleep to SleepCycleService" width="820" />

## Two minutes to first recall

```bash
npx degit meterless/meterless/templates/agentathon-starter my-agent
cd my-agent
npm install
npm run setup        # REQUIRED: vendors the H-MEM reference into vendor/ (gitignored)

npx tsx notebook.ts seed
npx tsx notebook.ts ask "what did we decide about storage"
```

Step 4 is not skippable: `vendor/` is gitignored, so a fresh clone has no engine until setup runs. The startup line always names which engine source loaded.

Quit the terminal, come back tomorrow, ask again: it still remembers. That persistence (`.notebook/`, also gitignored) is the demo.

## Commands

```bash
npx tsx notebook.ts remember "We always deploy on green CI"
npx tsx notebook.ts ask "when do we deploy"
npx tsx notebook.ts audit mem-1        # the memory's append-only ledger history
npx tsx notebook.ts sleep --preview    # consolidation plan, nothing applied
```

## Where the engine is used (judges look here)

Every CLI command routes through a named H-MEM service:

| Command | Engine service | Spec section |
|---|---|---|
| `remember` | MemoryMiningService (model-free path) + MemoryStoreService | AGENTS.md 4, 3 |
| `ask` | MemoryRetrievalService (hybrid formula, reinjection, trace) | AGENTS.md 6 |
| `audit` | TrustLedgerService (append-only history) | AGENTS.md 9 |
| `sleep` | SleepCycleService (preview-first, guardrails, backup) | AGENTS.md 8 |
| answer quality over time | feedback deltas are one call away: `hmem.feedback(id, "helpful")` | AGENTS.md 9.2 |

## Add a real model (optional)

The default answer mode is retrieval-only and fully offline. With a key:

```bash
npm install @anthropic-ai/sdk
ANTHROPIC_API_KEY=... npx tsx notebook.ts ask "what did we decide about storage"
```

The reinjected memory block goes into the prompt; the answer cites memory ids. Both modes are labeled in the output.

## Extension ideas by track

- **Memory agents**: extend mining with your own event types; wire `feedback` to thumbs up/down; build the dream review UI.
- **Desktop agents**: pair the notebook with Relay-style execution; memories become preconditions for actions.
- **Creative swarms**: when the swarm orchestration engine drops, fan out variants and remember which ones the user kept.
- **Enterprise workflow**: point `remember` at your CRM export; `ask` becomes account context on demand.

Rubric and tracks: [upstream hackathon guide](https://github.com/Meterless/Meterless/blob/main/docs/community/hackathon-guide.md). Engine spec: [engines/hmem/AGENTS.md](https://github.com/Meterless/Meterless/blob/main/engines/hmem/AGENTS.md).
