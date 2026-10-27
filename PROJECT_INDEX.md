# Project Index: Oscorpex

Generated: 2026-05-04

## Overview

AI-powered software development platform. Users describe an idea → 12-agent Scrum team builds it autonomously via DAG pipeline. Monorepo: pnpm workspaces, TypeScript ESM.

## Project Structure

```
oscorpex/
├── apps/
│   ├── kernel/             # Backend — Hono + PostgreSQL + AI SDK
│   │   └── src/
│   │       ├── index.ts              # Entry point (boot phases)
│   │       ├── boot-phases/          # DB, container, provider, pipeline, recovery
│   │       ├── cli/                  # CLI commands (init, start, deploy, status, projects)
│   │       ├── observability/        # Alerts, prompts, RAG, triggers
│   │       └── studio/              # Core platform (~100+ modules)
│   │           ├── routes/           # 44 Hono sub-routers
│   │           ├── db/               # 42 repo modules (barrel: db/index.ts)
│   │           ├── execution/        # 15 modules — dispatch, timeout, gates, sandbox, recovery
│   │           ├── task/             # 8 modules — approval, review, lifecycle, progress, completion
│   │           ├── pipeline/         # 10 modules — state, advance, replan, VCS, build, control
│   │           ├── providers/        # 4 modules — model catalog, routing, pricing
│   │           ├── inspector/        # 4 modules — task session observability
│   │           ├── legacy/           # Compat-only CLI runtime (not normal path)
│   │           ├── auth/             # Password auth
│   │           ├── middleware/       # Policy, correlation header
│   │           ├── composition/      # Seeders, DI registration
│   │           ├── kernel/           # Replay fixtures
│   │           ├── agent-runtime/    # Agent lifecycle runtime
│   │           └── __tests__/        # ~100 test files
│   └── console/            # Frontend — React 19 + Vite + Tailwind 4
│       └── src/
│           ├── App.tsx               # Router setup
│           ├── pages/studio/         # 57 page components
│           ├── components/           # 18 shared components
│           ├── hooks/                # 10 custom hooks
│           ├── lib/studio-api/       # 32 API client modules (barrel: index.ts)
│           ├── types/                # Shared TS types
│           └── __tests__/            # 33 test files
├── packages/
│   ├── core/               # @oscorpex/core — domain types, contracts, utils
│   │   └── src/
│   │       ├── domain/     # task, stage, artifact, run, cost, memory, policy, replay, state-machines, events, provider
│   │       ├── contracts/  # provider-adapter, event-publisher, scheduler, stores, policy-engine, cost-reporter, memory-provider, hook-registry, kernel
│   │       ├── errors/     # domain-errors, provider-errors, policy-errors
│   │       └── utils/      # ids, result, time
│   ├── event-schema/       # @oscorpex/event-schema — task, agent, pipeline, plan, budget, run, cost, other events
│   ├── provider-sdk/       # @oscorpex/provider-sdk — CLI adapter, runner, cost, health-cache, cancel, observability
│   ├── control-plane/      # @oscorpex/control-plane — governance (registry, presence, approvals, audit, incidents, policy, usage-cost, projections, operator-actions)
│   ├── task-graph/         # @oscorpex/task-graph — DAG data structures, stages, types
│   ├── verification-kit/   # @oscorpex/verification-kit — verify, gates
│   ├── policy-kit/         # @oscorpex/policy-kit — evaluation, sandbox enforcement
│   ├── memory-kit/         # @oscorpex/memory-kit — context packets
│   └── observability-sdk/  # @oscorpex/observability-sdk — checkpoint, journal, causal-chain
├── adapters/
│   ├── provider-claude/    # Claude CLI adapter (stub)
│   ├── provider-codex/     # Codex CLI adapter (stub)
│   ├── provider-cursor/    # Cursor adapter (stub)
│   ├── provider-gemini/    # Gemini adapter
│   └── provider-ollama/    # Ollama adapter
└── docker-compose.yml      # PostgreSQL + services
```

## Entry Points

