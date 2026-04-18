# Oscorpex — Status

## Current: v3.0–v3.9 Stabilization Complete (2026-04-15)

v3.0-v3.9 platformu `db2427e` ile stub olarak landed. Tüm milestones gerçek implementasyonla tamamlandı.

### Session 2026-04-15 — v3.0 B1+B2+B3 + v3.1 + v3.2 + v3.3 + v3.4 + v3.5 + v3.6 + v3.7 + v3.8 + v3.9

**v3.0 B1 — Real Interactive Planner** (commit `b3b282a`, pushed)
- `askuser-json` fenced block pattern, `intake_questions` tablosu, PMChat IntakeQuestionCard.

**v3.0 B2 — AI Task Decomposer** (commit `0a763d0`, pushed)
- `task-decomposer.ts` AI-first + heuristic fallback, 15 unit test.

**v3.0 B3 — Sub-task UI Rollup** (commit `6bc695f`, pushed)
- TaskDetailModal parent/child nav, targetFiles/estimatedLines sections, 5 yeni test.

**v3.2 Work Items Backlog** (commit `3004f7f`, pushed)
- `work-item-planner.ts`, `/plan` REST, auto bug work item on review escalation, 4 PM tools wired, 9 unit test.

**v3.1 Edge Hooks** (commit `aa79e73` + tooltips `a051847`, pushed)
- `edge-hooks.ts`: notification/mentoring/handoff/approval runtime
- `applyPostCompletionHooks` + `taskNeedsApprovalFromEdges` wired into task-engine
- Legend tooltips (TeamBuilder, TeamBuilderPage, TeamTemplatePreview) + Türkçe EDGE_DESCRIPTIONS
- 16 unit test

**v3.3 Incremental Planner** (commit `1b6bc9f`, pushed)
- `incremental-planner.ts`: appendPhaseToPlan / appendTaskToPhase / replanUnfinishedTasks
- PM toolkit 3 tool rewired (buildPlan wrapper / stub / info-only → real mutations)
- Live plan mutation without new plan version
- 14 unit test

**v3.4 Model Routing + Memory** (commit `dcbd990`, pushed)
- execution-engine: task dispatch öncesi `resolveModel(task, { priorFailures, reviewRejections })` — sabit `"sonnet"` yerine tier bazlı model seçimi (S→Haiku, M/L→Sonnet, XL→Opus), retry halinde tier bump, hata durumunda agent.model fallback
- task-engine.markTaskDone sonrasında non-blocking `updateWorkingMemory(projectId)` — snapshot: project status, plan version, task stats, team roster
- `db/memory-repo.ts` 3 latent bug fix: table name (`context_snapshots` → `project_context_snapshots`), 4 upsert'te eksik `id` PK kolonu, `conversation_compactions(project_id, channel)` + `model_routing_policies(scope, task_type, risk_level)` unique index'leri
- 20 yeni unit test (12 model-router + 8 memory-manager)

**v3.5 Project Lifecycle** (prev commit, pushed)
- `lifecycle-routes.ts`: GET /lifecycle (allowed transitions), POST /lifecycle/transition, POST /hotfix, GET /report
- `pipeline-engine.markCompleted` fake event emit yerine real `transitionProject("completed")` + fallback event
- `lifecycle-manager.test.ts`: 17 test (getValidTransitions, transitionProject, triggerHotfix hotfix flow)

**v3.6 Ceremonies** (commit `ec01e9a`, pushed)
- `ceremony-routes.ts`: GET/POST standup + retrospective (+/retro alias)
- ceremony-engine orphanedti, 14 yeni test

**v3.7 Governance/Policy** (commit `ba7f3b2`, pushed)
- task-engine.startTask: `evaluatePolicies(projectId, task)` çağrısı, block/warn action mapping, non-blocking error handling
- policy-engine was orphaned, 16 yeni test (built-in + custom rules + event emission)

