# Architecture Analysis

Generated on 2026-04-12 from direct repository inspection and local command runs.

## High-Level Shape

The repository is best understood as four layers:

1. Entry application layer
   - `src/index.ts`
   - boots VoltAgent, Hono routes, WebSocket server, webhook sender, and container pool

2. Studio backend layer
   - `src/studio/*`
   - project management, planning, execution, pipeline orchestration, repo/file access, runtime analysis, app running, metrics, providers, webhooks

3. Console frontend layer
   - `console/src/*`
   - large SPA for studio operations and observability

4. Supporting/demo layer
   - `src/agents/*`, `src/tools/*`, `src/workflows/*`
   - assistant/researcher utilities plus example workflow logic

## Runtime Flow

Typical project execution flow:

1. User creates or imports a project in the frontend.
2. Backend persists project metadata in PostgreSQL.
3. PM-style planning logic creates plans, phases, and tasks.
4. `task-engine` manages task lifecycle, approval gates, and phase transitions.
5. `pipeline-engine` maps agent dependencies into DAG waves.
6. `execution-engine` dispatches ready tasks.
7. `cli-runtime` launches Claude CLI subprocesses in the target repo.
8. events, logs, files, analytics, and app preview state are surfaced through the API and WebSocket channels.

## Backend Architectural Characteristics

### Strengths

- Clear subsystem naming under `src/studio/`
- Reasonable separation between task lifecycle, execution dispatch, and pipeline graph logic
- Strong feature coverage: planning, approvals, cost tracking, docs generation, runtime discovery, app preview, webhooks

### Weaknesses

- The backend concentrates too much behavior into a few very large files:
  - `src/studio/routes.ts`: 3,079 lines
  - `src/studio/db.ts`: 2,191 lines
  - `src/studio/execution-engine.ts`: 1,106 lines
  - `src/studio/pipeline-engine.ts`: 917 lines
  - `src/studio/task-engine.ts`: 850 lines
- API, orchestration, persistence, and product policy are all implemented inline instead of through narrower services

## Frontend Architectural Characteristics

### Strengths

- Central API client in `console/src/lib/studio-api.ts`
- Lazy-loaded top-level routes in `console/src/main.tsx`
- Rich UI surface covering most studio workflows

### Weaknesses

- Several pages are very large and state-heavy:
  - `console/src/pages/studio/StudioHomePage.tsx`: 816 lines
  - `console/src/lib/studio-api.ts`: 1,889 lines
  - `console/src/pages/studio/ProjectPage.tsx`: 362 lines
- Local UI state and effect logic are heavily coupled
- Frontend contracts are duplicated manually instead of shared from backend types or schema

## Architectural Drift

The repository contains overlapping product identities:

- current codebase name and feature set: Oscorpex studio
- historical/documented references: VoltAgent / VoltOps / older console topology

This is not cosmetic only. It shows up in docs, ports, storage descriptions, and terminology, which will slow onboarding and increase maintenance cost.

