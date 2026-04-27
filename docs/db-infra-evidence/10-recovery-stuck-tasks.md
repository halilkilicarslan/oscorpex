# Recovery / Stuck Task Hardening (EPIC 10)

**Module**: `execution-engine.ts::recoverStuckTasks()`
**Trigger**: Kernel startup

---

## Recovery Metrics

**Current State**: No explicit metrics. Recovery actions are logged but not aggregated.

### Proposed Metrics

```typescript
interface RecoveryMetrics {
  recoveryRuns: number;
  orphanedRunningTasksRecovered: number;
  orphanedAssignedTasksRecovered: number;
  phasesRestarted: number;
}
```

**Where to store**: As counters on `ExecutionEngine` instance, exposed via `/telemetry/runtime`.

---

## Recovery Debug Surface

**GET /telemetry/runtime** (EPIC 13) would include:
```json
{
  "recovery": {
    "recoveryRuns": 5,
    "orphanedRunningTasksRecovered": 12,
    "orphanedAssignedTasksRecovered": 3,
    "phasesRestarted": 8
  }
}
```

---

## Orphan Detection Criteria

**Current Criteria** (line 268-290):
```typescript
// All tasks with status === 'running' or status === 'assigned'
// are considered orphaned and reset to 'queued'
```

**Why this is safe**:
- Recovery only runs at kernel startup
- Kernel startup implies the previous process crashed
- Therefore no processes should still be running

**False Positive Risk**: LOW in current single-process architecture.

**False Positive Risk in Multi-Instance**: HIGH — if Instance A is still running tasks, Instance B startup would reset them.

---

## Recovery Smoke Tests

### Test 1: Running Task → Queued After Recovery
```typescript
it("recovers running task to queued after restart", async () => {
  // Simulate: task is 'running' but kernel crashed
  await updateTask(task.id, { status: "running", workerId: "old-worker" });
  // Run recovery
  await executionEngine.recoverStuckTasks();
  // Verify
  const recovered = await getTask(task.id);
  expect(recovered.status).toBe("queued");
  expect(recovered.workerId).toBeNull();
});
```

### Test 2: Assigned Task → Queued After Recovery
```typescript
it("recovers assigned task to queued after restart", async () => {
  await updateTask(task.id, { status: "assigned", workerId: "old-worker" });
  await executionEngine.recoverStuckTasks();
  const recovered = await getTask(task.id);
  expect(recovered.status).toBe("queued");
});
```

### Test 3: Phase Restarted
```typescript
it("restarts phase execution after recovery", async () => {
  await updatePhaseStatus(phase.id, "running");
  await executionEngine.recoverStuckTasks();
  // Phase should be set back to running and execution started
});
```

---

## Controller Cleanup

**Current Issue**: `execution-engine.ts` stores `AbortController` instances:
```typescript
private _activeControllers = new Map<string, AbortController>();
```

**Risk**: If kernel crashes, these controllers are lost. Recovery does not clean them up (they're in-memory only).

**Mitigation**: Acceptable — controllers are process-local. New process starts fresh.
