# DB / Pool / Runtime Infra Evidence — Index (EPIC 15)

**Date**: 2026-04-27
**Status**: COMPLETE

---

## Evidence Files

| File | EPIC | Content |
|------|------|---------|
| `01-query-inventory.md` | EPIC 1.1 | All DB functions in execution-engine.ts with line numbers |
| `02-round-trip-count.md` | EPIC 1.2 | Per-flow DB round-trip estimates |
| `03-slow-query-candidates.md` | EPIC 1.3 | Repeated reads, N+1 risks, index recommendations |
| `INDEX.md` | EPIC 1.4 | Baseline summary + top 5 expensive operations + top 3 optimizations |
| `04-query-batching.md` | EPIC 4 | Refactor plan + applied change (pgExecute → updateTask) |
| `05-task-lifecycle-transitions.md` | EPIC 5 | State matrix, idempotency guards, recovery risks |
| `06-claim-locking.md` | EPIC 6 | Claim classification, metrics design, lock contention |
| `07-queue-dispatch-latency.md` | EPIC 7 | Queue wait vs dispatch latency definitions |
| `08-runtime-spawn-cost.md` | EPIC 8 | Spawn metric design, cold start tracking |
| `09-io-buffering.md` | EPIC 9 | Buffering analysis, 5MB limit recommendation |
| `10-recovery-stuck-tasks.md` | EPIC 10 | Recovery metrics, orphan criteria, tests |
| `11-provider-state-persist.md` | EPIC 11 | Persist frequency, debounce analysis |
| `12-db-read-cache-candidates.md` | EPIC 12 | Read hotspots, cache matrix, invalidation |
| `13-runtime-debug-surface.md` | EPIC 13 | `/telemetry/runtime` endpoint docs |
| `db-pool-config.md` | EPIC 3 | Pool config env vars + staging/prod recommendations |
| `15-baseline.md` | EPIC 15.1 | Pre-optimization metrics |
| `15-final-benchmark.md` | EPIC 15.2 | Post-optimization summary |

---

## Code Changes

### Files Added
- `apps/kernel/src/studio/db-pool-metrics.ts`
- `apps/kernel/src/studio/__tests__/db-pool-metrics.test.ts`
- `apps/kernel/src/studio/__tests__/infra-regression.test.ts`

### Files Modified
- `apps/kernel/src/studio/execution-engine.ts` — pgExecute → updateTask
- `apps/kernel/src/studio/performance-config.ts` — DbPoolConfig added
- `apps/kernel/src/studio/performance-config.ts` — logPerformanceConfig updated
- `apps/kernel/src/studio/__tests__/performance-config.test.ts` — pool config tests
- `apps/kernel/src/studio/routes/telemetry-routes.ts` — `/db-pool`, `/runtime` endpoints

---

## Verification Commands

```bash
# All tests
pnpm --filter @oscorpex/kernel test

# Result: 102 test files passed, 1,384 tests passed, 5 skipped

# Typecheck
pnpm --filter @oscorpex/kernel typecheck

# Result: PASS (no errors)
```
