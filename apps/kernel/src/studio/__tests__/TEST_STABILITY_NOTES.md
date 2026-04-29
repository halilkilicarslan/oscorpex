# Test Stability Notes (H2-J)

## What was flaky
- `e2e-pipeline.test.ts`: intermittent timeout on execution-gate scenario.
- `preflight-warmup.test.ts`: timing-sensitive assertion (`duration >= 10ms`) occasionally failed with `9ms`.

## Why it happened
- `e2e-pipeline`: test data accumulated across cases; later cases paid higher DB cost and exceeded default timeout. Also fixed-duration waits (`setTimeout`) introduced race sensitivity.
- `preflight-warmup`: real wall-clock jitter made duration assertions nondeterministic in CI/load.

## What fixed it
- Added per-test E2E cleanup for `E2E%` projects (cascade clears dependent records).
- Replaced fixed sleeps with `waitFor`-based condition polling and explicit timeout constant.
- Replaced wall-clock threshold assertion with deterministic `Date.now()` mocking.
- Added permanent ignore rules for `apps/kernel/.tmp` and scratch patterns.

## Regression detection
- Re-run focused suites multiple times:
  - `pnpm --filter @oscorpex/kernel test -- e2e-pipeline`
  - `pnpm --filter @oscorpex/kernel test -- preflight-warmup`
- If timeout/flake reappears, first check:
  1. cleanup helper still runs before each E2E test
  2. no fixed `setTimeout`-only waits were reintroduced
  3. time assertions are not coupled to wall clock jitter
