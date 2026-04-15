# Oscorpex — Overview

## Key Facts
- Language: Turkish responses, pnpm (never npm), don't push unless asked
- Don't edit AI-generated code: `.voltagent/repos/` altındaki agent kodlarına müdahale etme
- Backend: port 3141, Hono + PostgreSQL (pg), 22+ DB tables
- Frontend: port 5173, React + Vite + Tailwind
- Execution: CLI-only (Claude CLI) — no AI SDK generateText/streamText in execution path
- DB path: DATABASE_URL env var
- Teams: project-scoped via project_agents table (not global agent_configs)
- Tests: Backend 119 + Frontend 213 = 332 total (Vitest)

## Key Files
- src/studio/execution-engine.ts — task orchestrator + agent log persistence
- src/studio/pipeline-engine.ts — DAG-based pipeline with review loop
- src/studio/task-engine.ts — task lifecycle + onTaskCompleted hook
- src/studio/app-runner.ts — 3-strategy app launch + post-start health check
- src/studio/runtime-analyzer.ts — framework/DB/env/port detection
- src/studio/db-provisioner.ts — Docker DB provisioning + auto port conflict
- src/studio/agent-log-store.ts — file-based agent output persistence
- src/studio/agent-runtime.ts — CLI process spawn, SSE streaming
- src/studio/routes/ — 12 sub-routers, 100+ API endpoints
- src/studio/db/ — 17 repo modules, 22+ tables
- console/src/pages/studio/LivePreview.tsx — iframe preview + proxy + RuntimePanel
- console/src/pages/studio/RuntimePanel.tsx — runtime/env/DB config UI
- console/src/lib/studio-api.ts — all API types and client functions

## v3.0 Key Additions
- Interactive PM planner with askUser tool (v3.0)
- Micro-task decomposition: L/XL → S/M sub-tasks (v3.0)
- 12 edge types: escalation, pair, conditional, fallback, notification, handoff, approval, mentoring (v3.1)
- Work items backlog (v3.2), incremental re-planning (v3.3)
- Context packet assembly + model routing + 4-layer memory (v3.4)
- Project lifecycle state machine + hotfix (v3.5)
- Ceremony engine: standup + retro (v3.6), Policy engine (v3.7)
- Agent chat + stakeholder reports (v3.8), Sprints + plugins (v3.9)
- New frontend pages: BacklogBoard, SprintBoard, CeremonyPanel, ProjectReport, AgentChat

## Known Issues (most resolved in v3.0)
- Backend restart needed when new routes added (old process returns 404)
- `.studio.json` auto-generated after first start — may need manual correction if first attempt fails
- Express app default port 3000, not 4100 (fixed in runtime-analyzer)
