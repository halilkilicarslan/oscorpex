# Oscorpex — Status

## Current: v3.0–v3.4 Stabilization (2026-04-15)

v3.0-v3.9 platformu `db2427e` ile stub olarak landed. Şu an milestone bazlı gerçek implementasyon.

### Session 2026-04-15 — v3.0 B1+B2+B3 + v3.1 + v3.2 + v3.3 + v3.4

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

### Test Durumu
- Backend: 352/352 passing, `pnpm typecheck` 0 hata

### Plan Kaynağı
`.planning/architecture/V3_ROADMAP.md` — v3.0-v3.9 tüm milestone'lar.

### Sıradaki Adımlar
- **v3.5** — Project Lifecycle (maintenance/archived states, hotfix trigger, post-completion report)
- **v3.6** — Agent Communication & Ceremonies (standup/retro)
- **v3.7** — Governance/Policy engine
- **v3.8** — Human Interaction & Agent Chat
- **v3.9** — Sprints & Plugin Architecture

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
