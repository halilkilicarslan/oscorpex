# Oscorpex

AI-powered software development platform — describe your idea, let AI agents build it.

Oscorpex is a full-stack development studio that orchestrates a team of 12 specialized AI agents (Scrum methodology) to plan, build, test, review, and deploy software projects autonomously.

## Features

- **12-Agent Scrum Team** — PM, Designer, Architect, Frontend Dev, Backend Dev, QA, Code Reviewer, DevOps, and more
- **DAG Pipeline Engine** — dependency-aware task execution with automatic stage ordering
- **Review Loop** — iterative code review cycle between reviewers and developers
- **Live Preview** — real-time iframe preview of running applications with service switching
- **Runtime Analyzer** — auto-detects 15+ frameworks, databases, environment variables, and ports
- **Smart App Runner** — 3-strategy app launch (config / runtime analysis / Docker Compose fallback)
- **DB Provisioner** — Docker-based database provisioning with auto port conflict resolution
- **Kanban Board** — visual task management with drag-and-drop
- **Agent Messaging** — inter-agent communication with threads and broadcast
- **Webhook Integration** — event-driven notifications to external services
- **Git Management** — automatic version control with meaningful commits

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Hono, PostgreSQL (pg + pgvector) |
| Frontend | React 18, Vite, Tailwind CSS |
| AI Execution | Claude CLI (no AI SDK in execution path) |
| Terminal | xterm.js v6 |
| Git | simple-git |
| Testing | Vitest (374 tests) |
| Package Manager | pnpm |

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm
- Claude CLI (for AI agent execution)
- Docker (for PostgreSQL + pgvector)

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
# Start backend (port 3141)
pnpm dev

# Start frontend (port 5173)
cd console
pnpm dev
```

### Testing

```bash
# Run all tests
pnpm test

# Frontend tests
cd console && pnpm test
```

## Architecture

```
src/
  studio/
    routes.ts             # 100+ API endpoints + preview proxy
    execution-engine.ts   # Task orchestrator + CLI execution
    pipeline-engine.ts    # DAG-based pipeline with review loop
    task-engine.ts        # Task lifecycle management
    app-runner.ts         # 3-strategy app launch
    runtime-analyzer.ts   # Framework/DB/port detection
    db-provisioner.ts     # Docker DB provisioning
    db.ts                 # SQLite schema (16 tables)
    pm-agent.ts           # AI Planner system prompt + tools
    agent-runtime.ts      # CLI process spawn, SSE streaming
    agent-log-store.ts    # File-based agent output persistence
    git-manager.ts        # Git operations
    webhook-sender.ts     # Event notifications

console/
  src/
    pages/studio/         # Studio UI (20+ pages)
    components/           # Shared components
    lib/studio-api.ts     # API client
    hooks/                # WebSocket, notifications
```

## Database

PostgreSQL + pgvector. 30+ tables: `projects`, `project_plans`, `phases`, `tasks`, `agent_configs`, `project_agents`, `team_templates`, `events`, `chat_messages`, `ai_providers`, `agent_messages`, `pipeline_runs`, `agent_runs`, `agent_dependencies`, `agent_capabilities`, `project_settings`

## How It Works

1. **Describe** your project idea through the PM chat interface
2. **Plan** — AI Planner breaks it down into phases and tasks with dependencies
3. **Execute** — Pipeline engine dispatches tasks to specialized agents via DAG ordering
4. **Review** — Code reviewers evaluate output, reject/approve with iterative revision loop
5. **Preview** — Live preview of your running application in the browser

## License

MIT
