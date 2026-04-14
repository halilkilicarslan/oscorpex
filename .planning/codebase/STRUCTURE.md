# Repository Structure

Generated on 2026-04-12 from direct repository inspection and local command runs.

## Root Layout

- `src/`
  - backend entrypoint, agents, tools, workflows, and studio subsystem
- `console/`
  - frontend SPA and frontend tests
- `scripts/`
  - PostgreSQL initialization
- `docker/`
  - coder-agent image
- `docs/`
  - roadmap and planning documents
- `coverage/`, `dist/`
  - generated artifacts

## Backend Structure

### `src/index.ts`

Application bootstrap. Starts:

- VoltAgent server
- Hono studio routes
- observability routes
- WebSocket server
- webhook sender
- container pool warm-up

### `src/studio/`

Main product backend. Key clusters:

- execution and orchestration
  - `execution-engine.ts`
  - `pipeline-engine.ts`
  - `task-engine.ts`
  - `agent-runtime.ts`
  - `cli-runtime.ts`

- persistence and schema access
  - `db.ts`
  - `pg.ts`

- project/runtime operations
  - `app-runner.ts`
  - `runtime-analyzer.ts`
  - `db-provisioner.ts`
  - `container-manager.ts`
  - `container-pool.ts`

- product features
  - `routes.ts`
  - `webhook-sender.ts`
  - `agent-messaging.ts`
  - `docs-generator.ts`
  - `git-manager.ts`
  - `api-discovery.ts`

- tests
  - `src/studio/__tests__/`

### Other backend folders

- `src/agents/`
  - assistant, summarizer, translator, researcher, code assistant
- `src/tools/`
  - calculator, datetime, weather, web search
- `src/workflows/`
  - currently includes an expense approval workflow example

## Frontend Structure

### `console/src/main.tsx`

Top-level SPA routing with lazy-loaded route pages.

### `console/src/pages/studio/`

Primary studio UI features:

- home/project creation
- project detail page
- PM chat
- team builder
- kanban board
- pipeline dashboard
- live preview
- runtime panel
- file explorer
- message center
- settings and providers

### `console/src/lib/studio-api.ts`

Single large API client and type-definition hub for frontend/backend communication.

### `console/src/__tests__/`

Frontend test coverage concentrates on major studio UI surfaces.

## Observed Structural Pattern

The codebase is feature-rich but file-granularity is coarse. Most domains exist, but many are packed into large files instead of modular slices. This improves short-term shipping speed and hurts long-term maintainability.

