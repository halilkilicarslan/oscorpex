# Oscorpex — Status

## Current: v3.0 Stabilization (2026-04-15)

v3.0-v3.9 platform tamamı `db2427e` ile stub seviyesinde landed (37 files, +5189 lines).
Şu an milestone bazlı gerçek implementasyon (stabilizasyon).

### Session 2026-04-15 — v3.0 B1 + B2 Stabilization

**v3.0 B1 — Real Interactive Planner** (commit `b3b282a`, pushed)
- `askuser-json` fenced block pattern (plan-json/team-json ile uyumlu)
- `intake_questions` tablosu: pending/answered/skipped lifecycle
- `[Intake Q&A]` bloğu planner system prompt'una enjekte edilir (answered + pending)
- Kategoriler: scope/functional/nonfunctional/priority/technical/general
- PMChat'te IntakeQuestionCard component (chip seçimi + serbest metin + skip)
- 3 yeni REST endpoint: GET/POST intake-questions, answer, skip
- Yeni testler: `src/studio/__tests__/db.test.ts` intake lifecycle + scoping

**v3.0 B2 — AI Task Decomposer** (commit `0a763d0`, pushed)
- `task-decomposer.ts` rewrite: `getAIModelWithFallback` + `generateObject` + Zod
- Scrum Master system prompt (hard rules: S/M only, 2-8 tasks, ≤3 files, TR/EN mirroring)
- Codebase context: `listProjectFiles` + `gatherCodebaseContext` → file tree + target sizes
- Heuristic fallback korundu (AI unavailable/unusable durumunda)
- 15 unit test (`src/studio/__tests__/task-decomposer.test.ts`)
- Full suite: 293/293 passing

### Plan Kaynağı
`.planning/architecture/V3_ROADMAP.md` — v3.0-v3.9 tüm milestone'lar, stabilizasyon durumu, bağımlılık grafı.

### Sıradaki Adım Seçenekleri
- **B3** — Sub-task UI rollup (KanbanBoard parent kart expand + TaskDetailModal sub-task listesi)
- **v3.1** — Edge types (12 tip, metadata, execution-time handler'lar)
- **v3.4** — Context Assembly + Model Routing (token tasarrufu %40-60)

## Previous: v3.0-v3.9 Full Platform Upgrade

### Session 2026-04-14 — Stub Batch Upgrade
Commit `db2427e` — 37 files, +5189 lines. 7-agent parallel team.

- **v3.0** Interactive PM planner (askUser tool), micro-task decomposition, sub-task rollup
- **v3.1** 12 edge types (was 4): escalation, pair, conditional, fallback, notification, handoff, approval, mentoring
- **v3.2** Work items backlog (CRUD + routes), auto work-item on failure/rejection
- **v3.3** Incremental planning (addPhase, addTask, replanUnfinished), refreshPipeline
- **v3.4** Context packet assembly, model routing (complexity→tier), 4-layer memory
- **v3.5** Project lifecycle state machine (planning→running→maintenance→archived), hotfix
- **v3.6** Ceremony engine (standup, retrospective)
- **v3.7** Policy engine (built-in + custom rules)
- **v3.8** Agent chat, stakeholder report generator
- **v3.9** Sprint manager (CRUD + burndown + velocity), plugin registry

New files: task-decomposer, work-item-repo, work-item-routes, context-packet, model-router, memory-repo, memory-manager, lifecycle-manager, ceremony-engine, policy-engine, agent-chat, report-generator, sprint-manager, plugin-registry
New frontend: BacklogBoard, SprintBoard, CeremonyPanel, ProjectReport, AgentChat
New DB tables: work_items, sprints, project_context_snapshots, conversation_compactions, memory_facts, model_routing_policies
Backend+Frontend TSC: 0 errors

## Previous: v2.7 — Agent Scoring, Pipeline Fixes, Dashboard Metrics

### Session 2026-04-14 — Agent Scoring + Pipeline Fixes + Dashboard Metrics

**Pipeline Pause & Process Kill:**
- `executionEngine.cancelRunningTasks()` — AbortController + process group kill + stopApp + reset to queued
- `pipeline-engine.ts` pause/resume wired to execution engine

**Vite Crash Prevention:**
- `process.on('uncaughtException')` guard in `console/vite.config.ts` for `ERR_STREAM_WRITE_AFTER_END`
- Proxy SSE stream error handlers

**Reserved Ports:**
- `RESERVED_PORTS = new Set([5173, 4242, 3142])` in `app-runner.ts`
- `resolvePort()` and `nextPort()` skip reserved ports

**Event-Sourced Failure & Rejection Metrics:**
- `analytics-repo.ts` queries `events` table for `task:failed` and `task:review_rejected` counts
- Survives task retries/requeues (snapshot-based metrics reset on retry)
- New event type `task:review_rejected` in `types.ts`

**Token Usage Per Agent:**
- `token_usage` table queried in `getAgentAnalytics` — inputTokens, outputTokens, totalTokens, costUsd
- Dashboard agent cards show Token and Maliyet columns

**Agent Scoring System (0-100):**
- 5-metric weighted score: successRate(30%), firstPassRate(25%), reviewApprovalRate(20%), avgCompletionTime(15%), costEfficiency(10%)
- `firstPassTasks` query: completed tasks with no `task:failed` event in events table
- Weights and baselines configurable via `project_settings` (category: `scoring`)
- UI: score badge on agent avatar, "Takım Skoru" summary card in dashboard

**Revision Stuck Bug Fix (CRITICAL):**
- Bug: `executeTask` guard only accepted `"queued"` status, but `restartRevision` set task to `"running"` → guard skipped → task stuck forever
- Fix: guard now accepts `"running"` too; `_executeTaskInner` skips assignTask/startTask if already running

**Failed Phase Review Dispatch:**
- Bug: `isPhaseFailed` blocked ALL dispatches including review tasks
- Fix: `dispatchReadyTasks` now filters — phase failed → only review tasks dispatched, normal tasks blocked

**Final state:**
- Backend TS: 0 errors
- Frontend tests: 54 AgentDashboard+AgentCard, 62 ProjectSettings — all passed
- Task-engine tests: 13 passed

## Previous Versions
- **v2.0**: 12-agent Scrum, DAG pipeline, review loop, drag-drop builder
- **v2.1**: Runtime system, preview proxy, crash detection, port auto-detect
- **v2.2**: API Explorer, auto-migration, monorepo workspaces, 42 new tests
- **v2.3**: Review loop fixes — await race conditions, review task stage placement, revision auto-restart
- **v2.4**: Preview system — direct URL iframe, port conflict resolution, API_TARGET env injection
- **v2.5**: Security layer, GitHub PR workflow, token analytics (cache tokens), per-agent budget, policy middleware
- **v2.6**: Modular decomposition (routes/ + db/), CI stabilization
- **v2.7**: Agent scoring, pipeline pause/resume, dashboard failure+rejection+token metrics, revision stuck fix
