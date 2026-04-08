# AI Dev Studio — Architecture

## Stack
- Runtime: Node.js + tsx
- Backend: Hono (via VoltAgent server-hono), port 3141
- Database: better-sqlite3 (WAL, FK), 11 tables
- AI: AI SDK v6 (ai + @ai-sdk/openai + @ai-sdk/anthropic + @ai-sdk/google)
- Frontend: React 18 + Vite (port 5173) + Tailwind CSS
- Terminal: @xterm/xterm v6 + addon-fit
- Git: simple-git
- Docker: dockerode

## Backend Modules (src/studio/)
| Module | Purpose |
|--------|---------|
| types.ts | 35+ interfaces, AgentRole, MessageType, PipelineStatus |
| db.ts | SQLite schema (11 tables), all CRUD, seeds |
| event-bus.ts | Pub/sub with DB persistence |
| pm-agent.ts | PM system prompt + 4 AI SDK tools |
| ai-provider-factory.ts | getAIModel() dynamic from DB |
| task-engine.ts | Task lifecycle + onTaskCompleted hook |
| execution-engine.ts | Plan → task dispatch → Docker/local |
| pipeline-engine.ts | Stage-gated pipeline orchestrator |
| agent-messaging.ts | Agent inbox, threads, broadcast, pipeline-notify |
| agent-runtime.ts | CLI process spawn, SSE streaming, run history |
| container-manager.ts | Docker container lifecycle |
| git-manager.ts | Git operations + file CRUD |
| agent-files.ts | .md file system per agent |
| routes.ts | 70+ Hono routes at /api/studio |

## DB Tables
projects, project_plans, phases, tasks, agent_configs, project_agents,
team_templates, events, chat_messages, ai_providers,
agent_messages, pipeline_runs, agent_runs

## 9 Preset Agents
Kerem(PM), Iris(Designer), Atlas(Architect), Nova(Frontend), Forge(Backend),
Pixel(Coder), Shield(QA), Sentinel(Reviewer), Vanguard(DevOps)

## Professional Hierarchy
PM → Designer/Architect/QA/Reviewer/DevOps (direct)
Architect → Frontend/Backend/Coder (technical chain)

## Pipeline
PM(0)→Designer(1)→Architect(2)→FE+BE+Coder(3)→QA(4)→Reviewer(5)→DevOps(6)

## Frontend Pages (console/src/pages/studio/)
StudioHomePage, ProjectPage (6 tabs: Chat, Team, Board, Files, Events, Messages),
PMChat, PlanPreview, AgentGrid, AgentCard, AgentDetailModal, AgentFormModal,
OrgChart, AgentTerminal, KanbanBoard, PipelineDashboard, TaskCard,
FileExplorer, EventFeed, MessageCenter, ProvidersPage
