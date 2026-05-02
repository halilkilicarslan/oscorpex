# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Workspace (root)
pnpm dev              # Start kernel with tsx watch (port 3141, studio API at /api/studio)
pnpm dev:console      # Start frontend Vite dev server (port 5161)
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
  control-plane/       # @oscorpex/control-plane — operator governance layer (registry, presence, approvals, audit, incidents)
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
2. **execution-engine.ts** — Thin execution facade. Normal execution goes through TaskDispatcher → TaskExecutor → ProviderExecutionService → ProviderRegistry → ProviderAdapter
3. **task-engine.ts** — Task facade backed by extracted approval, review, lifecycle, progress, completion, and subtask services
4. **pipeline-engine.ts** — Pipeline facade backed by extracted build, stage advance, control, completion, VCS, replan, task-hook, and review-helper services

**Extracted modules**:
- `execution/` — task execution lifecycle, provider execution, gates, sandbox guard, task output, dispatch, recovery, watchdog, timeout, queue wait
- `task/` — approval, review loop, zero-file guard, completion effects, subtask rollup, lifecycle, progress
- `pipeline/` — state, stage advance, replan gate, VCS hooks, build, control, task hook, review helpers, completion
- `providers/` — provider model catalog and routing services
- `legacy/` — compatibility-only CLI runtime and CLI adapter; not the normal execution path

**Performance & scheduling** (EPIC 3 — 17 tasks):
- `performance-config.ts` — Centralized tunables via env vars + feature flags (`OSCORPEX_PERF_FEATURES`)
- `performance-metrics.ts` — Baseline aggregation endpoint (`GET /telemetry/performance/baseline`)
- `health-cache.ts` — Binary availability TTL cache (provider-sdk)
- `provider-runtime-cache.ts` — Availability + capability caches with invalidation
- `fallback-decision.ts` — Severity-weighted skipping, cooldown-aware chain sorting
- `provider-state.ts` — Trigger-aware cooldown (unavailable 30s, spawn_failure 60s, repeated_timeout 90s)
- `timeout-policy.ts` — Provider × complexity × project multiplier timeout resolution
- `adaptive-concurrency.ts` — Dynamic semaphore (1-10), auto-adjusts every 30s
- `task-scheduler.ts` — Fair scheduling: short tasks first, then retry count, then FIFO
- `retry-policy.ts` — Classification-aware retry with exponential backoff (max 3 retries)
- `model-router.ts` — Cost-aware model selection with `decisionReason` telemetry
- `preflight-warmup.ts` — Cold-start tracking + preflight health checks

**Safety & correctness**:
- `graph-coordinator.ts` — DAG mutations with `GraphInvariantError` (cycle DFS, self-edge, duplicate edge)
- `sandbox-manager.ts` — Realpath + symlink hardened path checks, tool enforcement
- `task-injection.ts` — `InjectionLimitError` (per-task quota 3, per-phase budget 10, recursion depth 2, dedup)
- `budget-guard.ts` — Cost circuit breaker, auto-pause pipeline
- `roles.ts` — Canonical hyphen-case role normalization

**Logging**: `logger.ts` — Pino structured JSON logging. Every module uses `createLogger("module-name")`.

**Database**: `db/` — 39 repo modules, barrel-exported via `db/index.ts`. Schema in `scripts/init.sql` (85 tables, idempotent).

**Routes**: `routes/` — 32 Hono sub-routers registered in `routes/index.ts`. 5 YAGNI-deferred (cli-usage, ceremony, marketplace, cluster, collaboration).

**Control Plane** (`packages/control-plane/` — extracted governance layer):
- Kernel routes under `control-plane/` are thin Hono hosts that parse requests, call `@oscorpex/control-plane` services, and map responses
- Business logic (repos, services, types) lives exclusively in the package; kernel only wires routes
- Package resolved via tsconfig `paths` mapping (`@oscorpex/control-plane` → `packages/control-plane/src/index.ts`)

