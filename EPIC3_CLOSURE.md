# EPIC 3 — Performance, Scheduling & Concurrency: Closure Report

**Date**: 2026-04-27
**Scope**: TASK 1 through TASK 17
**Status**: COMPLETE

---

## Final Benchmark

| Metric | Result |
|--------|--------|
| Kernel test files | 98 passed |
| Kernel tests | 1,329 passed, 5 skipped |
| Kernel test duration | ~36s |
| Console build | PASS (tsc + vite) |
| Kernel typecheck | PASS |
| Commits | 17 tasks across multiple commits |

---

## Task Summary

### TASK 1 — Baseline Metrics (`performance-metrics.ts`)
- Aggregates provider telemetry into `ExecutionBaseline`
- Success/fallback/cancel/timeout rates, latency percentiles
- Per-provider snapshots, top 5 slowest patterns, top 5 fallback patterns
- Endpoint: `GET /telemetry/performance/baseline`
- **Tests**: 7 unit tests

### TASK 2 — Queue Wait Time (`tasks.created_at`)
- Added `createdAt` column to `tasks` table (DB migration)
- `execution-engine.ts` computes `queueWaitMs = startedAt - createdAt`
- Added `queueWaitMs` to `ProviderExecutionTelemetry` (provider-sdk + console types)
- `queueWaitMetrics` {avg, p95, max, recordedCount} in baseline
- **Tests**: Verified via integration tests

### TASK 3 — Provider Health Cache (`health-cache.ts`)
- TTL cache (default 30s) for `checkBinaryAsync` results
- `checkBinaryCached()` wrapper with forceRefresh option
- Hit/miss stats tracking
- Codex/Cursor `isAvailable()` converted to cached async
- **Tests**: 6 unit tests

### TASK 4 — Provider Runtime Cache (`provider-runtime-cache.ts`)
- Availability cache (30s/10s TTL) + capability cache (5min TTL)
- `capabilities()` added to all CLI adapters (Claude, Codex, Cursor)
- Integrated into execution-engine via `resolveAvailability`
- Invalidation wired into `provider-state.ts` cooldown triggers
- **Tests**: 11 unit tests

### TASK 5 — Smarter Fallback Decision Motor (`fallback-decision.ts`)
- Severity-weighted error classification (0-100 scale)
- `shouldSkipProvider`: tool restriction, timeout retry avoidance, cooldown
- `sortAdapterChain`: telemetry-based priority sorting
- `markProviderUnavailable`: 30s cooldown
- **Tests**: 9 unit tests

### TASK 6 — Provider Cooldown Mechanism (`provider-state.ts`)
- Trigger-aware durations: unavailable 30s, spawn_failure 60s, rate_limited 60s, repeated_timeout 90s, cli_error 0
- `markCooldown(adapter, trigger, customMs?)`
- `markFailure` accepts `ProviderErrorClassification`
- `isAvailable` invalidates cache on cooldown expiry
- DB persistence with `last_cooldown_trigger`/`last_cooldown_at`
- **Tests**: Existing provider-state tests + integration coverage

### TASK 7 — Provider-Aware Timeout Policy (`timeout-policy.ts`)
- Provider profiles: claude-code 1.0x, codex 1.2x, cursor 1.1x
- Complexity base: S/M 30min, L 45min, XL 60min
- Project multiplier via `task_timeout_multiplier` setting
- Config surface with min/max clamping
- **Tests**: 8 unit tests

### TASK 8 — Adaptive Concurrency (`adaptive-concurrency.ts`)
- `AdaptiveSemaphore`: dynamic max 1-10
- `ConcurrencyTracker`: per-project (2) / per-provider (2) caps
- `AdaptiveConcurrencyController`: auto-adjusts every 30s
  - Failure rate > 50% → reduce
  - Queue depth > 5 + low failure → increase
- **Tests**: 18 unit tests

### TASK 9 — Fair Task Scheduling (`task-scheduler.ts`)
- Complexity categorization: short (S), medium (M), long (L/XL)
- `sortTasksByFairness`: short first, lower retry count, then FIFO
- `groupTasksByLane`: lane-based grouping for visual scheduling
- Integrated into `dispatchReadyTasks`
- **Tests**: 10 unit tests

### TASK 10 — Deterministic Retry Policy (`retry-policy.ts`)
- `RETRY_MATRIX`: retryable (timeout, cli_error, killed, unknown) vs non-retryable (spawn_failure, unavailable, rate_limited, tool_restriction)
- Exponential backoff: 5s × 2^attempt (0 in test env)
- `MAX_AUTO_RETRIES` = 3
- Fixed TDZ issue by hoisting `lastFailureClassification`
- **Tests**: 14 unit tests

### TASK 11 — Cost-Aware Provider Selection (`model-router.ts`)
- `MODEL_COST_SCORES` + `PROVIDER_MODELS_BY_COST`
- `selectCostAwareModel`: S/M → cheapest, L/XL or prior failures → quality preserve
- `decisionReason` added to `ResolvedModel` for telemetry
- **Tests**: 7 unit tests

### TASK 12 — Preflight Warm-up (`preflight-warmup.ts`)
- Cold-start tracking (`markExecutionStarted`, `isColdStart`)
- `runPreflightHealthChecks`: warms availability cache on startup
- `resolveBinaryPath`: caches `which` lookups
- `isColdStart` metadata in telemetry
- **Tests**: 9 unit tests

