# Oscorpex

AI-powered software development platform — describe your idea, let AI agents build it.

Oscorpex is a full-stack development studio that orchestrates a team of 12 specialized AI agents (Scrum methodology) to plan, build, test, review, and deploy software projects autonomously through a DAG pipeline.

## Features

### Core Engine
- **12-Agent Scrum Team** — PM, Designer, Architect, Frontend Dev, Backend Dev, QA, Code Reviewer, Security Analyst, DevOps, Tech Lead, Scrum Master, UX Researcher
- **DAG Pipeline Engine** — Kahn's algorithm-based dependency resolution with 12 edge types, phase progression, and automatic wave dispatch
- **Review Loop** — iterative code review cycle with rejection → revision → re-review, escalation/fallback edges
- **Task Decomposition** — AI Scrum Master auto-decomposes L/XL tasks into micro-tasks with dependency graphs
- **Model Routing** — complexity-based model selection (S→Haiku, M→Sonnet, L→Sonnet, XL→Opus) with auto-tier bump on retry/rejection
- **Rate Limit Detection** — auto-pauses pipeline on CLI quota exhaustion, resumes when limit resets

### AI Features
- **Interactive Planner** — PM agent conducts intake Q&A, generates phased plans with task dependencies
- **Incremental Planning** — append phases/tasks to live plans, replan unfinished work without creating new plan versions
- **Token Saving Engine** — Claude cache optimization achieving 90%+ cost reduction via cache_read_tokens
- **Context Packet Assembly** — token-efficient prompt builder with mode-based context (planner/execution/review)
- **Working Memory** — per-agent persistent memory updated after each task completion
- **Agent Scoring** — configurable performance scoring (first-pass rate, speed, cost efficiency)

### Development Tools
- **Live Preview** — real-time iframe preview of running applications with service switching
- **Runtime Analyzer** — auto-detects 15+ frameworks, databases, environment variables, and ports
- **Smart App Runner** — 3-strategy app launch (config / runtime analysis / Docker Compose fallback)
- **DB Provisioner** — Docker-based database provisioning with auto port conflict resolution
- **Git Management** — automatic version control with meaningful commits
- **CLI Monitor** — real-time CLI usage observatory (Claude, Codex, Cursor, Gemini probes)

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
| AI Execution | Claude CLI, Codex CLI, Cursor (multi-provider) |
| AI Framework | VoltAgent |
| Terminal | xterm.js v6 |
| Git | simple-git |
| Testing | Vitest (870+ tests — 437 backend, 433 frontend) |
| Package Manager | pnpm |

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm
- Claude CLI (for AI agent execution)
- Docker (for PostgreSQL)

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
# Start backend (port 4242, studio API at /api/studio)
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
    execution-engine.ts    # Task orchestrator + CLI execution + rate limit detection
    pipeline-engine.ts     # DAG pipeline with Kahn's algorithm + phase progression
    task-engine.ts         # Task lifecycle, review loop, retry, approval gates
    pm-agent.ts            # AI Planner — intake Q&A, phased plan generation
    task-decomposer.ts     # AI Scrum Master — L/XL task micro-decomposition
    model-router.ts        # Complexity-based model selection + tier auto-bump
    context-packet.ts      # Token-efficient prompt assembly
    cli-runtime.ts         # CLI process spawn, streaming, rate limit detection
    cli-adapter.ts         # Multi-provider adapter (Claude, Codex, Cursor)
    cli-usage.ts           # CLI usage observatory (OAuth/quota probes)
    app-runner.ts          # 3-strategy app launch + port management
    runtime-analyzer.ts    # Framework/DB/port auto-detection
    db-provisioner.ts      # Docker DB provisioning
    team-architect.ts      # AI-powered team composition from templates
    event-bus.ts           # Event sourcing for state transitions
    git-manager.ts         # Git operations
    routes/                # 17 Hono sub-routers (modular)
    db/                    # 18 repository modules (modular)

console/
  src/
    pages/studio/          # 41 studio pages
    components/            # Shared components (AgentAvatar, etc.)
    lib/studio-api/        # 17 modular API client files
    hooks/                 # WebSocket, notifications
```

## Database

PostgreSQL with 30+ tables including: `projects`, `project_plans`, `phases`, `tasks`, `project_agents`, `agent_configs`, `team_templates`, `events`, `chat_messages`, `ai_providers`, `agent_messages`, `agent_dependencies`, `agent_capabilities`, `project_settings`, `work_items`, `sprints`, `token_usage`, `agent_daily_stats`, `pipeline_runs`, `agent_runs`, `working_memory`

All migrations use `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` for idempotency. Schema applied at startup via `db-bootstrap.ts`.

## How It Works

1. **Describe** your project idea through the PM chat interface
2. **Plan** — AI Planner conducts intake questions, then generates phased plans with task dependencies and agent assignments
3. **Execute** — Pipeline engine dispatches tasks to specialized agents via DAG wave ordering, with complexity-based model routing
4. **Review** — Code reviewers evaluate output with iterative revision loops; rejected tasks get auto-retried with tier-bumped models
5. **Preview** — Live preview of your running application with runtime analysis and auto-configuration

## License

MIT
