# Oscorpex

AI-powered software development platform — describe your idea, let AI agents build it.

Oscorpex is a full-stack development studio that orchestrates a team of 12 specialized AI agents (Scrum methodology) to plan, build, test, review, and deploy software projects autonomously through a DAG pipeline.

## Features

### Core Engine
- **12-Agent Scrum Team** — PM, Designer, Architect, Frontend Dev, Backend Dev, QA, Code Reviewer, Security Analyst, DevOps, Tech Lead, Scrum Master, UX Researcher
- **DAG Pipeline Engine** — Kahn's algorithm-based dependency resolution with 12 edge types, phase progression, and automatic wave dispatch
- **Claim-Based Task Dispatch** — `SELECT FOR UPDATE SKIP LOCKED` prevents duplicate dispatch across concurrent workers
- **Review Loop** — iterative code review cycle with rejection → revision → re-review, escalation/fallback edges. Review blocking: phase/stage cannot complete until review resolves
- **Task Decomposition** — AI Scrum Master auto-decomposes L/XL tasks into micro-tasks with dependency graphs
- **Model Routing** — complexity-based model selection with auto-tier bump on retry/rejection, cost-aware downgrade, and project-level policy profile overrides
- **Multi-Provider Execution** — Claude Code, Codex, Cursor, Google Gemini, Ollama (local) with automatic fallback chain and graceful degraded mode

### Agentic Runtime (v7.0+)
- **Episodic Memory** — per-agent execution episodes with behavioral context for prompt injection and failure avoidance
- **Strategy Selection** — 9 builtin strategies across 5 roles, historical pattern-derived selection with cross-project learning
- **Agent Sessions** — bounded runtime context with observation-action loop recording (4 lifecycle steps per task)
- **Inter-Agent Protocol** — structured messaging (request_info, blocker_alert, handoff_artifact, design_decision) with blocking enforcement
- **Task Injection** — agents propose tasks via structured output markers (`<!-- TASK_PROPOSAL: {...} -->`), auto-approve low-risk
- **Dynamic Coordination Graph** — runtime DAG mutations (insert_node, split_task, add/remove_edge, defer_branch) with full audit trail
- **Adaptive Replanner** — phase-boundary replanning with 6 trigger types, 5 patch actions, pipeline gate on pending approval
- **Goal-Based Execution** — LLM-validated success criteria with advisory/enforced modes

### Safety & Enforcement (v8.0)
- **Sandbox Enforcement** — hard/soft/off modes with tool governance, path traversal checks, output size limits. Pre-execution gate blocks denied tools before CLI spawn
- **Execution Workspace Isolation** — unified contract (local/isolated/container) with file-copy isolation, write-back enforcement, and path safety validation
- **Budget Guard** — cost circuit breaker with auto-pause on budget breach (`maxCostUsd` canonical key)
- **Risk Classification** — auto-classify task risk level, high-risk tasks require approval before execution
- **Role Normalization** — canonical hyphen-case format with underscore/legacy variant acceptance
- **Approval Timeout** — 24h auto-escalation for stalled approvals
- **RLS Tenant Guard** — row-level security on 14+ tables with request-scoped tenant context

### Performance & Scheduling (v9.0)
- **Adaptive Concurrency** — dynamic semaphore (1–10) auto-adjusted every 30s based on failure rate and queue depth
- **Fair Scheduling** — short tasks first, then retry count, then FIFO
- **Retry Policy** — classification-aware retry with exponential backoff (max 3 retries)
- **Timeout Policy** — provider × complexity × project multiplier timeout resolution (S/M/L/XL tiers)
- **Provider Cooldown** — trigger-aware cooldown (unavailable 30s, spawn_failure 60s, repeated_timeout 90s)
- **Provider State Manager** — per-adapter rate-limit and failure tracking with DB persistence
- **Cost-Aware Model Selection** — automatic downgrade to cheaper models per tier when failures are low
- **Preflight Warmup** — cold-start tracking + preflight health checks before task dispatch
- **Provider Policy Profiles** — 5 profiles (`balanced`, `cheap`, `quality`, `local-first`, `fallback-heavy`) with project-level routing overrides

