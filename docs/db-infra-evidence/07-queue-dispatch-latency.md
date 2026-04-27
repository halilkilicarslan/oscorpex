# Queue Dispatch Latency (EPIC 7)

**Module**: `execution-engine.ts` — `dispatchReadyTasks()` → `executeTask()`

---

## Definitions

### Queue Wait (`queueWaitMs`)
**Definition**: Time from task creation to task start
**Formula**: `task.startedAt - task.createdAt`
**Status**: ✅ Already implemented in `execution-engine.ts` line 616
**Field**: `ProviderExecutionTelemetry.queueWaitMs`

### Dispatch Latency
**Definition**: Time from task entering `dispatchReadyTasks()` to first provider binary spawn
**Formula**: `providerSpawnTime - dispatchStartTime`
**Status**: 📝 Not yet measured separately

### Execution Latency
**Definition**: Time from first provider binary spawn to execution completion
**Formula**: `executionCompleteTime - providerSpawnTime`
**Status**: ✅ Measured as `ProviderExecutionTelemetry.latencyMs`

---

## Current Measurement Points

```
task.createdAt          task.startedAt          providerSpawn          executionComplete
     │                       │                        │                       │
     ▼                       ▼                        ▼                       ▼
   [==== queueWaitMs ======]                          │                       │
                                                      │                       │
                           [==== dispatch latency ===]│                       │
                                                                               │
                                                      [===== latencyMs ======]│
```

**Note**: `queueWaitMs` + `dispatch latency` + `latencyMs` = total time from creation to completion

---

## Why Queue Wait is the Primary Metric

1. **Captures scheduling fairness**: If short tasks wait too long, `queueWaitMs` reveals it
2. **Independent of provider speed**: Queue wait is purely infrastructure, not provider performance
3. **Easy to measure**: Uses existing `created_at` and `started_at` columns

**Dispatch latency** is harder to isolate because:
- `executeTask()` does many things before spawning (assign, start, context building)
- Some tasks skip provider spawn entirely (review tasks, system tasks)
- The boundary between "dispatch" and "execution" is blurry

---

## Future Enhancement: Fine-Grained Latency Stages

If needed, add these timestamps to `ProviderExecutionTelemetry`:

```typescript
interface ProviderExecutionTelemetry {
  // Existing
  queueWaitMs: number;       // createdAt → startedAt
  latencyMs: number;         // startedAt → completedAt

  // Future
  dispatchLatencyMs: number; // startedAt → first provider call
  spawnLatencyMs: number;    // first provider call → provider ready
  executionLatencyMs: number;// provider ready → execution complete
}
```

**Use case**: If `queueWaitMs` is low but tasks feel slow, `spawnLatencyMs` would reveal provider startup overhead.

---

## Debug Endpoint

**GET /telemetry/providers/queue-wait** already exposes:
- `queueWaitMs` per record
- Average and max queue wait across recent records

**Response shape**:
```json
{
  "total": 20,
  "recordsWithQueueWait": 18,
  "avgQueueWaitMs": 890,
  "maxQueueWaitMs": 4200,
  "records": [
    {
      "runId": "r-1",
      "taskId": "t-1",
      "provider": "claude-code",
      "queueWaitMs": 1200,
      "latencyMs": 3500,
      "success": true,
      "startedAt": "2026-04-27T10:00:01.000Z"
    }
  ]
}
```

---

## Tests

Existing tests cover:
- `queue-wait.test.ts`: `computeQueueWaitMs()` helper
- `performance-regression.test.ts`: Queue wait bounds verification

No additional tests needed for EPIC 7 — the metric is already captured and tested.
