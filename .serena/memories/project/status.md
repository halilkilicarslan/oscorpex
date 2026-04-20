# Oscorpex — Status

## Current: v7.0 Agentic Refactor — ALL 3 PHASES COMPLETE (2026-04-20)

Master Plan fully executed. 18 workstreams across 3 phases. 50 dedicated unit tests + 40 API endpoints added.
971/971 tests, typecheck clean.
Master Plan: `.planning/Oscorpex_Agentic_Refactor_Master_Plan.md`.
Architecture Analysis: `.planning/ARCHITECTURE_ANALYSIS.md`.

**Phase 1 Stabilization** (`fb906a2`): 7 workstreams (A–G), 15 files, +2891 lines.
- A: Pipeline State Consistency — DB-authoritative mutatePipelineState() (SELECT FOR UPDATE + version)
- B: Distributed Task Dispatch — claimTask() SKIP LOCKED, releaseTaskClaim(), worker ID
- C: Output Verification Gate — output-verifier.ts (files_exist, files_modified, output_non_empty)
- D: Test Gate — test-gate.ts (required/optional/skip policy, auto-detect vitest/jest)
- E: RLS Enablement — 14 tables enabled, setTenantContext() in auth middleware
- F: Cost Circuit Breaker — budget-guard.ts (auto-pause on budget breach)
- G: Graceful Provider Failure — isAllExhausted() + deferred retry instead of fail

**Phase 2 Agentic Core** (`bded3d2`): 6 workstreams (H–M), 18 files, +1807 lines.
- H: Episodic Memory — episode-repo.ts + agent-memory.ts (behavioral context for prompt injection)
- I: Strategy-Based Agents — strategy-repo.ts + agent-strategy.ts (9 builtin strategies, pattern-derived selection)
- J: Observation-Action Loop — session-repo.ts + agent-session.ts (bounded lifecycle, strategy init + memory)
- K: Dynamic Task Injection — proposal-repo.ts + task-injection.ts (runtime proposals, auto-approve low-risk)
- L: Structured Inter-Agent Protocol — protocol-repo.ts + agent-protocol.ts (request_info, blocker_alert, handoff, decision)
- M: Governance Upgrade — approval-repo.ts + agent-constraints.ts (risk classification, approval rules)

**Phase 3 Dynamic Platform** (`4d23268`): 5 workstreams (N–R), 11 files, +1516 lines.
- N: Dynamic Coordination Graph — graph-mutation-repo.ts + graph-coordinator.ts (insert/split/edge/defer/merge, audit trail)
- O: Adaptive Replanning — adaptive-replanner.ts (phase-boundary triggers, plan patches, auto/approval)
- P: Goal-Based Execution — goal-engine.ts (goals with constraints + success criteria, prompt injection)
- Q: Sandbox & Capability Isolation — sandbox-manager.ts (policies, sessions, violation tracking)
- R: Cross-Project Learning — cross-project-learning.ts (anonymized pattern extraction, tenant→global promotion)

**Phase 2+3 Unit Tests** (`2dfb8a1`): 50 tests total.
- `agent-runtime.test.ts`: 26 tests — Memory (3), Strategy (3), Session (4), Protocol (7), Constraints (6), Injection (3)
- `phase3-modules.test.ts`: 24 tests — Graph (6), Goals (4), Sandbox (6), Replanner (3), Learning (2), Policy Resolution (3)

**Phase 2+3 API Routes** (`d3e3eea`): 3 route files, ~40 endpoints.
- `agentic-routes.ts`: Sessions, Episodes, Strategies, Protocol, Proposals, Risk, Approval Rules
- `graph-routes.ts`: Graph Mutations, Goals, Replanning, Cross-Project Learning
- `sandbox-routes.ts`: Sandbox Policies, Session Violations
- All registered in `routes/index.ts`

**Supplementary Sections + Frontend** (`436797c`): 12 files, +1055 lines.
- Section 13: 13 new EventType values + ALL_PLUGIN_EVENTS bridge registration
- Section 14.3: `agent_capability_grants` table + `capability-grant-repo.ts` (8 tokens, role defaults) + REST endpoints
- Section 18: `agentic-metrics.ts` — 10 observability metrics (claim latency, verification rate, strategy success, retries, rejection by role, proposals, graph stats, replan freq)
- Frontend: `AgenticPanel.tsx` tab (metrics, proposals, goals, mutations, sessions, grants) + `studio-api/agentic.ts` (full API client)