**v3.8 Human Interaction** (commit `62c9fd7`, pushed)
- agent-routes: GET/POST /agents/:agentId/chat (chatWithAgent wired)
- lifecycle-routes: GET /report/stakeholder (generateStakeholderReport wired)
- agent-chat.test.ts: 5 test (cross-project rejection, persist user+agent messages)

**v3.9 Sprints + Plugins** (commit `1a5d043`, pushed)
- sprint-routes.ts: GET/POST /sprints, GET /sprints/:id, lifecycle (start/complete/cancel), burndown, velocity
- routes/index.ts: event-bus → notifyPlugins bridge (onTaskComplete, onPipelineComplete, onWorkItemCreated, onPhaseComplete), non-blocking error isolation
- sprint-manager.test.ts: 15 test, plugin-registry.test.ts: 7 test

### Test Durumu
- Backend: 428/428 passing, `pnpm typecheck` 0 hata

### Plan Kaynağı
`.planning/architecture/V3_ROADMAP.md` — v3.0-v3.9 tüm milestone'lar.

### Session 2026-04-16 — UI Validation + Test Coverage + Modularization

- **UI e2e validation**: 8 sayfa doğrulandı (ProjectReport, MessageCenter, KanbanBoard, PMChat, SprintBoard, CeremonyPanel, AgentChat, BacklogBoard)
- **Frontend test coverage**: 175 yeni test (SprintBoard 50, CeremonyPanel 41, BacklogBoard 43, ProjectReport 41)
- **studio-api.ts split** (`e3e71f2`): 2543 satır → 17 modüler dosya (`console/src/lib/studio-api/`). Original file barrel re-export. Tüm import path'ler değişmedi.
- **agent-routes.ts fix** (`82cabba`): 3 eksik await + broadcast type passthrough
- **PolicySection, ModelRoutingSection, MemorySection**: Zaten tam implementli ve backend'e bağlı (orphaned değil).
- Backend: 430/430, Frontend: 393/393 passing.

### Session 2026-04-17 — CLI Usage OAuth Probe + Cursor Agent + Aider Removal

- **Claude OAuth API probe** (`02238b5`): `probeClaudeOAuthAPI()` — `~/.claude/.credentials.json` / macOS Keychain / env var üzerinden OAuth token alır, `api.anthropic.com/api/oauth/usage` endpoint'inden quota bilgisi çeker. Token refresh desteği (`platform.claude.com/v1/oauth/token`). Probe chain: OAuth API → Admin API → CLI /usage → CLI /cost → Local JSONL. `parsePercentQuota` artık "N% used" pattern'ini de tanıyor.
- **Cursor usage probe** (`8e1d80c`): `probeCursor()` — SQLite DB (`~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`) → JWT token → `cursor.com/api/usage-summary`. Aider CLI usage monitoring'den kaldırıldı.
- **Cursor agent execution** (`c7fce96`): Aider → Cursor değişimi tüm katmanlarda:
  - `cli-adapter.ts`: `AiderAdapter` → `CursorAdapter` (`cursor agent -p --output-format json --trust --force`)
  - `cli-language-model.ts`: Cursor case eklendi (binary resolve, invocation, parse)
  - `agent-runtime.ts`: Cursor command mapping
  - `types.ts`: `CLITool`/`CliTool` union'larda `"aider"` → `"cursor"`
  - Frontend: `CLIProviderId`, `CliTool` type'lar, AgentFormModal, PlannerSettingsModal dropdown'ları güncellendi
  - Test: `cli-adapter.test.ts` Cursor test'leri
- Backend: 437/437, Frontend: 433/433, typecheck 0 hata.

### Session 2026-04-17b — Comprehensive Audit + Type Cleanup

- **Audit commit** (`62440ac`): Frontend type safety, dead code removal (872 LOC), 16 route handler try/catch, test fixtures
- **Type rename** (`b3f84ff`): `CLITool` → `AgentCliTool`, `CliTool` → `ProviderCliTool`, orphaned `model_routing_policies` table removed
- Backend: 437/437, Frontend: 433/433, typecheck 0 hata.