### Observability & Metrics
- **11 Aggregation Queries** — claim latency (avg/p95), duplicate dispatch, verification failure rate, strategy success rates, review rejection by role, injected task volume (human/auto split), graph mutation stats, replan trigger frequency (by status), degraded provider duration, failure classification (transient/terminal/retry-exhausted)
- **Cross-Project Learning** — anonymized pattern extraction from episodes, auto-promotion (≥10 samples, ≥70% success), 0.8x confidence in strategy selection
- **Provider Telemetry** — latency snapshots, fallback records, queue-wait metrics per provider
- **Provider Comparison Dashboard** — side-by-side latency/failure/cost comparison with badge system (Fastest, Cheapest, Reliable, Noisy)
- **Admin Settings** — runtime performance config viewer, feature flags, provider health status, enable/disable toggles

### Development Tools
- **Live Preview** — real-time iframe preview of running applications with service switching
- **Runtime Analyzer** — auto-detects 15+ frameworks, databases, environment variables, and ports
- **Smart App Runner** — 3-strategy app launch (config / runtime analysis / Docker Compose fallback)
- **DB Provisioner** — Docker-based database provisioning with auto port conflict resolution
- **Git Management** — automatic version control with meaningful commits
- **CLI Monitor** — real-time CLI usage observatory (Claude, Codex, Cursor, Gemini probes)
- **Benchmark Harness** — `scripts/benchmark-providers.ts` CLI runner with markdown report generation for provider latency/cost analysis

### Project Management
- **Kanban Board** — visual task management with drag-and-drop and status filters
- **Sprint Board** — sprint lifecycle management with burndown charts and velocity tracking
- **Backlog Board** — work-item backlog with priority management and auto bug creation on review escalation
- **Ceremony Engine** — standup and retrospective automation
- **Agent Messaging** — inter-agent communication with threads, broadcast, and mentions
- **Policy Engine** — configurable task policies (block/warn/non-blocking) evaluated at task start
- **Diff Viewer** — side-by-side code diff visualization for generated changes

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Hono, PostgreSQL |
| Frontend | React 19, Vite, Tailwind CSS 4 |
| AI Execution | Claude CLI, Codex CLI, Cursor, Google Gemini, Ollama (multi-provider) |
| AI Framework | Oscorpex Kernel (custom execution engine) |
| Container | Docker (Dockerode), container pool with health checks |
| Terminal | xterm.js v6 |
| Git | simple-git |
| Testing | Vitest (1400+ tests, 104 test files) |
| Package Manager | pnpm |

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm
- Claude CLI (for AI agent execution)
- Docker (for PostgreSQL + optional container isolation)

### Installation

```bash
git clone https://github.com/halilkilicarslan/oscorpex.git
cd oscorpex
pnpm install

# Start PostgreSQL
docker compose up -d postgres

# Copy env
cp .env.example .env
```

### Development

```bash
# Start backend (port 3141, studio API at /api/studio)
pnpm dev

# Start frontend (port 5173)
cd console && pnpm dev
```

### Testing

```bash
# Backend tests
pnpm test

# Frontend tests
cd console && pnpm test:run

# Typecheck
pnpm typecheck
cd console && pnpm tsc -b
```

## Architecture