**Runtime Wiring** (`be2e630`): 9 files, event types + capability enforcement.
- 8 `as any` event type casts replaced with proper v7.0 typed events
- agent-session: emits `agent:session_started` + `agent:strategy_selected`
- task-injection: `hasCapability()` gate before proposal auto-approve
- graph-coordinator: `pipeline:graph_mutated` → `graph:mutation_applied` (4 sites)
- budget-guard: `pipeline:budget_exceeded` → `budget:halted`
- adaptive-replanner: `pipeline:replanned` → `plan:replanned`
- output-verifier: emits `verification:passed` / `verification:failed`
- provider-state: emits `provider:degraded` on rate limit
- agent-protocol: `agent:error` → `agent:requested_help` for blockers
- Test fix: `hasCapability` added to agent-runtime.test.ts db mock

**v7.0 Supplementary Unit Tests** (`4b89671`): 19 new tests.
- `capability-grant-repo.test.ts`: 11 DB-backed tests (upsert, conflict update, list by role/all, hasCapability explicit/default/unknown, delete, getDefaultGrantsForRole)
- `agentic-metrics.test.ts`: 8 mock-based tests (zero defaults, claim latency parsing, strategy rates, rejection by role, graph mutations, replan triggers, zero-division, parallel query count)
- Total test count: 990/990 passing, typecheck clean.

**Type Safety Cleanup** (`8b9a1f1`): 25+ `as any` casts eliminated across 9 files.
- EventType: +12 variants (pipeline:stage_started/stage_completed/paused/resumed/failed/degraded/rate_limited/branch_created/branch_merged, plan:phase_added, task:added, goal:evaluated)
- TaskStatus: +3 variants (blocked, deferred, cancelled)
- updateTask Pick: +dependsOn field with JSON handler
- 19 event type casts, 5 status casts, 2 dependsOn casts removed
- Remaining as-any: reviewTaskId (no DB column), cli-usage JSON parse, container/app-runner runtime, pm-agent taskType

**AgenticPanel Frontend Tests + Error Type Fix** (`6a8272a`): 27 new frontend tests + 7 more `as any` eliminated.
- `AgenticPanel.test.tsx`: 27 tests — metrics (stat cards, strategy rates, rejection bars, injected volume), proposals (approve/reject/empty), goals (constraints, empty), graph mutations (expand/empty), sessions (expand/empty), capability grants (toggle/empty), refresh, error resilience, pending counts in section titles
- Task.error type: `string | undefined` → `string | null | undefined` — eliminates 5 null-as-any in task-engine
- 2 additional as-any removed (fallback/escalation updateTask calls)
- Backend 990/990, Frontend 541/541, typecheck clean

**Section 17 Regression Tests** (`d541ea4`): 4 test files, 25 tests.
- `concurrent-dispatch.test.ts`: SKIP LOCKED race condition (two workers, exactly one wins), already-claimed blocked, release+reclaim, independent multi-task claims
- `restart-recovery.test.ts`: mutatePipelineState persistence after cold restart, version increment (optimistic concurrency), concurrent mutations via SELECT FOR UPDATE, cold-read survives process restart
- `tenant-rls.test.ts`: RLS isolation suite (skip if FORCE ROW LEVEL SECURITY not set), tenant A/B cross-visibility blocked, setTenantContext transaction-scoped validation
- `graph-approval.test.ts`: insertNode, splitTask (blocks parent + creates children), addEdge, removeEdge, deferBranch (queued-only filtering), mutation audit trail, event emission, requiresApproval high/low risk
- Backend 1009/1009 (5 skip), Frontend 541/541, typecheck clean
- **Master Plan Section 17 COMPLETE — all regression test categories covered**

**Serena Memory Update** (`805d1ec`): Section 17 status update pushed.

