# Oscorpex — Architecture

## Stack
- Runtime: Node.js + tsx
- Backend: Hono (via VoltAgent server-hono), port 3141
- Database: PostgreSQL (pg), 16+ tables
- AI Execution: CLI-only (Claude CLI `executeWithCLI` / `streamWithCLI`) — no AI SDK in execution path
- Frontend: React 19 + Vite (port 5173) + Tailwind CSS
- Terminal: @xterm/xterm v6 + addon-fit
- Git: simple-git

## Backend Modules (src/studio/)
| Module | Purpose |
|--------|---------|
| types.ts | 35+ interfaces, AgentRole, MessageType, PipelineStatus |
| **db/** | Modular DB layer (15 files, see below) |
| db.ts | Backward-compat shim → re-exports from db/index.js |
| event-bus.ts | Pub/sub with DB persistence |
| pm-agent.ts | PM system prompt + 4 AI SDK tools |
| ai-provider-factory.ts | getAIModel() dynamic from DB |
| task-engine.ts | Task lifecycle + onTaskCompleted hook |
| execution-engine.ts | Plan → task dispatch → CLI execution |
| pipeline-engine.ts | DAG-based pipeline orchestrator |
| agent-messaging.ts | Agent inbox, threads, broadcast, pipeline-notify |
| agent-runtime.ts | CLI process spawn, SSE streaming, run history |
| agent-log-store.ts | File-based agent output persistence (.voltagent/logs/) |
| runtime-analyzer.ts | Framework/DB/env detection, port parsing, .studio.json gen |
| db-provisioner.ts | Docker DB provisioning with auto port conflict resolution |
| app-runner.ts | 3-strategy app launch (config → runtime analysis → Docker Compose) |
| git-manager.ts | Git operations + file CRUD |
| agent-files.ts | .md file system per agent |
| **routes/** | Modular Hono routes (11 files, see below) |
| routes.ts | Backward-compat shim → re-exports studioRoutes from routes/index.js |
| webhook-sender.ts | Webhook delivery for events |
| capability-resolver.ts | Role-based CLI tool restrictions |
| secret-vault.ts | AES-256-GCM encrypt/decrypt for API keys |
| command-policy.ts | Prompt-level command restrictions per role |
| github-integration.ts | Octokit PR creation + repo info |
| middleware/policy-middleware.ts | Hono budget guard + capability guard |

## Modular Routes (src/studio/routes/) — v2.6 decomposition
Previously monolithic routes.ts (3200+ lines) split into 11 sub-routers mounted via Hono `route('/')`:
- `index.ts` — mount point, budget guard, event bus → webhook bridge
- `project-routes.ts` — Project CRUD + Plan + Chat
- `task-routes.ts` — Tasks, Approvals, Stream
- `agent-routes.ts` — Agent Management + Runs
- `team-routes.ts` — Team CRUD + Files
- `git-file-routes.ts` — File CRUD + Git Ops
- `pipeline-routes.ts` — Pipeline Engine
- `analytics-routes.ts` — Analytics + Costs + Budgets
- `runtime-routes.ts` — App Runner + Runtime Config
- `integration-routes.ts` — GitHub + API Explorer + Webhooks
- `provider-routes.ts` — AI Providers + Fallback

URL structure unchanged — all mounted at `/api/studio`. External imports still use `./routes.js` (shim).

## Modular DB (src/studio/db/) — v2.6 decomposition
Previously monolithic db.ts (2280+ lines) split into 15 repo modules:
- `index.ts` — re-exports everything (backward compat)
- `helpers.ts` — row mappers (rowToProject, rowToTask, ...) + now()
- `project-repo.ts` — Project + Plan + Phase CRUD
- `task-repo.ts` — Task CRUD + lifecycle
- `agent-repo.ts` — Agent Config + Project Agent
- `team-repo.ts` — Team Templates + Custom Teams
- `provider-repo.ts` — AI Provider + Fallback Chain
- `analytics-repo.ts` — Token Usage + Cost + Analytics
- `event-repo.ts` — Events + Chat Messages
- `pipeline-repo.ts` — Pipeline Runs + Agent Runs
- `dependency-repo.ts` — Dependencies + Capabilities
- `webhook-repo.ts` — Webhooks + Deliveries
- `settings-repo.ts` — Project Settings
- `seed.ts` — seedPresetAgents + seedTeamTemplates
- `reset.ts` — resetDb (pool close, for tests)

All repos use shared `getPool()` from `src/studio/pg.ts`. External imports still use `./db.js` (shim).

## DB Tables (16+)
projects, project_plans, phases, tasks, agent_configs, project_agents,
team_templates, events, chat_messages, ai_providers,
agent_messages, pipeline_runs, agent_runs,
agent_dependencies, agent_capabilities, project_settings,
token_usage (with cache_creation_tokens, cache_read_tokens)

## Agent Scoring System (v2.7)
- Computed in `analytics-repo.ts:getAgentAnalytics()` per agent
- 5 metrics: successRate(W_SUCCESS), firstPassRate(W_FIRST_PASS), reviewApprovalRate(W_REVIEW), timeScore(W_TIME), costScore(W_COST)
- Weights & baselines from `project_settings` (category: `scoring`), defaults: 30/25/20/15/10, 30min, $0.50
- `firstPassTasks`: tasks completed without any `task:failed` event (query events table by task_id)
- UI: score badge on avatar (AgentDashboard.tsx), "Takım Skoru" average card

## Reserved Ports (v2.7)
- `app-runner.ts`: `RESERVED_PORTS = new Set([5173, 4242, 3142])`
- 5173=frontend Vite, 4242=backend API, 3142=WebSocket
- `resolvePort()` and `nextPort()` skip these

## 12-Agent Scrum Team (v2.0)
PM, Designer, Architect, Frontend, Backend, Coder, QA, Reviewer, DevOps,
DataEngineer, SecurityEngineer, TechWriter

## Pipeline
DAG-based with agent_dependencies table — dynamic stage ordering
Review loop: Reviewer → assigned dev → Reviewer (iterative)

## Runtime System (3-Layer)
1. **Runtime Analyzer**: Framework detection (15+ frameworks), DB detection, env parsing, smart port detection (.env → source code → framework default)
2. **DB Provisioner**: Docker container lifecycle, auto port conflict resolution (findAvailablePort), health checks
3. **Smart App Runner**: 3-strategy fallback (.studio.json → runtime analysis → Docker Compose), post-start health check

## Preview System
- iframe loads direct URL (e.g. http://localhost:5182) — NOT through proxy (proxy breaks ES module imports)
- Reverse proxy at `/projects/:id/app/proxy/*` — used only for API-only detection + `<base>` tag injection
- API-only apps: auto-detect (root 404) → show info page with health endpoint link
- Service switching: `switchPreviewService()` changes proxy target, inline badges in toolbar
- Port conflict resolution: `isPortInUse()` via lsof, `resolvePort()` auto-increment
- Cross-service routing: `API_TARGET` env var injected for frontend Vite proxy target
- Vite proxy: `/api/studio` → localhost:3141

## Frontend Pages (console/src/pages/studio/)
StudioHomePage, ProjectPage (11 tabs), PMChat, PlanPreview, AgentGrid,
AgentCard, AgentDetailModal, AgentFormModal, OrgChart, AgentTerminal,
KanbanBoard, PipelineDashboard, TaskCard, TaskDetailModal,
FileExplorer, EventFeed, MessageCenter, ProvidersPage,
LivePreview, RuntimePanel, ProjectSettings, TerminalSheet, ApiExplorer

## Key Execution Flow
1. Plan approval → `startProjectExecution()` → `beginExecution()` → first phase tasks
2. `executeTask()` → `assignTask()` → `startTask()` → `executeWithCLI()` → `completeTask()`
3. `completeTask()` checks reviewer → creates review task → `notifyCompleted()` → dispatch
4. `onTaskCompleted` callback → scans all running/completed phases → dispatches ready tasks
5. Review rejection → `submitReview(false)` → revision → auto `restartRevision()` + re-execute
6. Startup: `recoverStuckTasks()` resets running→queued, restarts revisions, dispatches orphans