| Type | Path | Description |
|------|------|-------------|
| Kernel | `apps/kernel/src/index.ts` | Boot phases → Hono server (port 3141) |
| Console | `apps/console/src/App.tsx` | React Router SPA (port 5161) |
| CLI | `apps/kernel/src/cli/index.ts` | Commander CLI (init, start, deploy, status) |
| DB Schema | `apps/kernel/scripts/init.sql` | 85 tables, idempotent |

## Core Modules (Kernel)

### Engine Layer
| Module | Path | Purpose |
|--------|------|---------|
| PM Agent | `studio/pm-agent.ts` | Requirements analysis, phased plan generation |
| Execution Engine | `studio/execution-engine.ts` | Thin execution facade |
| Task Engine | `studio/task-engine.ts` | Task facade (approval, review, lifecycle, progress, completion, subtasks) |
| Pipeline Engine | `studio/pipeline-engine.ts` | Pipeline facade (build, advance, control, completion, VCS, replan) |
| Team Architect | `studio/team-architect.ts` | PM-driven conversational intake |

### Execution Pipeline
| Module | Path | Purpose |
|--------|------|---------|
| Dispatch Coordinator | `execution/dispatch-coordinator.ts` | Task dispatch orchestration |
| Task Executor | `execution/task-executor.ts` | Core task execution |
| Provider Execution | `execution/provider-execution-service.ts` | Provider-level execution |
| Execution Gates | `execution/execution-gates-runner.ts` | Pre/post execution gates |
| Sandbox Guard | `execution/sandbox-execution-guard.ts` | Sandbox enforcement |
| Task Output | `execution/task-output-handler.ts` | Output processing |
| Recovery | `execution/execution-recovery.ts` | Failure recovery |
| Watchdog | `execution/execution-watchdog.ts` | Health monitoring |
| Timeout | `execution/task-timeout.ts` | Timeout management |
| Queue Wait | `execution/queue-wait.ts` | Queue management |

### Performance & Scheduling
| Module | Path | Purpose |
|--------|------|---------|
| Performance Config | `studio/performance-config.ts` | Centralized tunables (env vars + feature flags) |
| Adaptive Concurrency | `studio/adaptive-concurrency.ts` | Dynamic semaphore (1-10) |
| Task Scheduler | `studio/task-scheduler.ts` | Fair scheduling (short-first, retry, FIFO) |
| Retry Policy | `studio/retry-policy.ts` | Classification-aware retry + backoff |
| Timeout Policy | `studio/timeout-policy.ts` | Provider × complexity × project timeout |
| Model Router | `studio/model-router.ts` | Cost-aware model selection |
| Fallback Decision | `studio/fallback-decision.ts` | Severity-weighted provider skipping |
| Provider State | `studio/provider-state.ts` | Trigger-aware cooldowns |
| Preflight Warmup | `studio/preflight-warmup.ts` | Cold-start + health checks |

### Safety & Correctness
| Module | Path | Purpose |
|--------|------|---------|
| Graph Coordinator | `studio/graph-coordinator.ts` | DAG mutations + cycle detection |
| Sandbox Manager | `studio/sandbox-manager.ts` | Realpath + symlink path checks |
| Task Injection | `studio/task-injection.ts` | Injection limits (quota/depth/dedup) |
| Budget Guard | `studio/budget-guard.ts` | Cost circuit breaker |
| Policy Engine | `studio/policy-engine.ts` | Policy evaluation + enforcement |

### Infrastructure
| Module | Path | Purpose |
|--------|------|---------|
| DB | `studio/pg.ts` + `studio/db.ts` | PostgreSQL pool + barrel export |
| Logger | `studio/logger.ts` | Pino structured JSON |
| WebSocket | `studio/ws-server.ts` + `ws-manager.ts` | Real-time events |
| Event Bus | `studio/event-bus.ts` | Internal event dispatch |
| PG Listener | `studio/pg-listener.ts` | PostgreSQL LISTEN/NOTIFY |

## Console Pages (57)

