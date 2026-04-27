# Task State Transition Matrix (EPIC 5)

**Scope**: Task lifecycle state machine in `task-engine.ts` and `execution-engine.ts`

---

## Allowed Transitions

| From | To | Trigger | Transaction Safe? |
|------|-----|---------|-------------------|
| `queued` | `assigned` | `taskEngine.assignTask()` | ✅ Yes |
| `assigned` | `running` | `taskEngine.startTask()` | ✅ Yes |
| `queued` | `running` | `taskEngine.startTask()` (direct) | ✅ Yes |
| `running` | `done` | `taskEngine.completeTask()` | ✅ Yes |
| `running` | `failed` | `taskEngine.failTask()` | ✅ Yes |
| `failed` | `queued` | `taskEngine.retryTask()` | ✅ Yes |
| `running` | `queued` | Recovery (`recoverStuckTasks`) | ⚠️ Risky |
| `assigned` | `queued` | Recovery | ⚠️ Risky |
| `running` | `queued` | Pipeline pause | ⚠️ Risky |
| `running` | `waiting_approval` | `updateTask()` (manual) | ✅ Yes |
| `waiting_approval` | `done` | Approval granted | ✅ Yes |
| `waiting_approval` | `queued` | Approval rejected | ✅ Yes |

---

## Illegal Transitions

| From | To | Risk |
|------|-----|------|
| `done` | `running` | Task would re-execute after completion |
| `failed` | `running` | Must go through `queued` first |
| `done` | `failed` | Cannot un-complete a task |
| `queued` | `done` | Must go through `running` |
| `queued` | `failed` | Must go through `running` |

---

## Idempotency Guards

### Guard 1: Double-Start Prevention

**Location**: `execution-engine.ts::executeTask()` lines 608-613

```typescript
const currentStatus = currentTask?.status ?? task.status;
if (currentStatus === "queued") {
  await taskEngine.assignTask(task.id, agent.id);
  startedTask = await taskEngine.startTask(task.id);
} else if (currentStatus === "assigned") {
  startedTask = await taskEngine.startTask(task.id);
}
// status === "running" → already started, skip both
```

**Status**: ✅ Already guarded. If task is already `running`, both assign and start are skipped.

---

### Guard 2: Recovery / Restart Collision

**Location**: `execution-engine.ts::recoverStuckTasks()` lines 268-290

**Risk**: If a task is genuinely running (process active) when recovery runs, it gets reset to `queued` while the process continues.

**Mitigation**: Recovery only runs at kernel startup. By definition, no processes should be active during startup (previous process died).

**Status**: ✅ Acceptable for current architecture. Would need process-level heartbeat if we want to distinguish "genuinely running" from "orphaned running".

---

### Guard 3: Concurrent Dispatch

**Location**: `execution-engine.ts::executeTask()` line 193

```typescript
private _dispatchingTasks = new Set<string>();
```

**Behavior**: 
- Before dispatch: `this._dispatchingTasks.add(task.id)`
- If already in set: skip dispatch (return early)
- After completion: remove from set

**Status**: ✅ Already guarded. Prevents the same task from being dispatched twice by the same worker.

---

## Transaction Boundaries

### Recommended Transaction Wrappers

| Operation | Current | Recommended |
|-----------|---------|-------------|
| Claim + Assign + Start | 3 separate UPDATES | 1 transaction |
| Complete + Pipeline Advance | Multiple separate calls | 1 transaction |
| Fail + Retry Reset | 2 separate calls | 1 transaction |

**Note**: Full transaction wrapping is medium-risk because it increases lock hold time. For now, the SELECT FOR UPDATE in `claimTask()` provides sufficient isolation.

---

## Recovery-Safe Transitions

### After Kernel Restart

1. **Orphaned running tasks** → `queued` (via `recoverStuckTasks`)
2. **Orphaned assigned tasks** → `queued` (via `recoverStuckTasks`)
3. **Phases with running tasks** → `running` (restart execution)

### Collision Scenarios

| Scenario | Handling |
|----------|----------|
| Recovery resets task to `queued`, but worker still executing | Worker completes and tries to update task. The update will succeed because status is now `queued` (no conflict). However, the task may be re-dispatched while the old execution is still running. |
| Two workers claim same task | `claimTask()` uses `SELECT FOR UPDATE SKIP LOCKED` — only one worker wins. |
| Worker crashes mid-execution | Task stays `running` until recovery runs at next startup. |

**Status**: Recovery is best-effort. True exactly-once execution would require distributed locks or saga pattern.
