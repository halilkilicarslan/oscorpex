# Query Inventory — Execution Engine DB Calls (EPIC 1.1)

**File Analyzed**: `apps/kernel/src/studio/execution-engine.ts`
**Lines of Code**: ~1,449
**DB Import Source**: `./db.js` (barrel export), `./pg.js` (raw query)
**Analysis Date**: 2026-04-27

---

## Direct DB Imports (from `./db.js`)

| Function | Import Line | Usage Count | Usage Lines |
|----------|-------------|-------------|-------------|
| `claimTask` | 20 | 1 | 491 |
| `getAgentConfig` | 21 | 0 | (not used directly in execution-engine) |
| `getLatestPlan` | 22 | 4 | 272, 438, 1282, 1347 |
| `getPipelineRun` | 23 | 1 | 1369 |
| `getProject` | 24 | 4 | 432, 563, 1367, (indirect via taskEngine) |
| `getProjectSetting` | 25 | 0 | (not used directly in execution-engine) |
| `getTask` | 26 | 6 | 311, 943, 1219, 1262, 1408, (indirect via taskEngine) |
| `listAgentConfigs` | 27 | 0 | (not used directly in execution-engine) |
| `listPhases` | 28 | 5 | 275, 440, 1284, 1349, (indirect via taskEngine) |
| `listProjectAgents` | 29 | 0 | (not used directly in execution-engine) |
| `listProjectTasks` | 30 | 1 | 401 |
| `listProjects` | 31 | 1 | 268 |
| `recordTokenUsage` | 32 | 1 | 982 |
| `releaseTaskClaim` | 33 | 5 | 284, 344, 511, 534, 558 |
| `updatePhaseStatus` | 34 | 1 | 290 |
| `updateProject` | 35 | 1 | 1342 |
| `updateTask` | 36 | 7 | 283, 343, 510, 533, 642, 930, 1157 |

---

## Raw PG Queries (from `./pg.js`)

| Function | Import Line | Usage Count | Usage Lines | Query |
|----------|-------------|-------------|-------------|-------|
| `pgExecute` | 65 | 1 | 405 | `UPDATE tasks SET status = 'queued', started_at = NULL WHERE id = $1` |
| `pgQueryOne` | 65 | 1 | 1264 | `SELECT COUNT(*) AS cnt FROM provider_execution_records WHERE task_id = $1 AND success = false` |

---

## TaskEngine Delegated Calls

`execution-engine.ts` delegates significant DB work to `task-engine.ts`. Key delegated operations:

| Method | Calls in execution-engine.ts | Likely DB Operations Inside |
|--------|------------------------------|----------------------------|
| `taskEngine.assignTask()` | 610, 1302 | UPDATE tasks SET status='assigned' |
| `taskEngine.startTask()` | 611, 612, 1303, 1413, 1414, 1416 | UPDATE tasks SET status='running', started_at=NOW() |
| `taskEngine.completeTask()` | 1089, 1331 | UPDATE tasks SET status='done', output=... |
| `taskEngine.failTask()` | 612, 1206, 1341 | UPDATE tasks SET status='failed', error=... |
| `taskEngine.retryTask()` | 1253 | UPDATE tasks SET status='queued', retry_count++ |
| `taskEngine.getReadyTasks()` | 326, 354, 443, 1373 | SELECT ... FROM tasks WHERE status='queued' AND dependencies met |
| `taskEngine.beginExecution()` | 451 | SELECT + UPDATE batch for pipeline start |
| `taskEngine.getProgress()` | 1427 | Aggregate SELECT across tasks |
| `taskEngine.isPhaseFailed()` | 1372 | SELECT EXISTS failed tasks in phase |
| `taskEngine.restartRevision()` | 310 | UPDATE task for revision restart |

---

## Execution Stage Mapping