## Tooling
- Context-Mode plugin v1.0.89 installed and verified (doctor: all PASS)
- See Serena memory `context-mode/setup` for full details
- Section 13: 13 new EventType values + ALL_PLUGIN_EVENTS bridge registration
- Section 14.3: `agent_capability_grants` table + `capability-grant-repo.ts` (8 tokens, role defaults) + REST endpoints
- Section 18: `agentic-metrics.ts` — 10 observability metrics (claim latency, verification rate, strategy success, retries, rejection by role, proposals, graph stats, replan freq)
- Frontend: `AgenticPanel.tsx` tab (metrics, proposals, goals, mutations, sessions, grants) + `studio-api/agentic.ts` (full API client)

Previous: V6 Roadmap Complete. All V6 milestones delivered. Backend 921/921, Frontend 514/514.
Roadmap: `.planning/V6_ROADMAP.md`. Completion report: `.planning/V6_COMPLETION_REPORT.md`.

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

### Session 2026-04-19 — Analysis Report + Phase 1 Quick Wins + Phase 2 Security

**Comprehensive Analysis Report** — 5-domain parallel analysis (backend quality, security, architecture, frontend, performance). 115 findings (14 CRITICAL, 36 HIGH, 41 MEDIUM, 24 LOW). Report: `.planning/ANALYSIS_REPORT.md`. 5-phase roadmap.

**Phase 1 Quick Wins** (commit `2a6bf32`, pushed)
- 8 DB indexes (tasks.status, tasks.assigned_agent, events.type, events.project_id+type, events.timestamp, token_usage.agent_id, agent_runs.status, context_events.project_id+task_id)
- `updateTask` RETURNING * (eliminate SELECT round-trip)
- EventBus empty Set cleanup (memory leak prevention)
- `getActivityTimeline` Promise.all (3 sequential→parallel queries)
- KanbanBoard polling 5s→15s

**Phase 2 Security Foundation** (commit `abf5d92`, pushed)
- Command injection fix: `execSync` → `execFileSync` with array args (diff-capture.ts, app-runner.ts)
- Path traversal fix: `validateFilePath()` on wildcard GET/PUT file routes (git-file-routes.ts)
- CORS middleware: configurable `OSCORPEX_CORS_ORIGINS` env var (routes/index.ts)
- Opt-in Bearer auth: `OSCORPEX_API_KEY` env var, SSE streams exempt (routes/index.ts)
- Frontend auth headers: `VITE_API_KEY` injection in studio-api base.ts
- Backend: 499/499, Frontend: 432/433 (1 pre-existing ProjectReport)

**Phase 3 N+1 Elimination** (commit `9d877dc`, pushed)
- `getAgentAnalytics` CTE refactor: 108 DB round-trips → 3 bulk queries (analytics-repo.ts)
- `listPhases` LEFT JOIN: N+1 per-phase task queries → single JOIN query (project-repo.ts)
- `getProjectIdForTask` LRU cache: 9 call sites hit in-memory Map, cap 500 (task-engine.ts)
- Batch unread counts: GET /agents/unread-counts + frontend batch (agent-messaging.ts, agent-routes.ts, ProjectPage.tsx, MessageCenter.tsx)
- Bulk budget status: `getAllAgentCostSummaries` GROUP BY replaces per-agent cost queries (analytics-repo.ts, analytics-routes.ts)
- Backend: 499/499, Frontend: 432/433 (1 pre-existing ProjectReport)

**Phase 4 Frontend Refactor** (commit `f6b0cae`, pushed)
- React.memo: TaskCard, AgentCard wrapped
- useMemo: KanbanBoard (subTaskMap, grouped, activeColumns), ProjectPage (plannerAgent, visibleTabs)
- StudioHomePage split: 1497→144 lines, extracted CreateProjectModal/ImportProjectModal/TemplateProjectModal/ProjectCard
- ModalOverlay component: focus trap, Escape key, aria-modal — applied to 4 modals (RejectModal, TaskDetail, NewSprint, NewItem)
- React.lazy: 10 ProjectPage tabs + AgentGrid sub-components (OrgChart, TeamTemplatePreview)
- Pre-existing ProjectReport test fix (fetchSearchObservability mock)