```
src/
  studio/
    execution-engine.ts       # Task orchestrator + CLI execution + claim-based dispatch
    pipeline-engine.ts        # DAG pipeline with Kahn's algorithm + replan gate
    task-engine.ts            # Task lifecycle, review loop, retry, approval gates
    pm-agent.ts               # AI Planner — intake Q&A, phased plan generation
    model-router.ts           # Complexity-based model selection + profile-aware routing
    context-packet.ts         # Token-efficient prompt assembly
    cli-adapter.ts            # Multi-provider adapter (Claude, Codex, Cursor, Gemini, Ollama)
    provider-policy-profiles.ts # 5 routing profiles with behavior definitions
    provider-state.ts         # Rate-limit and cooldown state manager
    performance-config.ts     # Centralized performance tunables via env vars
    adaptive-concurrency.ts   # Dynamic semaphore controller
    retry-policy.ts           # Classification-aware retry with backoff
    timeout-policy.ts         # Provider × complexity × project timeout resolution
    fallback-decision.ts      # Severity-weighted fallback skipping with cooldown awareness
    model-router.ts           # Cost-aware model selection with profile override
    preflight-warmup.ts       # Cold-start tracking + preflight health checks
    execution-workspace.ts    # Unified workspace contract (local/isolated/container)
    isolated-workspace.ts     # File-copy isolation with write-back enforcement
    sandbox-manager.ts        # Tool/path/output enforcement (hard/soft/off)
    roles.ts                  # Role normalization (hyphen-case canonical)
    agent-runtime/            # Agentic core (memory, strategy, session, protocol, constraints, injection)
    goal-engine.ts            # Goal-based execution with LLM criteria validation
    adaptive-replanner.ts     # Phase-boundary replanning with 6 triggers + 5 patch actions
    graph-coordinator.ts      # Runtime DAG mutations with audit trail
    cross-project-learning.ts # Anonymized pattern extraction + auto-promotion
    budget-guard.ts           # Cost circuit breaker
    output-verifier.ts        # Post-execution artifact verification gate
    test-gate.ts              # Test execution gate (required/optional/skip)
    container-pool.ts         # Docker container pool with health checks + network policy
    agentic-metrics.ts        # 11 observability aggregation queries
    event-bus.ts              # Event sourcing for state transitions
    routes/                   # 32+ Hono sub-routers (modular)
    db/                       # 39+ repository modules (modular)

console/
  src/
    pages/studio/             # 49+ studio pages
    components/               # Shared components
    lib/studio-api/           # 25+ modular API client files
    hooks/                    # WebSocket, notifications, collaboration
```

## Database

PostgreSQL with 85+ tables including: `projects`, `project_plans`, `phases`, `tasks`, `project_agents`, `events`, `work_items`, `sprints`, `token_usage`, `agent_capabilities`, `agent_sessions`, `agent_episodes`, `agent_strategy_patterns`, `task_proposals`, `graph_mutations`, `replan_events`, `execution_goals`, `learning_patterns`, `provider_state`, `pipeline_runs`, `capability_grants`, `sandbox_sessions`, `sandbox_violations`, `provider_telemetry`, `cli_usage_snapshots`, `replan_patches`

All migrations use `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` for idempotency. Schema applied at startup via `db-bootstrap.ts`.

## How It Works

1. **Describe** your project idea through the PM chat interface
2. **Plan** — AI Planner conducts intake questions, then generates phased plans with task dependencies and agent assignments
3. **Execute** — Pipeline engine dispatches tasks to specialized agents via DAG wave ordering, with complexity-based model routing, policy profile awareness, sandbox isolation, and budget control
4. **Review** — Code reviewers evaluate output with iterative revision loops; rejected tasks get auto-retried with tier-bumped models
5. **Learn** — Episodic memory and cross-project learning improve strategy selection over time; adaptive replanner adjusts plans at phase boundaries
6. **Preview** — Live preview of your running application with runtime analysis and auto-configuration

## Monorepo Structure

```
oscorpex/
├── apps/
│   ├── kernel/              # Backend — Hono server + execution engine + pipeline (~53K LOC)
│   ├── console/             # Frontend — React 19 + Vite + Tailwind 4 (~52K LOC)
│   └── kernel-src/          # Legacy source (migration artifact — do not edit)
├── packages/
│   ├── core/                # Shared types + utilities
│   ├── event-schema/        # Event type definitions
│   ├── memory-kit/          # Agent memory utilities
│   ├── observability-sdk/   # Observability SDK
│   ├── policy-kit/          # Policy enforcement
│   ├── provider-sdk/        # CLI adapter contracts
│   ├── task-graph/          # DAG data structures
│   └── verification-kit/    # Output verification
├── adapters/
│   ├── provider-claude/     # Claude CLI adapter (stub)
│   ├── provider-codex/      # Codex CLI adapter (stub)
│   ├── provider-cursor/     # Cursor adapter (stub)
│   ├── provider-gemini/     # Google Gemini adapter (EPIC 1)
│   └── provider-ollama/     # Ollama local LLM adapter (EPIC 2)
└── docs/
    ├── operator-runbooks.md # Operator runbooks for incident response
    └── NEXT_PHASE_HANDOFF.md # Production readiness handoff
```

## License

MIT