### Stage: Recovery (`recoverStuckTasks`)
| DB Call | Line | Purpose |
|---------|------|---------|
| `listProjects()` | 268 | Find all projects to recover |
| `getLatestPlan()` | 272 | Get plan for each project |
| `listPhases()` | 275 | Get phases for each plan |
| `updateTask()` | 283 | Reset running task to queued |
| `releaseTaskClaim()` | 284 | Release worker claim |
| `updatePhaseStatus()` | 290 | Set phase back to running |
| `getTask()` | 311 | Refresh task state |

**Recovery round-trip count**: ~7 DB calls per stuck task

---

### Stage: Dispatch (`dispatchReadyTasks`)
| DB Call | Line | Purpose |
|---------|------|---------|
| `listProjectTasks()` | 401 | Get all tasks for project |
| `getProject()` | 432 | Get project config |
| `getLatestPlan()` | 438 | Get current plan |
| `listPhases()` | 440 | Get phases for plan |
| `pgExecute()` | 405 | Bulk reset non-running tasks |
| `taskEngine.getReadyTasks()` | 443, 451 | Find tasks ready to execute |

**Dispatch round-trip count**: ~6 DB calls per dispatch cycle

---

### Stage: Execute (`executeTask` — main path)
| DB Call | Line | Purpose |
|---------|------|---------|
| `claimTask()` | 491 | Claim task with SELECT FOR UPDATE |
| `getProject()` | 563 | Get project for execution context |
| `updateTask()` | 510, 533, 642 | Update task status, metadata |
| `releaseTaskClaim()` | 511, 534, 558 | Release claim after status change |
| `recordTokenUsage()` | 982 | Record token consumption |
| `getTask()` | 943 | Refresh task state (async after execution) |
| `pgQueryOne()` | 1264 | Count prior failures for retry decision |
| `taskEngine.assignTask()` | 610 | Assign task to agent |
| `taskEngine.startTask()` | 611 | Mark task as running |
| `taskEngine.completeTask()` | 1089 | Mark task as done |
| `taskEngine.failTask()` | 1206 | Mark task as failed |
| `taskEngine.retryTask()` | 1253 | Reset task for retry |

**Execute round-trip count**: ~10-15 DB calls per task execution

---

### Stage: Pipeline Advance (`advancePipeline`)
| DB Call | Line | Purpose |
|---------|------|---------|
| `getLatestPlan()` | 1282, 1347 | Get current plan |
| `listPhases()` | 1284, 1349 | Get phases for plan |
| `getProject()` | 1367 | Get project status |
| `getPipelineRun()` | 1369 | Get pipeline run state |
| `updateProject()` | 1342 | Update project status |
| `taskEngine.getReadyTasks()` | 1373 | Check for ready tasks |
| `taskEngine.isPhaseFailed()` | 1372 | Check if phase failed |

**Pipeline advance round-trip count**: ~7 DB calls

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Total distinct DB functions imported | 18 |
| Total DB functions actually used | 14 |
| Total direct DB call sites | ~30 |
| Total delegated DB calls (via taskEngine) | ~15 |
| Raw PG query sites | 2 |
| Recovery path DB calls | ~7 |
| Dispatch path DB calls | ~6 |
| Execute path DB calls | ~10-15 |
| Pipeline advance DB calls | ~7 |

---

## Observations

1. **`getTask()` is called 6+ times** during a single task lifecycle — potential for caching the task object between stages.
2. **`getLatestPlan()` and `listPhases()` are called in multiple stages** — recovery, dispatch, pipeline advance — always fetching the same data.
3. **`getProject()` is called 4 times** during execute + pipeline advance — project config rarely changes during execution.
4. **`updateTask()` + `releaseTaskClaim()` are paired** in many places — could be batched into a single UPDATE.
5. **Raw `pgExecute()` UPDATE** at line 405 bypasses the repo layer — potential inconsistency risk.
6. **Task engine delegation** obscures the true DB call count — each `taskEngine.*()` call may involve multiple DB operations.
