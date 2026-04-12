# Oscorpex — Architecture

## Stack
- Runtime: Node.js + tsx
- Backend: Hono (via VoltAgent server-hono), port 3141
- Database: better-sqlite3 (WAL, FK), 16 tables
- AI Execution: CLI-only (Claude CLI `executeWithCLI` / `streamWithCLI`) — no AI SDK in execution path
- Frontend: React 18 + Vite (port 5173) + Tailwind CSS
- Terminal: @xterm/xterm v6 + addon-fit
- Git: simple-git

## Backend Modules (src/studio/)
| Module | Purpose |
|--------|---------|
| types.ts | 35+ interfaces, AgentRole, MessageType, PipelineStatus |
| db.ts | SQLite schema (16 tables), all CRUD, seeds |
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
| routes.ts | 100+ Hono routes at /api/studio (includes preview proxy) |
| webhook-sender.ts | Webhook delivery for events |

## DB Tables (16)
projects, project_plans, phases, tasks, agent_configs, project_agents,
team_templates, events, chat_messages, ai_providers,
agent_messages, pipeline_runs, agent_runs,
agent_dependencies, agent_capabilities, project_settings

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