Key pages: `ProjectPage`, `PMChat`, `AgentChat`, `KanbanBoard`, `SprintBoard`, `BacklogBoard`, `PipelineDashboard`, `TeamGraphView`, `AgentDashboard`, `AgentGrid`, `TaskDetailModal`, `FileExplorer`, `DiffViewer`, `ControlPlanePage`, `ProviderTelemetryPage`, `ProviderComparisonPage`, `TaskSessionInspectorPage`, `InsightDashboard`, `QualityGatesDashboardPage`, `ApprovalQueuePage`, `StudioHomePage`

## API Client (32 modules)

`apps/console/src/lib/studio-api/` — modular client: `projects`, `tasks`, `pipeline`, `agents`, `chat`, `providers`, `telemetry`, `control-plane`, `quality-gates`, `approvals`, `releases`, `artifacts`, `inspector`, `plans`, `work-items`, `auth`, `settings`, `ci`, `git`, `collaboration`, `marketplace`, `messaging`, `notifications`, `templates`, `analytics`, `agentic`, `tests`, `app-runner`, `misc`

## Key Dependencies

### Kernel
| Package | Version | Purpose |
|---------|---------|---------|
| hono | ^4.12 | HTTP framework |
| pg | ^8.20 | PostgreSQL client |
| ai (Vercel) | ^6.0 | AI SDK (multi-provider) |
| @ai-sdk/anthropic | ^3.0 | Claude provider |
| @ai-sdk/openai | ^3.0 | OpenAI/compatible provider |
| @ai-sdk/google | ^3.0 | Gemini provider |
| pino | ^10.3 | Structured logging |
| zod | ^3.25 | Schema validation |
| simple-git | ^3.35 | Git operations |
| dockerode | ^4.0 | Container management |
| ws | ^8.20 | WebSocket server |

### Console
| Package | Version | Purpose |
|---------|---------|---------|
| react | ^19.2 | UI framework |
| react-router-dom | ^7.14 | Routing |
| tailwindcss | ^4.2 | Styling |
| @xyflow/react | ^12.10 | DAG visualization |
| recharts | ^3.8 | Charts |
| lucide-react | ^1.7 | Icons |
| @xterm/xterm | ^6.0 | Terminal emulation |
| react-markdown | ^10.1 | Markdown rendering |

## Test Coverage

| Area | Files | Runner |
|------|-------|--------|
| Kernel | ~100+ | vitest (serialized, DB-backed) |
| Console | 33 | vitest (jsdom) |
| provider-sdk | 1 | vitest |
| task-graph | 1 | vitest |
| provider-gemini | 1 | vitest |
| provider-ollama | 1 | vitest |

## Database

- **Engine**: PostgreSQL (port 5432)
- **Tables**: 85 (idempotent DDL)
- **Repos**: 42 modules in `studio/db/`
- **Key tables**: projects, tasks, phases, events, agent_sessions, agent_episodes, task_proposals, graph_mutations, replan_events, learning_patterns, provider_state, agent_instances, runtime_heartbeats, approvals, audit_events, incidents

## Routes (44)

Registered in `studio/routes/index.ts`. Key routes: project-crud, project-chat, project-plan, project-execution, project-settings, task, pipeline, agent, agentic, team, provider, telemetry, analytics, inspector, cost, graph, quality-gates, approvals, releases, artifacts, memory, notification, sandbox, sprint, ci, lifecycle, runtime, replay, template, plugin, collaboration, marketplace, ceremony, cluster, cli-usage, job, git-file, work-item, auth, integration

## Quick Start

```bash
pnpm install              # Install all workspace deps
pnpm docker:up            # Start PostgreSQL
pnpm dev                  # Kernel at :3141
pnpm dev:console          # Console at :5161
pnpm test                 # Run kernel tests
pnpm typecheck            # Type-check all workspaces
```

## Reserved Ports

| Port | Service |
|------|---------|
| 3141 | Kernel (Hono + Studio API) |
| 3142 | WebSocket server |
| 4242 | Preview |
| 5161 | Console (Vite dev) |
| 5432 | PostgreSQL |
