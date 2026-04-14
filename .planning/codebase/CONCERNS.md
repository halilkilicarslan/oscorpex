# Main Concerns

Generated on 2026-04-12 from direct repository inspection and local command runs.

## 1. Documentation Drift

The repo documentation no longer describes the current system consistently.

Examples:

- `README.md` says React 18, current frontend is React 19
- `ARCHITECTURE.md` describes VoltAgent/LibSQL on port 4242
- current runtime uses Oscorpex + Hono on port 3141 with PostgreSQL plus LibSQL side stores

Impact:

- onboarding confusion
- higher risk of wrong deployment/debugging assumptions

## 2. God Files in Core Paths

Several critical files are too large for safe change velocity:

- `src/studio/routes.ts` - 3,079 lines
- `src/studio/db.ts` - 2,191 lines
- `src/studio/execution-engine.ts` - 1,106 lines
- `src/studio/pipeline-engine.ts` - 917 lines
- `src/studio/task-engine.ts` - 850 lines
- `console/src/lib/studio-api.ts` - 1,889 lines
- `console/src/pages/studio/StudioHomePage.tsx` - 816 lines

Impact:

- harder reviews
- higher regression probability
- weaker ownership boundaries

## 3. Frontend/Backend Contract Drift

The frontend maintains its own type universe, and it is already diverging from current behavior.

Concrete evidence:

- tests and build break on required `gender`
- build breaks on required `fallbackOrder`
- `ProjectAnalytics` shape changed without all tests being updated
- `LogsPage.tsx` expects a field not present in its local type

Impact:

- UI changes are brittle
- tests do not reliably protect refactors

## 4. Test Environment Instability

Backend tests rely on PostgreSQL but the test setup does not initialize schema automatically. Frontend tests are also sensitive to API client shape changes.

Impact:

- local confidence is lower than the test count suggests
- CI would be unstable without additional setup

## 5. Runtime Analyzer Mixes Detection with Port Mutation

`analyzeProject()` both detects intended ports and mutates them to avoid conflicts on the current machine.

Impact:

- nondeterministic tests
- blurred semantics: analysis result vs runnable allocation

Recommended direction:

- separate "detected port" from "allocated free port"

## 6. Hybrid Storage and Naming Complexity

The product uses PostgreSQL, pgvector, LibSQL, file logs, and repo-local artifacts while also mixing Oscorpex/VoltAgent/VoltOps naming.

Impact:

- steep cognitive load
- harder operational debugging

## 7. Frontend Hooks Discipline Is Not Enforced in Practice

The ESLint output shows many places where state is set inside effects or impure values are computed during render.

Impact:

- avoidable rerenders
- stale state bugs
- hard-to-maintain component logic

## 8. Docker Privilege Surface

The backend mounts `/var/run/docker.sock`, and agent orchestration depends on container execution.

Impact:

- very high local host access for the backend process
- should be treated as a trusted-developer environment, not a casually exposed service

## Priority Recommendations

1. Make docs truthful again and pick one architecture source of truth.
2. Stabilize CI:
   - bootstrap test schema
   - repair frontend build
   - get frontend tests green
3. Extract shared contracts for API and analytics types.
4. Split the biggest backend and frontend files by bounded context.
5. Separate runtime analysis from runtime port allocation.

