# Conventions and Patterns

Generated on 2026-04-12 from direct repository inspection and local command runs.

## Code Style

- TypeScript everywhere
- ESM imports/exports
- Backend mostly uses single quotes
- Frontend mostly uses single quotes
- Comments are mixed English and Turkish

## Backend Patterns

- Service-like singleton modules (`taskEngine`, `executionEngine`, `pipelineEngine`)
- Database access is centralized in one large module
- Hono routes are registered in one large route file
- Event-driven coordination via `eventBus`
- Task state transitions encoded explicitly in database and engine modules

## Frontend Patterns

- Functional React components
- Many `useState` + `useEffect` driven screens
- Centralized fetch helpers in `studio-api.ts`
- Tailwind utility styling with dark UI defaults
- Feature pages often own their own data loading and view state

## Testing Conventions

- Backend tests under `src/**/*.test.ts` and `src/studio/__tests__/`
- Frontend tests under `console/src/__tests__/`
- Vitest used on both sides

## Documentation Conventions

- Repo has multiple top-level docs:
  - `README.md`
  - `ARCHITECTURE.md`
  - `DEPLOYMENT.md`
  - `GETTING_STARTED.md`
  - `QUICKSTART.md`
- The docs are useful but no longer fully aligned with the codebase

## Friction Points

- Frontend/backend contracts are copied manually instead of shared
- Some product terminology is inconsistent:
  - Oscorpex
  - VoltAgent
  - VoltOps
- Route, DB, and orchestration files have crossed the size where team-level ownership becomes difficult
- Lint rules and actual frontend coding style are currently out of sync

## What Looks Intentional

- The team optimizes for shipping product features quickly
- There is strong emphasis on observability and operator tooling
- The system is designed for local-first development with Docker-backed infra