### Session 2026-04-17c — Critical Bug Fixes (revision stuck, phase deps, review badge)

- **Revision stuck fix** (`execution-engine.ts`): fire-and-forget `.catch()` in review-reject → revision re-execution now calls `failTask()` on error, preventing permanent "running" stuck state
- **Orphaned running task recovery** (`execution-engine.ts`): `recoverStuckTasks()` now detects running tasks with no active CLI process (`_dispatchingTasks` + `_activeControllers` check) and resets to queued
- **Phase dependency bug** (`pm-agent.ts:buildPlan`): was creating ALL phases with `dependsOn: []` — ignored `dependsOnPhaseOrders` field from planner output. Fixed: resolves phase order→ID mapping and updates phase records
- **PM prompt update** (`pm-agent.ts:PM_SYSTEM_PROMPT`): added explicit `dependsOnPhaseOrders` guidance, examples, and CRITICAL warning about parallel phase execution
- **Review rejected badge** (`TaskCard.tsx`): red border (`border-[#ef4444]/30`) + orange RotateCcw badge showing "Review Rejected" or "Revision #N" for tasks with `reviewStatus === 'rejected'` or `revisionCount > 0`

### Session 2026-04-17d — Context-Mode Native Integration (v4.0 Faz 1-4)

**Faz 1: Context Store** — FTS engine
- `context-store.ts`: 3 chunking algoritması (markdown heading split, JSON recursive key-path, plain-text paragraph/fixed-size)
- `db/context-repo.ts`: `context_sources` + `context_chunks` tabloları, RRF search (tsvector + pg_trgm), batch chunk insert
- `init.sql`: tsvector GIN index, opsiyonel pg_trgm trigram index (DO block fallback)
- `types.ts`: ContextSource, ContextChunk, ContextSearchOptions, ContextSearchResult, ContextContentType, ContextMatchLayer
- `db/helpers.ts`: rowToContextSource, rowToContextChunk
- 21 test

**Faz 2: Output Sandboxing** — Token tasarrufu
- `context-sandbox.ts`: `classifyOutput()` threshold (inline<20KB, compact<100KB, index), `indexTaskOutput()`, `compactCrossAgentContext()` FTS-backed compact refs
- `task-engine.ts`: markTaskDone → non-blocking `indexTaskOutput()` 
- `execution-engine.ts`: buildTaskPrompt — raw 50-dosya listing kaldırıldı → `compactCrossAgentContext()` (FTS search + fallback raw listing)
- 13 test

**Faz 3: Session Events** — Crash recovery
- `context-session.ts`: `trackEvent()` (MD5 dedup, priority eviction max 500/session), `initContextSession()` (10 event-bus bridge), `buildResumeSnapshot()` + `formatResumeSnapshot()`
- `db/context-repo.ts` extended: context_events CRUD (insert, get, isDuplicate, count, evict, cleanup)
- `routes/index.ts`: `initContextSession(eventBus)` çağrısı
- `execution-engine.ts`: retry/revision'da resume snapshot inject
- `init.sql`: context_events tablosu (session_key, dedup index)
- 13 test

**Faz 4: Context Analytics** — Observability
- `context-analytics.ts`: `getContextMetrics()` (sources, chunks, events, tokens), `getPerTaskContextMetrics()`
- `routes/analytics-routes.ts`: GET /projects/:id/analytics/context
- `console/src/lib/studio-api/analytics.ts`: `fetchContextMetrics()` + ContextMetricsResponse
- `console/src/pages/studio/ProjectReport.tsx`: "Context Efficiency" section (4 stat card + per-task breakdown)
- 5 test

**Toplam**: 8 yeni dosya, 10 değiştirilen dosya, 52 yeni test
- Backend: 489/489, Frontend: 433/433, typecheck 0 hata