### Console (`apps/console/src/`)

React 19 + Vite + Tailwind 4 + React Router. Dark theme: bg `#0a0a0a`, accent `#22c55e`.

- **Pages**: `pages/studio/` — 49 pages
- **API**: `lib/studio-api/` — 25 modular client files, barrel index
- **Hooks**: `hooks/` — WebSocket, notifications, collaboration, infinite scroll
- **Proxy**: Dev server proxies to kernel at `localhost:3141` (configurable via `VITE_PROXY_TARGET`)

### Database

PostgreSQL (`postgresql://oscorpex:oscorpex_dev@localhost:5432/oscorpex`). 85 tables including `projects`, `tasks`, `phases`, `events`, `agent_sessions`, `agent_episodes`, `task_proposals`, `graph_mutations`, `replan_events`, `learning_patterns`, `provider_state`, `agent_instances`, `runtime_heartbeats`, `approvals`, `audit_events`, `incidents`.

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
- **Performance config**: All tunables live in `performance-config.ts`. Override via `OSCORPEX_*` env vars. Feature flags via `OSCORPEX_PERF_FEATURES` (comma-list or `-deny_list`).
- **Formatting**: Tabs, 120 char line width (biome.json)
- **Reserved ports**: 5161 (Console Vite), 4242 (preview), 3142 (WebSocket)

## Performance Configuration

All performance/scheduling subsystems read from `performance-config.ts`. Key environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `OSCORPEX_PERF_FEATURES` | *(all enabled)* | Gradual rollout flags. `"retryPolicy,timeoutPolicy"` = allow-list. `"-adaptiveConcurrency"` = deny-list. |
| `OSCORPEX_MAX_CONCURRENT_TASKS` | 3 | Default adaptive semaphore max |
| `OSCORPEX_ADJUSTMENT_INTERVAL_MS` | 30000 | Concurrency controller adjustment window |
| `OSCORPEX_FAILURE_RATE_THRESHOLD` | 0.5 | Threshold to reduce concurrency |
| `OSCORPEX_QUEUE_DEPTH_THRESHOLD` | 5 | Threshold to consider increasing concurrency |
| `OSCORPEX_MAX_AUTO_RETRIES` | 3 | Max auto-retries per task |
| `OSCORPEX_BASE_BACKOFF_MS` | 5000 | Retry backoff base (0 in test env) |
| `OSCORPEX_TIMEOUT_S` / `_M` / `_L` / `_XL` | 1800000 / 1800000 / 2700000 / 3600000 | Complexity base timeouts (ms) |
| `OSCORPEX_MULTIPLIER_CLAUDE` / `_CODEX` / `_CURSOR` | 1.0 / 1.2 / 1.1 | Provider timeout multipliers |
| `OSCORPEX_COOLDOWN_UNAVAILABLE_MS` | 30000 | Cooldown duration for unavailable trigger |
| `OSCORPEX_COOLDOWN_SPAWN_FAILURE_MS` | 60000 | Cooldown duration for spawn_failure trigger |
| `OSCORPEX_COOLDOWN_REPEATED_TIMEOUT_MS` | 90000 | Cooldown duration for repeated_timeout trigger |
| `OSCORPEX_AVAILABILITY_CACHE_TTL_MS` | 30000 | Health cache TTL for availability checks |
| `OSCORPEX_CAPABILITY_CACHE_TTL_MS` | 300000 | Health cache TTL for capability checks |
| `OSCORPEX_PREFLIGHT_ENABLED` | true | Enable preflight warm-up health checks |

## Constraints

- Never edit files under `.voltagent/repos/` or `archive/legacy/kernel-src/` — these are legacy/generated
- Use `pnpm` exclusively (not npm or yarn)
- Workspace packages use `workspace:*` protocol for inter-package deps
- Kernel tests run serialized (`fileParallelism: false`) due to shared DB
- Respond to the user in Turkish
