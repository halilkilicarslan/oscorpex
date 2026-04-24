# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Workspace (root)
pnpm dev              # Start kernel with tsx watch (port 3141, studio API at /api/studio)
pnpm dev:console      # Start frontend Vite dev server (port 5173)
pnpm build            # Build all packages + apps
pnpm typecheck        # tsc --noEmit across all workspaces
pnpm lint             # biome check on kernel
pnpm lint:fix         # biome check --write on kernel
pnpm test             # vitest run (kernel tests — serialized, DB-backed)
pnpm test -- --testPathPattern=task-engine   # Run single test file

# Per-app
pnpm --filter @oscorpex/kernel dev       # Kernel only
pnpm --filter console test:run           # Frontend tests (jsdom)
pnpm --filter console tsc -b             # Frontend typecheck

# Docker
pnpm docker:up        # Start PostgreSQL + services
pnpm docker:down      # Stop all containers
```

## Monorepo Structure

```
apps/
  kernel/              # Backend — Hono server + execution engine + pipeline
    src/studio/        # Core platform modules (~53K LOC)
    scripts/init.sql   # DB schema (85 tables, idempotent)
  console/             # Frontend — React 19 + Vite + Tailwind 4 (~52K LOC)
  kernel-src/          # Legacy source (do not edit — migration artifact)

packages/
  core/                # @oscorpex/core — shared types + utilities
  event-schema/        # @oscorpex/event-schema — event type definitions
  memory-kit/          # @oscorpex/memory-kit — agent memory utilities
  observability-sdk/   # @oscorpex/observability-sdk
  policy-kit/          # @oscorpex/policy-kit — policy enforcement
  provider-sdk/        # @oscorpex/provider-sdk — CLI adapter contracts
  task-graph/          # @oscorpex/task-graph — DAG data structures
  verification-kit/    # @oscorpex/verification-kit — output verification

adapters/
  provider-claude/     # Claude CLI adapter (stub)
  provider-codex/      # Codex CLI adapter (stub)
  provider-cursor/     # Cursor adapter (stub)
```

## Architecture

Oscorpex is an AI-powered software development platform. Users describe an idea, and a 12-agent Scrum team builds it autonomously through a DAG pipeline.

### Kernel (`apps/kernel/src/`)

**Entry**: `index.ts` → boots as kernel (default) or VoltAgent mode (`OSCORPEX_MODE` env).

**Core engine flow** (all in `studio/`):
1. **pm-agent.ts** — PM analyzes requirements, generates phased plan with tasks
2. **execution-engine.ts** (1306 LOC, 7 responsibilities) — Dispatches tasks via CLI, manages adapter chain, session lifecycle, sandbox, retry
3. **task-engine.ts** — Task lifecycle: assign → start → done/fail. Review loops, sub-task rollup, escalation
4. **pipeline-engine.ts** — DAG orchestrator via Kahn's algorithm. Phase progression, replan gate

**Extracted modules** (from execution-engine):
- `execution-gates.ts` — Verification + test + goal validation gates
- `proposal-processor.ts` — Routes structured output markers (task proposals, agent messages, graph mutations)
- `prompt-builder.ts` — Task prompt assembly with RAG, context, error injection
- `review-dispatcher.ts` — Review task lifecycle + agent resolution

**Safety & correctness**:
- `graph-coordinator.ts` — DAG mutations with `GraphInvariantError` (cycle DFS, self-edge, duplicate edge)
- `sandbox-manager.ts` — Realpath + symlink hardened path checks, tool enforcement
- `task-injection.ts` — `InjectionLimitError` (per-task quota 3, per-phase budget 10, recursion depth 2, dedup)
- `budget-guard.ts` — Cost circuit breaker, auto-pause pipeline
- `roles.ts` — Canonical hyphen-case role normalization

**Logging**: `logger.ts` — Pino structured JSON logging. Every module uses `createLogger("module-name")`.

**Database**: `db/` — 39 repo modules, barrel-exported via `db/index.ts`. Schema in `scripts/init.sql` (85 tables, idempotent).

**Routes**: `routes/` — 32 Hono sub-routers registered in `routes/index.ts`. 5 YAGNI-deferred (cli-usage, ceremony, marketplace, cluster, collaboration).

### Console (`apps/console/src/`)

React 19 + Vite + Tailwind 4 + React Router. Dark theme: bg `#0a0a0a`, accent `#22c55e`.

- **Pages**: `pages/studio/` — 49 pages
- **API**: `lib/studio-api/` — 25 modular client files, barrel index
- **Hooks**: `hooks/` — WebSocket, notifications, collaboration, infinite scroll
- **Proxy**: Dev server proxies to kernel at `localhost:3141` (configurable via `VITE_PROXY_TARGET`)

### Database

PostgreSQL (`postgresql://oscorpex:oscorpex_dev@localhost:5432/oscorpex`). 85 tables including `projects`, `tasks`, `phases`, `events`, `agent_sessions`, `agent_episodes`, `task_proposals`, `graph_mutations`, `replan_events`, `learning_patterns`, `provider_state`.

All migrations use `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`.

## Critical Patterns

- **Import convention**: `.js` extension in ESM imports (`from "./db.js"`) even for `.ts` files
- **DB access**: Always import from `./db.js` barrel, never individual repo files
- **UUID**: `randomUUID()` from `node:crypto`, not the `uuid` package
- **Logging**: `import { createLogger } from "./logger.js"` → `log.info()` / `log.warn({ err }, "msg")`. Never `log.warn("msg", err)` (pino type error)
- **Graph mutations**: Every `addEdge` must pass through `validateAddEdge()` (cycle detection)
- **Sandbox paths**: Use `resolve() + normalize() + sep` for scope checks — never bare `startsWith()`
- **Injection limits**: `checkInjectionLimits()` before `proposeTask()` — enforces quota/depth/dedup
- **Claim-based dispatch**: `claimTask()` with SELECT FOR UPDATE SKIP LOCKED — no in-memory guards
- **Pipeline state**: DB-authoritative via `mutatePipelineState()`. `_cache` is read-through only
- **Pipeline advance**: `advanceStage()` checks for pending `replan_events` and blocks if any
- **Budget**: `enforceBudgetGuard()` after token recording. Canonical key: `budget.maxCostUsd`
- **Session lifecycle**: `initSession()` → `recordStep()` ×4 → `completeSession()`/`failSession()`
- **Formatting**: Tabs, 120 char line width (biome.json)
- **Reserved ports**: 5173 (Vite), 4242 (preview), 3142 (WebSocket)

## Constraints

- Never edit files under `.voltagent/repos/` or `apps/kernel-src/` — these are legacy/generated
- Use `pnpm` exclusively (not npm or yarn)
- Workspace packages use `workspace:*` protocol for inter-package deps
- Kernel tests run serialized (`fileParallelism: false`) due to shared DB
- Respond to the user in Turkish
