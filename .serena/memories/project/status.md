# AI Dev Studio — Status

## Current: v2.1 — Runtime System + Preview Proxy

### This Session (2026-04-10)
- **Preview proxy**: Reverse proxy endpoint strips helmet X-Frame-Options/CSP for iframe embedding
- **API-only app handling**: Root 404 → styled HTML info page with API Running badge
- **Port detection fix**: 3-tier: .env → source code parse (.listen(3000)) → framework defaults (Express=3000, Vite=5173, etc.)
- **DB port conflict auto-resolve**: `isPortInUse()` + `findAvailablePort()` auto-increments (5432→5433→5434)
- **Post-start health check**: `postStartHealthCheck()` verifies process actually serves HTTP after "ready" signal
- **Agent log persistence**: File-based at `.voltagent/logs/{projectId}/{agentId}.log`
- **Pipeline status 500 fix**: Missing `listPhases`, `listTasks` imports in routes.ts

### Files Modified
- `src/studio/routes.ts` — preview proxy, runtime API endpoints, pipeline fix
- `src/studio/app-runner.ts` — 3-strategy startup, post-start health check
- `src/studio/runtime-analyzer.ts` — detectPort(), FRAMEWORK_DEFAULT_PORTS
- `src/studio/db-provisioner.ts` — findAvailablePort(), buildEnvVars(), auto-retry
- `src/studio/execution-engine.ts` — agent log persistence on task complete
- `src/studio/agent-log-store.ts` — NEW: file-based log persistence
- `console/src/pages/studio/LivePreview.tsx` — proxy URL, RuntimePanel integration
- `console/src/pages/studio/RuntimePanel.tsx` — NEW: runtime config UI
- `console/src/lib/studio-api.ts` — runtime API types and client functions

### v2.0 Deliverables (completed earlier)
- 12-agent Scrum team, DAG pipeline, review loop
- Drag-drop pipeline builder, dynamic dependency seeding
- CLI-only execution (Docker/API removed)

## Roadmap
- v2.0: ✅ TAMAMLANDI — 12-agent Scrum, DAG pipeline
- v2.1: ✅ TAMAMLANDI — Runtime system, preview proxy, crash detection
- **Next**: API Explorer (Swagger-benzeri UI for API-only apps in preview)
- **Backlog**: Auth, migration wizard, monorepo support improvements
