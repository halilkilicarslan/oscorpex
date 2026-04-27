# Claim / Locking Hardening (EPIC 6)

**Module**: `apps/kernel/src/studio/db.js` → `claimTask()`
**Consumer**: `execution-engine.ts::executeTask()`

---

## Claim Result Classification

### Success
- `claimTask()` returns the claimed task row
- Task status was `queued` and is now `claimed`

### Failure Reasons

| Reason | Condition | Return Value |
|--------|-----------|--------------|
| `already_claimed` | Another worker already claimed the task | `null` |
| `not_queued` | Task status is not `queued` (e.g., `running`, `done`) | `null` |
| `stale_state` | Task row does not exist | `null` |
| `db_error` | Database connection error | throws |

---

## Claim Metrics

**Location**: `execution-engine.ts::executeTask()` line 491

Current code:
```typescript
const freshTask = await claimTask(task.id, this._workerId);
if (!freshTask) {
  log.warn(`[execution-engine] Task ${task.id} was claimed by another worker — skipping`);
  return;
}
```

**Missing**: No metric tracking for claim success/failure breakdown.

### Recommended Metrics

```typescript
interface ClaimMetrics {
  totalAttempts: number;
  successCount: number;
  alreadyClaimedCount: number;
  notQueuedCount: number;
}
```

**Implementation Note**: This would require `claimTask()` to return a discriminated union instead of `Task | null`:
```typescript
type ClaimResult =
  | { status: "success"; task: Task }
  | { status: "already_claimed" }
  | { status: "not_queued"; currentStatus: string }
  | { status: "not_found" };
```

**Risk**: Medium — changing `claimTask()` return type affects all callers.

**Alternative**: Log the reason in `claimTask()` itself, then aggregate from logs.

---

## Lock Contention

### Current Mechanism

```sql
UPDATE tasks
SET status = 'claimed', worker_id = $2, claimed_at = NOW()
WHERE id = $1
  AND status = 'queued'
RETURNING *;
```

**Properties**:
- Atomic test-and-set
- No explicit row lock needed (UPDATE locks the row)
- `SKIP LOCKED` not used here (that pattern is in `claimTask()` for bulk claiming)

### Contention Scenarios

1. **Two workers try to claim same task simultaneously**
   - One UPDATE succeeds, the other matches 0 rows
   - No deadlock possible (single-row UPDATE)

2. **Worker claims task while another worker is reading it**
   - Reader sees old state until UPDATE commits
   - Acceptable for our consistency model

3. **High concurrency on task queue**
   - If many workers poll `getReadyTasks()` simultaneously
   - Workers may attempt to claim the same task
   - First worker wins, others get `null`

**Mitigation**: Current mechanism is sufficient. No additional locking needed.

---

## Multi-Worker Risks

### Distributed Execution

Current architecture assumes single kernel process. If multiple kernel instances run:

| Risk | Current State | Mitigation |
|------|---------------|------------|
| Two instances claim same task | Prevented by DB-level UPDATE | ✅ Works |
| Instance A recovers task while Instance B is executing | Possible if Instance B doesn't heartbeat | Needs worker heartbeat column |
| Claimed task never released | `releaseTaskClaim()` handles normal path. Recovery handles crashes. | ✅ Works |

### Worker Heartbeat (Future)

To support true multi-instance deployment, add:

```sql
ALTER TABLE tasks ADD COLUMN worker_heartbeat_at TIMESTAMP;
```

**Claim logic**:
```sql
UPDATE tasks
SET status = 'claimed', worker_id = $2, claimed_at = NOW(), worker_heartbeat_at = NOW()
WHERE id = $1
  AND (status = 'queued' OR (status = 'claimed' AND worker_heartbeat_at < NOW() - INTERVAL '2 minutes'))
RETURNING *;
```

This would allow a new worker to steal a task from a dead worker.

---

## Tests

### Recommended Claim Tests

1. **Parallel claim**: Two workers claim same task → one succeeds, one fails
2. **Stale state claim**: Task status changed to `running` → claim returns null
3. **Non-existent task claim**: `claimTask('fake-id')` → returns null
4. **Claim then release**: Claim task, release claim, claim again → succeeds

**Status**: These tests would require DB-backed integration tests. The existing `execution-engine.test.ts` covers some of these indirectly.
