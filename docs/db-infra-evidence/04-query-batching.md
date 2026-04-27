# Query Batching / Round-Trip Reduction — Analysis (EPIC 4)

**Scope**: `execution-engine.ts` task lifecycle DB calls
**Goal**: Reduce DB round-trips while maintaining identical behavior

---

## 4.1 Claim Flow Analysis

### Current Flow in `executeTask()`

```
1. claimTask(task.id, workerId)           → UPDATE + RETURNING
2. getTask(task.id)                        → SELECT (REDUNDANT — claimTask returns task)
3. taskEngine.assignTask(task.id, agent)   → UPDATE
4. taskEngine.startTask(task.id)           → UPDATE + RETURNING
5. getProject(projectId)                   → SELECT
6. execute...
7. taskEngine.completeTask() / failTask()  → UPDATE + INSERT
8. getTask(task.id)                        → SELECT (REDUNDANT — completeTask/failTask returns task)
```

**Findings**:
- `getTask()` at line 311 (recovery) and line 943 (post-execution) are potentially redundant
- `getProject()` at line 563 is the 2nd or 3rd load of the same project in one flow

---

## 4.2 Assign/Start Flow

### Current State Transitions

| Transition | DB Calls | Notes |
|------------|----------|-------|
| queued → assigned | `taskEngine.assignTask()` → 1 UPDATE | Clean |
| assigned → running | `taskEngine.startTask()` → 1 UPDATE | Clean |
| running → done | `taskEngine.completeTask()` → 2 calls | UPDATE + INSERT episode |
| running → failed | `taskEngine.failTask()` → 2 calls | UPDATE + INSERT episode |

**Observation**: The update + insert pairs in completeTask/failTask are already batched within task-engine.ts. No further batching opportunity without transaction wrapping.

---

## 4.3 Repeated Read Reduction

### Identified Redundancies

| Read | Count | Locations | Fix Strategy |
|------|-------|-----------|--------------|
| `getProject()` | 3 | dispatch, execute, advance | Pass project object through flow |
| `getTask()` | 2+ | recovery, post-execution | Use UPDATE RETURNING values |
| `getLatestPlan()` + `listPhases()` | 2-3 | recovery, dispatch, advance | Cache for project lifetime |

---

## 4.4 Batch Refactor Plan

### Safe Changes (No Behavioral Change)

1. **Replace raw `pgExecute()` with `updateTask()`** ✅ DONE
   - Line 405: Raw UPDATE → `updateTask(task.id, { status: "queued", startedAt: undefined })`
   - Benefit: Consistency + uses repo layer + same round-trip count

2. **Remove redundant `getTask()` after state transitions**
   - `startTask()` already returns updated task via RETURNING
   - `completeTask()`/`failTask()` already return updated task
   - Use return values instead of re-querying

3. **Pass project through execution flow**
   - `dispatchReadyTasks()` already loads project
   - Pass it to `executeTask()` as parameter
   - Avoids 2nd and 3rd `getProject()` calls

### Medium-Risk Changes (Requires Careful Testing)

4. **Create `getPlanWithPhases(projectId)` repo function**
   - JOIN query: `SELECT ... FROM plans p LEFT JOIN phases ph ON ph.plan_id = p.id`
   - Replaces paired `getLatestPlan()` + `listPhases()` calls
   - Saves 1 round-trip per call site

5. **Transaction-wrap task state transitions**
   - `assignTask()` + `startTask()` could be a single transaction
   - `completeTask()` + pipeline advance could be a single transaction
   - Risk: Lock contention, rollback complexity

---

## 4.5 Applied Change

**Change**: Replaced raw `pgExecute()` at line 405 with `updateTask()`

```typescript
// Before:
await pgExecute("UPDATE tasks SET status = 'queued', started_at = NULL WHERE id = $1", [task.id]);

// After:
await updateTask(task.id, { status: "queued", startedAt: undefined });
```

**Rationale**:
- Behaviorally identical: same UPDATE, same row
- More maintainable: uses repo layer, type-safe
- Consistent: all other task updates go through `updateTask()`
- No round-trip reduction (still 1 UPDATE), but removes raw query anti-pattern

---

## 4.6 Tests

Existing tests already cover:
- `execution-engine.test.ts` — full execution flow
- `task-engine.test.ts` — state transitions
- `pipeline-engine.test.ts` — pipeline advance

The raw query replacement was verified by:
1. Typecheck passing
2. All existing tests passing
3. No behavioral change in test assertions

---

## Next Refactors (Future EPICs)

| Priority | Change | Est. Savings |
|----------|--------|-------------|
| P1 | Pass project through execution flow | -2 round-trips |
| P2 | Use startTask/completeTask return values | -1 round-trip |
| P3 | getPlanWithPhases() JOIN query | -2 round-trips |
| P4 | Transaction-wrap state transitions | -1 round-trip + consistency |
