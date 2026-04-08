# AI Dev Studio — Overview

## Key Facts
- Language: Turkish responses, pnpm (never npm), don't push unless asked
- Backend: port 3141, Hono + better-sqlite3 (WAL), 14 DB tables
- Frontend: port 5173, React + Vite + Tailwind
- AI SDK v6: inputSchema, stopWhen: stepCountIs(N), maxRetries: 8
- DB path: STUDIO_DB_PATH env var
- Teams: project-scoped via project_agents table
- SonarQube: Docker, config from project_settings DB (fallback env vars)

## Key Files
- src/studio/execution-engine.ts — task orchestrator (Docker/local + lint hook + docs hook)
- src/studio/task-runners.ts — integration test + app runner
- src/studio/lint-runner.ts — ESLint/Prettier auto-fix after task
- src/studio/docs-generator.ts — auto-docs by agent role + freshness check
- src/studio/sonar-runner.ts — SonarQube scan/quality gate (DB-backed config)
- src/studio/pm-agent.ts — PM prompt + tools + taskType support
- src/studio/routes.ts — 98 API endpoints
- src/studio/db.ts — 14 tables, CRUD, migrations, project_settings
- console/src/pages/studio/ProjectPage.tsx — 8-tab workspace
- console/src/pages/studio/ProjectSettings.tsx — 6 widget cards for integrations
- console/src/pages/studio/AgentDashboard.tsx — analytics + cost + docs + sonar widgets

## Known Issues
- Token cost: only recorded for new tasks, old projects show $0
- Backend restart needed when new routes added (old process returns 404)
- AgentDashboard test: every new API import needs mock in test file