### Session 2026-04-17e — Context-Mode Deep Integration + E2E Tests

**v4.0 Deep Integration** (commit `4e2c85f`, pushed)
- `context-packet.ts`: FTS search augments completed task section (70% FTS, 30% summaries)
- `context-builder.ts`: RAG+FTS hybrid — pgvector first, then tsvector fills remaining budget
- `prompt-budget.ts`: contextSections tracking in PromptSizeReport + telemetry payload
- `context-store.ts`: recordSearchMetrics (context_search_stats table)
- `context-sandbox.ts`: configurable thresholds via project_settings
- 7 files changed, +151/-55

**E2E Pipeline Tests** (commit `5e2fd32`, pushed)
- `e2e-pipeline.test.ts`: 10 tests, 515 lines, real DB + mock CLI boundary
- Scenarios: single/multi-phase, review loop, auto-retry, dependency ordering, project completion
- Mock: `cli-adapter.ts` → `getAdapter().execute()`

**Test counts**: Backend 499/499, Frontend 433/433, typecheck 0 hata.

### Session 2026-04-17f — v4.1 Features (DiffViewer, Agent Dashboard v2, RAG Observability)

**v4.1 Triple Feature** (commit `5f324fe`, pushed)
- 19 files changed, +1407 lines, 3 new tables, 3 new repos, 4 new components

**Feature 1: DiffViewer UI**
- `task_diffs` table (ON DELETE CASCADE): stores per-file unified diffs for completed tasks
- `diff-capture.ts`: captures git diffs for filesCreated/filesModified after task completion
- `db/diff-repo.ts`: CRUD + batch insert + summary query
- `task-engine.ts`: non-blocking `captureTaskDiffs()` in markTaskDone
- `task-routes.ts`: GET /tasks/:taskId/diffs endpoint
- Frontend: `TaskDiffViewer.tsx` component integrated into TaskDetailModal (collapsible file diffs, +/- coloring)

**Feature 2: Agent Dashboard v2**
- `agent_daily_stats` table (UNIQUE project+agent+date): aggregated daily metrics per agent
- `db/agent-stats-repo.ts`: upsert daily stat, heat map query, performance timeline, agent comparison
- `task-engine.ts`: non-blocking `upsertAgentDailyStat()` in markTaskDone
- `analytics-routes.ts`: 3 new endpoints (agents/heatmap, agents/:agentId/timeline, agents/comparison)
- Frontend: `AgentHeatMap.tsx` component (heat map grid + comparison table), integrated into AgentDashboard

**Feature 3: RAG Observability**
- `context_search_log` table: per-query search tracking (query text, result count, top rank, latency, filters)
- `db/search-log-repo.ts`: insert log + getSearchObservability (stats, hourly breakdown, recent searches)
- `context-store.ts`: per-query `insertSearchLog()` call in searchContext with latency measurement
- `analytics-routes.ts`: GET /analytics/context/observability endpoint
- Frontend: `SearchObservability.tsx` component (4 stat cards, hit rate bar, hourly chart, recent searches table), integrated into ProjectReport

**Test counts**: Backend 499/499, Frontend 433/433, typecheck 0 hata.

### Session 2026-04-18b — UI Language Audit Round 2

