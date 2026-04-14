# Oscorpex — Status

## Current: v2.7 — Agent Scoring, Pipeline Fixes, Dashboard Metrics

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

### Session 2026-04-13 — Backend Decomposition + CI Fixes
- Faz 1: CI Stabilization (frontend build, backend TS, runtime-analyzer tests, DB test gates)
- Faz 2: Lint (biome.json + biome check --write)
- Faz 3: Frontend unused code removal
- Faz 4: Backend decomposition — routes.ts → 11 modules, db.ts → 15 modules
- Faz 5: Documentation alignment
- Commit: `65de0c9` — 36 files changed

## Previous Versions
- **v2.0**: 12-agent Scrum, DAG pipeline, review loop, drag-drop builder
- **v2.1**: Runtime system, preview proxy, crash detection, port auto-detect
- **v2.2**: API Explorer, auto-migration, monorepo workspaces, 42 new tests
- **v2.3**: Review loop fixes — await race conditions, review task stage placement, revision auto-restart
- **v2.4**: Preview system — direct URL iframe, port conflict resolution, API_TARGET env injection
- **v2.5**: Security layer, GitHub PR workflow, token analytics (cache tokens), per-agent budget, policy middleware
- **v2.6**: Modular decomposition (routes/ + db/), CI stabilization
- **v2.7**: Agent scoring, pipeline pause/resume, dashboard failure+rejection+token metrics, revision stuck fix
