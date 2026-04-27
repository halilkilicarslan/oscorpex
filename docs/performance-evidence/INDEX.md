# EPIC 3 Performance Evidence — Index

**Location**: `docs/performance-evidence/`
**Last Updated**: 2026-04-27

---

## Benchmark & Baseline

| File | Content |
|------|---------|
| `01-baseline.md` | Pre-optimization metrics (latency, queue wait, fallback, timeout, failure, throughput, cache, cost) |
| `02-final-benchmark.md` | Post-optimization metrics with same methodology |
| `03-before-after.md` | Side-by-side comparison table with % change and meaningfulness flags |
| `04-closure-summary.md` | Top 3 gains, remaining 3 bottlenecks, next optimization area |

---

## Subsystem Evidence

| File | Subsystem | Tasks Covered |
|------|-----------|--------------|
| `05-adaptive-concurrency-wiring.md` | Adaptive Concurrency | 3.1-3.3 — Config→behavior mapping, decision logic, debug endpoint |
| `06-fair-scheduling.md` | Fair Scheduling | 4.1-4.3 — Scheduling rule, starvation prevention, lane grouping |
| `07-cache-cooldown-routing.md` | Cache / Cooldown / Routing | 6.1-6.4 — Usage points, metric surface, cost-aware telemetry |
| `08-preflight-warmup.md` | Preflight Warm-up | 7.1-7.4 — Entrypoint, telemetry, cold-start tracking, technical note |
| `09-optimization-dashboard.md` | Dashboard | 8.1-8.4 — Feature inventory, operator actions, API mapping |

---

## Operations

| File | Content |
|------|---------|
| `10-rollout-rollback-checklist.md` | 4-phase rollout plan, rollback triggers, staging & prod checklists |

---

## Code Evidence

### Debug Endpoints Added

| Endpoint | File | Task |
|----------|------|------|
| `GET /telemetry/providers/queue-wait` | `telemetry-routes.ts` | TASK 2.3 |
| `GET /telemetry/concurrency` | `telemetry-routes.ts` | TASK 3.3 |
| `GET /telemetry/cache` | `telemetry-routes.ts` | TASK 6.2 |
| `GET /telemetry/cooldown` | `telemetry-routes.ts` | TASK 6.3 |
| `GET /telemetry/preflight` | `telemetry-routes.ts` | TASK 7.2 |

### Helper Functions Added / Refactored

| Function | File | Task |
|----------|------|------|
| `computeQueueWaitMs()` | `execution-engine.ts` | TASK 2.2 |
| `_startTaskForExecution()` | `execution-engine.ts` | TASK 2.2 |
| `getRuntimeState()` | `adaptive-concurrency.ts` | TASK 3.3 |
| `getLastPreflightTelemetry()` | `preflight-warmup.ts` | TASK 7.2 |

### Test Files Added / Enhanced

| File | Tests | Task |
|------|-------|------|
| `queue-wait.test.ts` | 8 tests | TASK 2.4 |
| `retry-fallback-integration.test.ts` | 19 tests | TASK 5.4 |
| `performance-regression.test.ts` | 29 tests | TASK 14 (from EPIC 3) |
| `performance-config.test.ts` | 17 tests | TASK 15 (from EPIC 3) |
| `adaptive-concurrency.test.ts` | +1 test | TASK 3.4 |
| `task-scheduler.test.ts` | +4 tests | TASK 4.3 |
| `provider-runtime-cache.test.ts` | +1 test | TASK 9.1 |
| `provider-state.test.ts` | +2 tests | TASK 9.2 |
| `preflight-warmup.test.ts` | +2 tests | TASK 7.3 |

---

## Quick Verification Commands

```bash
# Run all evidence-related tests
pnpm --filter @oscorpex/kernel test -- --testPathPattern='(queue-wait|retry-fallback-integration|performance-regression|performance-config|adaptive-concurrency|task-scheduler|provider-runtime-cache|provider-state|preflight-warmup)\.test\.ts$'

# Typecheck
pnpm --filter @oscorpex/kernel typecheck

# Console build
pnpm --filter console build
```