### TASK 13 — Optimization Dashboard (UI)
- Performance summary cards added to `ProviderTelemetryPage.tsx`
  - Avg queue wait, fallback rate, timeout rate, cooldown active count
- Top Slow Providers list (sorted by avg latency)
- Top Failure Classifications list (with classification badges)
- **Tests**: 11 UI tests (existing + updated)
- **Build**: Console build passes

### TASK 14 — Performance Regression Tests
- `performance-regression.test.ts` (29 tests)
- Invariants verified:
  1. Short tasks never starved by long tasks
  2. Non-retryable errors don't trigger retry storms
  3. Fallback chain respects health/cooldown
  4. Adaptive concurrency responds within bounded time
  5. Queue wait time bounds for short tasks
  6. Throughput doesn't collapse under moderate load
  7. Composite pipeline maintains end-to-end invariants

### TASK 15 — Configurability & Rollout Plan (`performance-config.ts`)
- Centralized config module with env var overrides for ALL subsystems
- Feature flags via `OSCORPEX_PERF_FEATURES`:
  - Allow-list: `"retryPolicy,timeoutPolicy"`
  - Deny-list: `"-adaptiveConcurrency"`
  - Unset: all enabled
  - Empty: all disabled
- Updated modules: adaptive-concurrency, retry-policy, timeout-policy, provider-state, fallback-decision, provider-runtime-cache, preflight-warmup, execution-engine
- **Tests**: 17 unit tests for config parsing

### TASK 16 — Documentation Update
- Updated `CLAUDE.md`:
  - Added "Performance & scheduling" architecture section
  - Listed all 12 extracted modules with descriptions
  - Added comprehensive env var configuration table (15 variables)
  - Added "Performance config" critical pattern

### TASK 17 — Closure Report
- This document
- Final benchmark: 1,329 tests passed, console build green, typecheck clean

---

## Key Design Decisions

1. **Config at module load time**: Constants are resolved at module load for performance, but the config module provides functions that can be re-read if needed.
2. **Feature flags are coarse-grained**: Each major subsystem can be toggled independently for gradual rollout.
3. **Queue wait time uses DB column**: `tasks.created_at` (DEFAULT now()) rather than event history inference for accuracy.
4. **Retry backoff is zero in tests**: `BASE_BACKOFF_MS = 0` when `VITEST === "true"` to keep tests fast.
5. **Cooldown durations are trigger-aware**: Different triggers have different severities and therefore different cooldown lengths.
6. **Cost-aware downgrade only for S/M with no failures**: Critical tasks (L/XL) and retried tasks preserve quality model.

---

## Files Added/Modified

### New files
- `apps/kernel/src/studio/performance-config.ts`
- `apps/kernel/src/studio/__tests__/performance-config.test.ts`
- `apps/kernel/src/studio/__tests__/performance-regression.test.ts`

### Modified files (kernel)
- `apps/kernel/src/studio/adaptive-concurrency.ts`
- `apps/kernel/src/studio/retry-policy.ts`
- `apps/kernel/src/studio/timeout-policy.ts`
- `apps/kernel/src/studio/provider-state.ts`
- `apps/kernel/src/studio/fallback-decision.ts`
- `apps/kernel/src/studio/provider-runtime-cache.ts`
- `apps/kernel/src/studio/preflight-warmup.ts`
- `apps/kernel/src/studio/execution-engine.ts`

### Modified files (console)
- `apps/console/src/pages/studio/ProviderTelemetryPage.tsx`
- `apps/console/src/__tests__/ProviderTelemetryPage.test.tsx`

### Documentation
- `CLAUDE.md`

---

## Rollout Recommendations

1. **Phase 1 (Observation)**: Enable `queueWaitTelemetry`, `timeoutPolicy`, `providerCooldown` only. Monitor baseline metrics for 1 week.
2. **Phase 2 (Conservative)**: Add `retryPolicy`, `fallbackDecisionMotor`, `providerRuntimeCache`. Observe fallback rates and retry counts.
3. **Phase 3 (Active)**: Enable `adaptiveConcurrency`, `fairScheduling`, `costAwareModelSelection`. Monitor throughput and queue wait times.
4. **Phase 4 (Full)**: Enable `preflightWarmup`, `providerHealthCache`. Verify cold-start improvements.
5. **Emergency rollback**: Set `OSCORPEX_PERF_FEATURES=""` to disable all performance subsystems instantly.

---

## Performance Impact (Expected)

| Subsystem | Expected Impact |
|-----------|----------------|
| Adaptive concurrency | +20-40% throughput under variable load |
| Fair scheduling | -30% queue wait for short tasks |
| Health cache | -90% redundant binary checks |
| Runtime cache | -80% capability recomputation |
| Retry policy | -50% unnecessary retries (non-retryable errors) |
| Fallback decision | -20% fallback chain latency (health-aware sorting) |
| Cost-aware selection | -10-15% model cost for S/M tasks |
| Preflight warm-up | -1-2s first-task latency |

---

## Conclusion

All 17 tasks of EPIC 3 are complete. The system now has centralized configurability, comprehensive observability, fair scheduling, adaptive concurrency, smart fallback, deterministic retry, and provider-aware timeouts — all backed by 1,329 passing tests and full type safety.
