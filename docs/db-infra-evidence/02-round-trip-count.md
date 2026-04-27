# DB Round-Trip Count — Per Task Flow (EPIC 1.2)

**Methodology**: Static code analysis of `execution-engine.ts` + `task-engine.ts`
**Assumption**: Each `await dbFunction()` = 1 round-trip (no batching, no transaction merging)

---

## 1. Successful Task Flow (Happy Path)

**Flow**: `dispatchReadyTasks` → `claimTask` → `assignTask` → `startTask` → execute → `completeTask` → `advancePipeline`

| Step | DB Calls | Purpose |
|------|----------|---------|
| 1. `listProjectTasks()` | 1 | Load all tasks |
| 2. `getProject()` | 1 | Load project config |
| 3. `getLatestPlan()` | 1 | Load plan |
| 4. `listPhases()` | 1 | Load phases |
| 5. `taskEngine.getReadyTasks()` | 1 | Find ready tasks |
| 6. `claimTask()` | 1 | SELECT FOR UPDATE claim |
| 7. `getTask()` | 1 | Refresh task state |
| 8. `taskEngine.assignTask()` | 1 | UPDATE status='assigned' |
| 9. `taskEngine.startTask()` | 1 | UPDATE status='running', started_at |
| 10. `getProject()` | 1 | Reload project for context |
| 11. `recordTokenUsage()` | 1 | INSERT token usage |
| 12. `taskEngine.completeTask()` | 2 | UPDATE task + INSERT episode |
| 13. `getTask()` | 1 | Refresh for pipeline check |
| 14. `getLatestPlan()` | 1 | Load plan for advance |
| 15. `listPhases()` | 1 | Load phases for advance |
| 16. `getProject()` | 1 | Load project for advance |
| 17. `getPipelineRun()` | 1 | Load pipeline state |
| 18. `taskEngine.isPhaseFailed()` | 1 | Check phase status |
| 19. `taskEngine.getReadyTasks()` | 1 | Check next ready tasks |

**Total: ~19 DB round-trips per successful task**

**Notes**:
- `getProject()` called 3 times — could be cached after first load
- `getLatestPlan()` + `listPhases()` called 2 times — could be cached
- `getTask()` called 2 times — state changes force re-reads

---

## 2. Failed Task Flow (No Retry)

**Flow**: `dispatchReadyTasks` → `claimTask` → `assignTask` → `startTask` → execute → `failTask` → `advancePipeline`

| Step | DB Calls | Purpose |
|------|----------|---------|
| 1-10. Same as happy path | 10 | Dispatch + claim + assign + start |
| 11. `taskEngine.failTask()` | 2 | UPDATE task failed + INSERT episode |
| 12. `getTask()` | 1 | Refresh for pipeline |
| 13-19. Same as happy path pipeline | 7 | Pipeline advance checks |

**Total: ~19 DB round-trips per failed task**

**Notes**:
- Same count as happy path because pipeline advance still runs
- No retry path taken (retry count = 0 or non-retryable error)

---

## 3. Failed Task Flow (With Retry)

**Flow**: `dispatchReadyTasks` → `claimTask` → `assignTask` → `startTask` → execute (fail) → `retryTask` → re-dispatch

| Step | DB Calls | Purpose |
|------|----------|---------|
| 1-10. Same as happy path | 10 | Dispatch + claim + assign + start |
| 11. `pgQueryOne()` | 1 | Count prior failures |
| 12. `taskEngine.retryTask()` | 1 | UPDATE status='queued', retry_count++ |
| 13. `getTask()` | 1 | Refresh task state |
| 14. `dispatchReadyTasks()` | 6 | Re-dispatch (listProjectTasks, getProject, getLatestPlan, listPhases, getReadyTasks) |
| 15. `claimTask()` | 1 | Re-claim |
| 16. `taskEngine.assignTask()` | 1 | Re-assign |
| 17. `taskEngine.startTask()` | 1 | Re-start |
| 18. Execute (success or fail) | 1-3 | completeTask or failTask |
| 19. Pipeline advance | 7 | Same as happy path |

**Total: ~33 DB round-trips per retried task (2 execution attempts)**

**Notes**:
- Retry essentially duplicates the dispatch + execute flow
- `pgQueryOne()` at line 1264 adds 1 extra call for failure counting
- If retry also fails and falls back to max retries, count increases further

---

## 4. Failed Task Flow (With Fallback)

**Flow**: `dispatchReadyTasks` → `claimTask` → `assignTask` → `startTask` → execute (fail primary) → fallback provider → execute (success/fail)

| Step | DB Calls | Purpose |
|------|----------|---------|
| 1-10. Same as happy path | 10 | First attempt dispatch + execute setup |
| 11. Primary provider fails | 0 | (in-memory failure) |
| 12. Fallback provider selected | 0 | (in-memory decision) |
| 13. `getProject()` | 1 | Reload for fallback context |
| 14. `taskEngine.startTask()` | 1 | Restart with fallback (status already running) |
| 15. Execute fallback | 1 | completeTask or failTask |
| 16-22. Pipeline advance | 7 | Same as happy path |

**Total: ~20 DB round-trips per fallback task**

**Notes**:
- Fallback reuses the same task claim (no re-claim)
- Only 1 extra `getProject()` + `startTask()` for fallback context
- If fallback also fails, count increases by retry logic

---

## 5. Recovery Flow (Per Stuck Task)

**Flow**: `recoverStuckTasks` → find running tasks → reset to queued → restart pipeline

| Step | DB Calls | Purpose |
|------|----------|---------|
| 1. `listProjects()` | 1 | Find all projects |
| 2. `getLatestPlan()` | 1 | Get plan per project |
| 3. `listPhases()` | 1 | Get phases per plan |
| 4. `updateTask()` | 1 | Reset task status |
| 5. `releaseTaskClaim()` | 1 | Release worker claim |
| 6. `updatePhaseStatus()` | 1 | Reset phase status |
| 7. `getTask()` | 1 | Refresh task state |

**Total: ~7 DB round-trips per recovered task**

---

## Summary Table

| Flow | DB Round-Trips | Bottleneck |
|------|---------------|------------|
| Successful task | ~19 | Repeated getProject/getLatestPlan/listPhases |
| Failed task (no retry) | ~19 | Same as successful |
| Failed task (with retry) | ~33 | Double dispatch + execute + pgQueryOne |
| Failed task (with fallback) | ~20 | Fallback re-execution |
| Recovery (per stuck task) | ~7 | Bulk operation potential |
| **Average per task** | **~20** | — |

---

## Optimization Opportunities

| Rank | Opportunity | Estimated Savings |
|------|-------------|-------------------|
| 1 | Cache `getProject()` result during execution | -2 round-trips |
| 2 | Cache `getLatestPlan()` + `listPhases()` during execution | -2 round-trips |
| 3 | Batch `updateTask()` + `releaseTaskClaim()` pairs | -2 round-trips |
| 4 | Cache `getTask()` between state transitions | -1 round-trip |
| 5 | Merge pipeline advance reads (plan+phases+project+pipeline) | -2 round-trips |
| **Total potential** | | **-9 round-trips (~47% reduction)** |

---

## Measurement Verification

These counts are estimates based on static code analysis. To verify:

1. Add query logging wrapper to `pg.js` `query()` and `execute()` functions
2. Run a single task through the system
3. Count actual query log lines
4. Compare with this estimate

The true count may be higher due to:
- Task engine internal queries not fully mapped
- Trigger-based auto-updates (e.g., `updated_at`)
- Index maintenance
- FK constraint checks
