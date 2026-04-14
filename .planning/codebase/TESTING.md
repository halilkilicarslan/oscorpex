# Testing and Verification

Generated on 2026-04-12 from direct repository inspection and local command runs.

## Commands Run

Backend:

- `pnpm typecheck`
- `pnpm build`
- `pnpm test`
- `pnpm lint`

Frontend:

- `cd console && pnpm build`
- `cd console && pnpm test:run`
- `cd console && pnpm lint`

## Backend Status

### Passing

- `pnpm typecheck`: passed
- `pnpm build`: passed

### Failing

- `pnpm test`: failed
  - 12 test files executed
  - 161 tests total
  - 132 passed
  - 27 skipped
  - 2 failed
  - 2 suites failed

Failure categories:

- database test environment is not fully bootstrapped
  - `src/studio/__tests__/db.test.ts`
  - `src/studio/__tests__/task-engine.test.ts`
  - error: relation `chat_messages` does not exist

- runtime analyzer test drift
  - `src/studio/__tests__/runtime-analyzer.test.ts`
  - expected ports `8080` and `3000`
  - actual ports `8081` and `3003`
  - likely caused by runtime port collision avoidance now changing ports during analysis

- `pnpm lint`: failed
  - 395 Biome errors reported
  - most visible issues are formatting/import ordering
  - some test files also violate style rules such as non-null assertions

## Frontend Status

### Failing

- `cd console && pnpm test:run`: failed
  - 10 test files executed
  - 213 tests total
  - 211 passed
  - 2 failed

Failed test file:

- `console/src/__tests__/ProjectSettings.test.tsx`

Observed causes:

- mock for `../lib/studio-api` no longer includes `fetchProjectCosts`
- settings loading now uses `Promise.allSettled`, so the error surface differs from the original test expectations

- `cd console && pnpm build`: failed during TypeScript compilation
  - contract drift in tests and UI types:
    - `ProjectAgent.gender` now required
    - `AIProvider.fallbackOrder` now required
    - `ProjectAnalytics` shape changed
  - `LogsPage.tsx` expects `trace_flags` on a local interface that does not define it
  - `src/test/setup.ts` is missing Node typing configuration

- `cd console && pnpm lint`: failed
  - 72 errors, 5 warnings
  - repeated categories:
    - unused variables
    - `any` usage
    - React Hooks `set-state-in-effect`
    - purity violations such as `Date.now()` during render
    - missing dependencies in effects
    - missing ESLint rule plugin for `jsx-a11y/no-autofocus`

## Interpretation

The repo is actively developed but not currently in a clean CI-ready state.

The backend core still compiles, which is a strong sign. The frontend is carrying more contract drift and lint debt, and the backend test harness needs deterministic database initialization.

