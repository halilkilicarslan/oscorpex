# Oscorpex — Overview

## Key Facts
- Language: Turkish responses, pnpm (never npm), don't push unless asked
- Don't edit AI-generated code: `.voltagent/repos/` altındaki agent kodlarına müdahale etme
- Backend: port 3141, Hono + better-sqlite3 (WAL), 16 DB tables
- Frontend: port 5173, React + Vite + Tailwind
- Execution: CLI-only (Claude CLI) — no AI SDK generateText/streamText in execution path
- DB path: STUDIO_DB_PATH env var
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
- src/studio/routes.ts — 100+ API endpoints + preview proxy
- src/studio/db.ts — 16 tables, CRUD, migrations
- console/src/pages/studio/LivePreview.tsx — iframe preview + proxy + RuntimePanel
- console/src/pages/studio/RuntimePanel.tsx — runtime/env/DB config UI
- console/src/lib/studio-api.ts — all API types and client functions

## Known Issues
- Pre-existing TS errors: pipeline-engine.ts(521), routes.ts textDelta
- Backend restart needed when new routes added (old process returns 404)
- `.studio.json` auto-generated after first start — may need manual correction if first attempt fails
- Express app default port 3000, not 4100 (fixed in runtime-analyzer)
