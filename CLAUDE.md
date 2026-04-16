# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Backend (root)
pnpm dev              # Start backend with tsx watch (port 3141, studio API at /api/studio)
pnpm typecheck        # tsc --noEmit
pnpm lint             # biome check ./src
pnpm lint:fix         # biome check --write ./src
pnpm test             # vitest run (all backend tests)
pnpm test -- --testPathPattern=task-engine   # Run single test file

# Frontend (console/)
cd console && pnpm dev        # Vite dev server (port 5173)
cd console && pnpm test:run   # vitest run (all frontend tests)
cd console && pnpm tsc -b     # Frontend typecheck

# Docker
pnpm docker:up        # Start PostgreSQL + services
pnpm docker:down      # Stop all containers
```

## Architecture

Oscorpex is an AI-powered software development platform where users describe an idea, and a 12-agent Scrum team (PM, Tech Lead, Frontend Dev, Backend Dev, QA, Security, etc.) builds it autonomously through a DAG pipeline.

### Backend (`src/`)

**Entry point**: `src/index.ts` — VoltAgent app with Hono server. Studio routes mounted at `/api/studio`.

**Core engine flow** (all in `src/studio/`):
1. **pm-agent.ts** — PM agent analyzes requirements, asks user questions, generates a phased plan with tasks
2. **execution-engine.ts** — Dispatches tasks to agents via CLI execution (Claude Code / Codex / Aider). Auto-decomposes L/XL tasks into micro-tasks via `task-decomposer.ts`
3. **task-engine.ts** — Task lifecycle: assign → start → done/fail. Handles review loops, sub-task rollup, escalation/fallback edges, auto work-item creation on failure
4. **pipeline-engine.ts** — DAG orchestrator using Kahn's algorithm (`buildDAGWaves()`). Manages phase progression with 12 edge types. `refreshPipeline()` rebuilds DAG without resetting completed stages

**Database layer** (`src/studio/db/`):
- `pg.ts` — PostgreSQL pool with `query()`, `queryOne()`, `execute()`, `withTransaction()` helpers
- `db/index.ts` — Re-exports all 17 repo modules (single import: `from "./db.js"`)
- `helpers.ts` — Row mappers (`rowToTask`, `rowToProject`, etc.) and `now()` utility
- Schema: `scripts/init.sql` (idempotent, applied at startup via `db-bootstrap.ts`)

**Routes** (`src/studio/routes/`):
- 12 Hono sub-routers registered in `routes/index.ts`, mounted under `/api/studio`
- Route files import from `../db.js` (the barrel export), not individual repos

**Key supporting modules**:
- `event-bus.ts` — Event sourcing for state transitions (`task:completed`, `task:failed`, `pipeline:completed`, etc.)
- `context-packet.ts` — Token-efficient prompt assembly with mode-based context (planner/execution/review)
- `model-router.ts` — Complexity-based model selection (S→Haiku, M→Sonnet, L→Sonnet, XL→Opus)
- `team-architect.ts` — AI-powered team composition from templates
- `app-runner.ts` — Runs generated apps, reserves ports 5173/4242/3142

### Frontend (`console/`)

React 19 + Vite + Tailwind 4 + React Router. Dark theme: bg `#0a0a0a`, cards `#111111`, borders `#262626`, accent `#22c55e`.

- **Pages**: `console/src/pages/studio/` — 36 pages (ProjectPage, KanbanBoard, AgentDashboard, PMChat, BacklogBoard, SprintBoard, etc.)
- **API layer**: `console/src/lib/studio-api/` — Modular API client (17 files: base, types, projects, plans, tasks, agents, chat, pipeline, messaging, analytics, providers, settings, git, app-runner, work-items, misc + barrel index). Original `studio-api.ts` re-exports from `./studio-api/index.js` so all import paths remain unchanged.
- **Tests**: `console/src/__tests__/` — Testing Library + jsdom

### Database

PostgreSQL (default: `postgresql://oscorpex:oscorpex_dev@localhost:5432/oscorpex`). Key tables: `projects`, `project_plans`, `tasks`, `project_agents`, `agent_dependencies`, `events`, `work_items`, `sprints`, `token_usage`, `agent_capabilities`.

All migrations use `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` for idempotency.

## Critical Patterns

- **Import convention**: Backend files use `.js` extension in imports (`from "./db.js"`) even for `.ts` files (ESM resolution)
- **DB access**: Always import from `./db.js` (barrel), never directly from individual repo files
- **UUID generation**: Use `randomUUID()` from `node:crypto`, not the `uuid` package
- **Task status guard**: `executeTask()` accepts both `"queued"` and `"running"` status (revision restart sets running)
- **Review dispatch**: `dispatchReadyTasks()` allows review tasks even in failed phases
- **Event-sourced metrics**: Failure/rejection counts come from `events` table (survives task retries)
- **Agent scoring**: Configurable via `project_settings` category `scoring`
- **Reserved ports**: 5173 (Vite), 4242 (preview), 3142 (WebSocket) — agents cannot bind to these
- **Formatting**: Tabs, 120 char line width (biome.json)

## Constraints

- Never edit files under `.voltagent/repos/` — these are AI-generated project outputs
- Use `pnpm` exclusively (not npm or yarn)
- Respond to the user in Turkish
