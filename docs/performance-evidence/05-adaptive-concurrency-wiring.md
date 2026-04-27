# Adaptive Concurrency — Config to Behavior Wiring (TASK 3.2)

**Module**: `apps/kernel/src/studio/adaptive-concurrency.ts`
**Config Source**: `apps/kernel/src/studio/performance-config.ts` → `getAdaptiveConcurrencyConfig()`

---

## Config → Runtime Mapping

| Config Function | Env Var | Default | Runtime Consumer |
|-----------------|---------|---------|-----------------|
| `getAdaptiveConcurrencyConfig().defaultMax` | `OSCORPEX_MAX_CONCURRENT_TASKS` | 3 | `AdaptiveSemaphore` constructor initial max |
| `getAdaptiveConcurrencyConfig().minMax` | — | 1 | `AdaptiveSemaphore.maxConcurrency` setter clamp |
| `getAdaptiveConcurrencyConfig().absoluteMax` | — | 10 | `AdaptiveSemaphore.maxConcurrency` setter clamp |
| `getAdaptiveConcurrencyConfig().adjustmentIntervalMs` | `OSCORPEX_ADJUSTMENT_INTERVAL_MS` | 30_000 | `AdaptiveConcurrencyController` `setInterval` period |
| `getAdaptiveConcurrencyConfig().failureRateThreshold` | `OSCORPEX_FAILURE_RATE_THRESHOLD` | 0.5 | `_adjust()` reduce decision |
| `getAdaptiveConcurrencyConfig().queueDepthThreshold` | `OSCORPEX_QUEUE_DEPTH_THRESHOLD` | 5 | `_adjust()` increase decision |

---

## Decision Logic (Single Point of Truth)

```typescript
// adaptive-concurrency.ts::_adjust()
private _adjust(): void {
    const failureRate = this.getFailureRate();      // from telemetry
    const queueDepth = this.getQueueDepth();        // from semaphore.pendingCount
    const currentMax = this.semaphore.maxConcurrency;
    let newMax = currentMax;

    if (failureRate > FAILURE_RATE_THRESHOLD) {     // config: 0.5
        newMax = Math.max(MIN_MAX, currentMax - 1); // config: 1
    } else if (
        queueDepth > QUEUE_DEPTH_THRESHOLD &&       // config: 5
        currentMax < ABSOLUTE_MAX &&                // config: 10
        failureRate < 0.2
    ) {
        newMax = Math.min(ABSOLUTE_MAX, currentMax + 1);
    }

    this.semaphore.maxConcurrency = newMax;
}
```

---

## Architecture

```
performance-config.ts
    │ getAdaptiveConcurrencyConfig()
    ▼
adaptive-concurrency.ts
    │ DEFAULT_MAX, MIN_MAX, ABSOLUTE_MAX
    │ ADJUSTMENT_INTERVAL_MS
    │ FAILURE_RATE_THRESHOLD, QUEUE_DEPTH_THRESHOLD
    ▼
AdaptiveSemaphore (max: 1-10)
    │ acquire() / release()
    ▼
ExecutionEngine._concurrencyController
    │ _adjust() every 30s
    ▼
ExecutionEngine._semaphore
    │ limits concurrent CLI executions
```

---

## Observability

**Endpoint**: `GET /telemetry/concurrency`

```json
{
  "adaptive": {
    "currentMax": 5,
    "activeCount": 2,
    "pendingCount": 3,
    "lastFailureRate": 0.1,
    "lastQueueDepth": 8,
    "failureRateThreshold": 0.5,
    "queueDepthThreshold": 5,
    "adjustmentIntervalMs": 30000
  }
}
```

---

## Global vs Project vs Provider

| Scope | Mechanism | Cap |
|-------|-----------|-----|
| **Global** | `AdaptiveSemaphore` | 1-10 (dynamic) |
| **Project** | `ConcurrencyTracker` | 2 concurrent per project |
| **Provider** | `ConcurrencyTracker` | 2 concurrent per provider |

The adaptive controller only adjusts the **global** semaphore. Project and provider caps are fixed safety limits enforced by `ConcurrencyTracker`.