**Phase 5 Architecture Improvements** (commit `b201394`, pushed)
- TIMESTAMPTZ migration: 25 TEXT→TIMESTAMPTZ columns in init.sql (idempotent DO block with information_schema checks)
- tasks.project_id: denormalized column + backfill UPDATE via phases→project_plans JOIN + idx_tasks_project_id
- API pagination: 5 endpoints (projects, tasks, messages, work-items, events) with LIMIT/OFFSET + X-Total-Count headers
- Concurrency limiter: Semaphore class (acquire/release pattern), MAX_CONCURRENT_TASKS=3 (env configurable OSCORPEX_MAX_CONCURRENT_TASKS)
- Bug fix: duplicate dispatch race condition — onTaskCompleted callback + dispatchReadyTasks could concurrently assignTask same task. Fixed with DB re-read + try/catch conflict resolution in _executeTaskInner
- Backend: 499/499, Frontend: 433/433, typecheck 0 hata

### v5 M1 — Polling Elimination (commit `e6b7449`, pushed)
- `useWsEventRefresh` hook: WS event→debounced callback, `isWsActive` for polling fallback
- Backend: `message:created` event type + emit in agent-messaging.ts
- 8 components migrated (10 polling loops eliminated):
  - PipelineDashboard (3s→WS), AgentCard (3s→WS), AgentTerminal (3s→WS)
  - KanbanBoard (15s→WS), AgentGrid (5s→WS), MessageCenter (5s→WS)
  - ProjectPage (5s+10s→WS), AgentDashboard (30s→WS)
- All retain polling fallback when WS disconnected
- V5 roadmap: `.planning/V5_ROADMAP.md` (6 milestones, ~12 weeks)
- Backend 499/499, Frontend 433/433

### v5 M2 — Frontend Pagination + Charts (commit `150bd51`, pushed)
- `fetchPaginated<T>()` helper: reads X-Total-Count header, returns PaginatedResult
- 4 paginated API variants: projects, tasks, messages, work-items
- `Pagination` component (prev/next, dark theme) + `useInfiniteList` hook (load-more pattern)
- 4 pages paginated: StudioHomePage, KanbanBoard, MessageCenter, BacklogBoard
- 4 Recharts chart components (lazy-loaded via React.lazy + Suspense):
  - CostTrendChart (LineChart — daily cost trend)
  - VelocityTrendChart (BarChart — sprint velocity)
  - AgentTimelineChart (AreaChart — dual axis tokens + cost)
  - ComplexityPieChart (PieChart — S/M/L/XL distribution)
- Charts integrated: AgentDashboard, SprintBoard, ProjectReport
- recharts v3.8.1 added
- Backend 499/499, Frontend 433/433

### v5 M3 + M4 — Durable Events + Multi-Provider (commit `f984704`, pushed)

**M3 — PostgreSQL LISTEN/NOTIFY:**
- `pg-listener.ts`: dedicated PG connection with LISTEN, auto-reconnect (2s delay, max 5 retries)
- `event-bus.ts`: emit/emitAsync → pg_notify after insertEvent, dedup via _recentlyEmitted Set (5s TTL)
- `event-repo.ts`: getEvent(id) for notification payload fetch
- `routes/index.ts`: initPgListener() at startup
- emitTransient unchanged (in-memory for high-freq agent:output)
- 12 new tests

**M4 — Multi-Provider Execution + Fallback:**
- `CodexAdapter` real implementation (spawn, JSON parse, OpenAI cost estimate)
- Provider-aware `resolveModel`: codex→openai (gpt-4o-mini/gpt-4o/o3), cursor→cursor (small/large)
- `getAdapterChain(primary, fallbacks)` in cli-adapter.ts
- `provider-state.ts`: ProviderStateManager (markRateLimited/markSuccess/markFailure/isAvailable)
- execution-engine: adapter chain loop with per-provider state, rate limit → skip to next
- GET /providers/status endpoint
- token_usage.provider column migration
- 21 new tests

Backend 531/531, Frontend 433/433, typecheck clean.

### v5 M5 — Plugin SDK v1 (commit `54e4c8f`)
- `plugin-registry.ts` refactor: PluginManifest, PluginContext, PluginHandler types
- Hook filtering: 4 → 35 event types, manifest.hooks based subscription
- Promise.race timeout (5s default, manifest configurable), per-plugin error isolation
- Non-blocking execution logging to plugin_executions table
- `plugin-repo.ts`: DB CRUD (registered_plugins + plugin_executions)
- `plugin-routes.ts`: GET/PATCH/DELETE /plugins + GET /plugins/:name/executions
- ALL_PLUGIN_EVENTS bridge in routes/index.ts (replaces old 4-hook bridge)
- Backward-compatible legacy API preserved (v3.9 PluginHooks)
- 23 new tests (12 plugin-sdk + 11 plugin-repo)

