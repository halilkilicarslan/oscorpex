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

### Sıradaki Adımlar
- v3.x tüm milestone'lar stabilize ve UI tam bağlı
- Olası iyileştirmeler: yeni policy condition pattern'leri, model_routing_policies tablo temizliği

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