- **Commit `0aa3153`**: Comprehensive UI language audit — 20 files, ~200+ Turkish strings → English
  - AlertsPage: empty states, toggle tooltips, pagination, cancel button, cooldown unit
  - PipelineDashboard: all status labels (pipeline + stage + task), action buttons (Start/Pause/Resume/Advance), error messages, stage detail panel, retry tooltip
  - ProjectSettings: all "Kaydet"→"Save", "Sifirla"→"Reset", webhook event labels (11), scoring weight labels (5), policy description, timeout/cost labels
  - StudioHomePage: team recommendation reasons, modal texts, brief description, preview checkbox
  - SprintBoard: modal labels (New Sprint, Name, Goal, Start/End Date, Cancel, Create), validation errors
  - MessageCenter: type labels (Task, Completed, Review, Conflict, Help), timeAgo function, archive tooltip, placeholder
  - PMChat: planner prompt, intake placeholders, plan approval message, Generate Plan button
  - AgentCard: tooltips (Edit/Delete/Run history), run history empty state, exit code label
  - AgentTerminal: status labels (Idle/Starting/Running), terminal ready message, stream tooltip, clear button
  - RuntimePanel: Start App, Databases, Running status, Start/Stop buttons, Status Summary, Save .env
  - DiffViewer: revert modal (title, description, buttons), locale en-US, error message
  - FileExplorer: No Repository empty state, New file tooltip
  - TaskDetailModal: Assigned Agent, Close button
  - TaskCard: error toggle tooltip
  - PlatformDashboard: error messages, timeAgo (m/h/d ago)
  - AgentDashboard: stat labels (Assigned/Done/Failed/Rejected)
  - TerminalSheet: loading buffer text
  - team-graph-shared: all 12 edge descriptions
- Typecheck clean, 0 errors

## Session 2026-04-18 — UI/UX Audit & Language Standardization

**UI/UX Audit** (commit `84d1366`, pushed)
- 17 files changed, 245 insertions, 239 deletions
- **Language consistency**: ~100+ Turkish UI strings converted to English across all pages
- **% format fix**: Turkish `%85` → international `85%` across all dashboards
- **Sidebar fixes**: Duplicate "Dashboard" → "Overview", OSCORPEX section now collapsible, NavLink end prop for studio routes, doc link updated
- **TopBar fixes**: apiUrl input now wired to connection check (was hardcoded), GitHub link corrected, org label "My Organization" → "Workspace"
- **ProjectPage**: "Ayarlar" → "Settings", tab bar horizontal scroll overflow with `.scrollbar-none`
- **Dashboard padding**: PlatformDashboard + InsightDashboard get `p-6` page padding
- **Files touched**: Sidebar, TopBar, ProjectPage, PlatformDashboard, InsightDashboard, KanbanBoard, PMChat, TaskDiffViewer, TerminalSheet, AgentDashboard, FileExplorer, PlannerSettingsModal, AlertsPage, SearchObservability, MessageCenter, AgentGrid, index.css
- Typecheck: 0 errors

### Sıradaki Adımlar
- v4.0-v4.1 tamamlandı (context-mode + DiffViewer + Agent Dashboard v2 + RAG Observability)
- UI/UX audit tamamlandı — tüm UI text artık İngilizce
- Potansiyel: Webhook notifications, Frontend Performance, i18n

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

## Previous: v2.7 — Agent Scoring, Pipeline Fixes, Dashboard Metrics

### Key fixes
- Revision stuck bug: `executeTask` accepts both "queued" and "running"
- Failed phase review dispatch: phase failed → only review tasks dispatched
- Event-sourced failure/rejection metrics (survives retry)
- Reserved ports: 5173, 4242, 3142
- Vite crash guard: `process.on('uncaughtException')` in vite.config.ts
- Agent scoring (0-100): 5-metric weighted, configurable via project_settings

## Previous Versions
- **v2.0**: 12-agent Scrum, DAG pipeline, review loop, drag-drop builder
- **v2.1**: Runtime, preview proxy, crash detection, port auto-detect
- **v2.2**: API Explorer, auto-migration, monorepo workspaces
- **v2.3**: Review loop fixes — race conditions, stage placement, auto-restart
- **v2.4**: Preview system — direct URL iframe, port conflict, API_TARGET
- **v2.5**: Security layer, GitHub PR, token analytics, per-agent budget, policy
- **v2.6**: Modular decomposition (routes/ + db/), CI stabilization
- **v2.7**: Agent scoring, pipeline pause/resume, revision stuck fix
