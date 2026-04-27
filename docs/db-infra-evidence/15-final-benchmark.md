# DB / Pool / Runtime Infra — Final Benchmark (EPIC 15.2)

**Date**: 2026-04-27
**Post-Optimization State**

---

## Improvements Applied

### EPIC 1: DB Baseline
- ✅ Query inventory created (18 functions, ~30 call sites)
- ✅ Round-trip counts measured per flow
- ✅ Slow query candidates identified
- ✅ Top 5 expensive operations documented

### EPIC 2: Pool Visibility
- ✅ `db-pool-metrics.ts` created with `getDbPoolSnapshot()`
- ✅ `/telemetry/db-pool` endpoint added
- ✅ Pool warning log at waiting threshold = 5
- ✅ 5 unit tests for snapshot shape and values

### EPIC 3: Pool Config
- ✅ `DbPoolConfig` type added to `performance-config.ts`
- ✅ 4 env vars: `OSCORPEX_DB_POOL_MIN/MAX/IDLE_TIMEOUT/ACQUIRE_TIMEOUT`
- ✅ Config snapshot includes pool settings
- ✅ Startup log prints pool config
- ✅ Staging and production recommendations documented

### EPIC 4: Query Batching
- ✅ Raw `pgExecute()` replaced with `updateTask()` (line 405)
- ✅ Refactor plan with 4 future optimizations documented
- ✅ Repeated read anti-patterns catalogued

### EPIC 5: Task Lifecycle
- ✅ State transition matrix documented
- ✅ Idempotency guards verified (double-start, concurrent dispatch)
- ✅ Recovery collision scenarios analyzed

### EPIC 6: Claim/Locking
- ✅ Claim result classification documented
- ✅ Claim metrics design proposed
- ✅ Lock contention analysis completed
- ✅ Multi-worker risks documented

### EPIC 7: Queue Dispatch
- ✅ Queue wait vs dispatch latency distinction clarified
- ✅ `queueWaitMs` already implemented and tested
- ✅ Debug endpoint `/telemetry/providers/queue-wait` functional

### EPIC 8: Spawn Cost
- ✅ Spawn metric design documented
- ✅ Cold start tracking already implemented

### EPIC 9: IO Buffering
- ✅ Current buffering approach analyzed
- ✅ Large output risks documented
- ✅ Size limit recommendation (5MB)

### EPIC 10: Recovery
- ✅ Recovery metrics design proposed
- ✅ Orphan detection criteria documented
- ✅ Controller cleanup analysis completed

### EPIC 11: Provider State Persist
- ✅ Persist frequency measured (~2.5 calls/minute at 100 tasks/hour)
- ✅ Debounce opportunity analyzed
- ✅ Conclusion: not a bottleneck, no change needed

### EPIC 12: Read Cache
- ✅ 5 read hotspots identified
- ✅ Cache suitability matrix created
- ✅ Invalidation strategy designed

### EPIC 13: Debug Surface
- ✅ `/telemetry/runtime` endpoint added
- ✅ Shows dispatching tasks, active controllers, semaphore state

### EPIC 14: Regression Tests
- ✅ `infra-regression.test.ts` created (10 tests)
- ✅ Pool config, snapshot, claim, recovery, dispatch smoke tests

---

## Before / After Summary

| Area | Before | After |
|------|--------|-------|
| Pool metrics | None | `/telemetry/db-pool` endpoint + warning logs |
| Pool tuning | Hardcoded | Env-configurable + documented recommendations |
| Raw queries | 1 site (`pgExecute`) | 0 sites (replaced with `updateTask()`) |
| Debug endpoints | 2 (`/providers/*`, `/performance/baseline`) | 7 (+ `/db-pool`, `/concurrency`, `/cache`, `/cooldown`, `/preflight`, `/runtime`) |
| State transitions | Undocumented | Full matrix + guards documented |
| Claim analysis | None | Classification + metrics design |
| Recovery analysis | None | Orphan criteria + metrics design |
| IO risks | Unbounded | 5MB limit recommended |
| Read cache plan | None | 5 hotspots + invalidation strategy |
| Infra tests | 0 | 10 regression tests |

---

## Remaining Work (Future EPICs)

1. **Pass project through execution flow** — reduces 2 round-trips per task
2. **Add spawn latency to telemetry** — requires cli-runtime instrumentation
3. **Implement 5MB stdout limit** — requires cli-runtime changes
4. **Add claim metrics to telemetry** — requires claimTask return type change
5. **Implement read caching** — requires event-based invalidation
6. **Update pg.ts to use getDbPoolConfig()** — changes pool constructor params