### v5 M6.1 — User Identity Foundation (commit `0af1420`)
- DB: tenants, users, user_roles, api_keys tables + projects.tenant_id/owner_id columns
- `auth/jwt.ts`: HMAC-SHA256 JWT sign/verify (node:crypto, no deps)
- `auth/password.ts`: scrypt hashing + timingSafeEqual verification
- `auth/auth-middleware.ts`: tri-mode auth (env API key / JWT / DB osx_ key), backward-compatible
- `db/tenant-repo.ts`: tenant, user, role, API key CRUD (barrel-exported)
- `routes/auth-routes.ts`: POST /auth/register, POST /auth/login, GET /auth/me
- authMiddleware imported but commented out (activates in M6.2)
- 15 new tests
- Backend 573/573, Frontend 433/433, typecheck clean

### v5 M6.2 + M6.3 — RLS + RBAC (commit `1764f3c`)
- `tenant-context.ts`: getTenantContext(), withTenantFilter(), verifyProjectAccess()
- Auth opt-in: OSCORPEX_AUTH_ENABLED=true (default off, backward-compat)
- Project routes: tenant filter, SSE ?token= query param auth
- `rbac.ts`: 5 roles (owner>admin>developer>viewer>billing), wildcard permissions
- requirePermission() middleware on critical endpoints (project CRUD, pipeline, plugins)
- Admin routes: GET /auth/users, PATCH /auth/users/:id/role, POST/GET/DELETE /auth/api-keys
- 29 new tests (12 tenant-context + 17 rbac)
- Backend 605/605

### v5 M6.4 — Tenant Isolation Hardening (commit `d1a00ab`)
- PG RLS policy (projects_tenant_isolation) defined but NOT enabled yet
- setTenantContext() for PG session tenant context (RLS-ready)
- WS tenant scoping: ?token= JWT parse, project tenant check on subscribe
- API key scope enforcement: wildcard/resource wildcard/exact match in rbac.ts
- logTenantActivity() audit log on register, role change, API key ops
- 28 new tests
- Backend 633/633, Frontend 433/433, typecheck clean

### V6 ROADMAP COMPLETE (2026-04-20)

All 6 V6 milestones delivered in single session:
- M1 Auth UI + Notifications (`f11afa0`) — 22 new tests
- M2 Cost Intelligence + Auto Testing (`081c8fe`) — 45 new tests
- M3 Templates v2 + GitHub/GitLab v2 (`aa9239a`) — 66 new tests
- M4 pg-boss Durable Queue (`b95877b`) — 32 new tests
- M5 CLI Tool + OpenTelemetry (`df91c25`) — 67 new tests
- M6 Scale Foundation (`9e64eee`) — 122 new tests
Total: ~55 new files, ~15,500 new LOC, 354 new tests.
Backend: 921/921, Frontend: 514/514, typecheck clean.

### V5 ROADMAP COMPLETE
All 6 milestones delivered:
- M1 Polling Elimination (`e6b7449`)
- M2 Pagination + Charts (`150bd51`)
- M3 Durable Events LISTEN/NOTIFY (`f984704`)
- M4 Multi-Provider Fallback (`f984704`)
- M5 Plugin SDK v1 (`54e4c8f`)
- M6 Multi-Tenant RBAC (`0af1420` → `d1a00ab`, 4 phases)
Total: 633 backend tests, 433 frontend tests, 0 typecheck errors.

### Completed Analysis Roadmap
All 5 phases from analysis report complete:
1. Quick Wins (indexes, RETURNING, polling) — `2a6bf32`
2. Security Foundation (injection, traversal, CORS, auth) — `abf5d92`
3. N+1 Elimination (CTE, JOIN, cache, batch) — `9d877dc`
4. Frontend Refactor (memo, lazy, split, a11y) — `f6b0cae`
5. Architecture Improvements (TIMESTAMPTZ, pagination, semaphore) — `b201394`

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
