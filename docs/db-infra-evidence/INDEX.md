# DB Baseline Summary (EPIC 1.4)

**Date**: 2026-04-27
**Scope**: DB / Pool / Runtime Infra Optimization — Phase 1 Baseline

---

## Evidence Files

| File | Content |
|------|---------|
| `01-query-inventory.md` | All DB functions used in execution-engine.ts with line numbers and counts |
| `02-round-trip-count.md` | Per-flow DB round-trip estimates (success, fail, retry, fallback, recovery) |
| `03-slow-query-candidates.md` | Repeated read patterns, N+1 risks, index recommendations |

---

## Top 5 Most Expensive DB Touches

### 1. Task Completion (`taskEngine.completeTask()`)
**Cost**: HIGH
**Operations**: UPDATE tasks + INSERT episodes + possibly INSERT agent_steps + UPDATE working_memory + FK constraint checks + trigger firing
**Frequency**: Once per successful task
**Impact**: ~20-30ms per call (estimated)

### 2. Task Failure (`taskEngine.failTask()`)
**Cost**: HIGH
**Operations**: UPDATE tasks + INSERT episodes + possibly INSERT learning_patterns + event emission
**Frequency**: Once per failed task
**Impact**: ~20-30ms per call (estimated)

### 3. Task Claim (`claimTask()`)
**Cost**: MEDIUM
**Operations**: SELECT FOR UPDATE + row-level lock + UPDATE status
**Frequency**: Once per task execution
**Impact**: ~5-15ms per call, but lock contention under high concurrency

### 4. Project Task List (`listProjectTasks()`)
**Cost**: MEDIUM
**Operations**: SELECT * FROM tasks WHERE project_id = $1
**Frequency**: Every dispatch cycle
**Impact**: Scales with task count per project. Could become slow if > 1000 tasks.

### 5. Token Usage Recording (`recordTokenUsage()`)
**Cost**: LOW-MEDIUM
**Operations**: INSERT INTO token_usage
**Frequency**: Once per task execution
**Impact**: ~5ms per call, but table grows indefinitely.

---

## Top 3 Optimization Opportunities

### 1. In-Memory Task/Project/Plan Caching During Execution (-9 round-trips, ~47% reduction)
**What**: Cache `getProject()`, `getLatestPlan()`, `listPhases()`, and `getTask()` results during a single task execution lifecycle.
**Why**: These are re-read multiple times for the same IDs within seconds. The data rarely changes mid-execution.
**How**: 
- Pass project object through execution flow
- Use `startTask()`/`assignTask()` return values instead of re-querying
- Cache plan+phases for the duration of `executeTask()`
**Risk**: LOW — Data staleness is acceptable for milliseconds within a single execution
**Effort**: 2-3 hours

### 2. Batch `updateTask()` + `releaseTaskClaim()` Pairs (-2 round-trips)
**What**: Many places update task status and immediately release the claim in separate queries.
**Why**: Each pair = 2 round-trips that could be 1.
**How**: 
- Create `updateTaskAndReleaseClaim(id, updates)` repo function
- Single UPDATE with both status and claim fields
**Risk**: LOW — Atomic operation, no behavioral change
**Effort**: 1 hour

### 3. Composite Index on `tasks(phase_id, status, created_at)`
**What**: Add missing index for `getReadyTasks()` query
**Why**: `getReadyTasks()` runs every dispatch cycle. Currently may do index-only scan on `phase_id` then filter by `status`.
**How**: `CREATE INDEX idx_tasks_ready ON tasks(phase_id, status, created_at);`
**Risk**: VERY LOW — Standard index, minimal write overhead
**Effort**: 10 minutes

---

## Baseline Metrics

| Metric | Value |
|--------|-------|
| Distinct DB functions imported | 18 |
| DB functions actually used | 14 |
| Direct DB call sites in execution-engine.ts | ~30 |
| Delegated DB calls via taskEngine | ~15 |
| Raw PG query sites | 2 |
| Avg round-trips per successful task | ~19 |
| Avg round-trips per retried task | ~33 |
| Recovery round-trips per stuck task | ~7 |
| Estimated potential reduction | -9 round-trips (47%) |

---

## Next Steps (EPIC 2-4)

1. **Pool visibility** (EPIC 2): Add pool stats interface + telemetry endpoint
2. **Pool tuning** (EPIC 3): Configurable pool size + timeout settings
3. **Query batching** (EPIC 4): Implement the top 3 optimizations above

---

## Verification Commands

```bash
# Confirm no missing DB imports
pnpm --filter @oscorpex/kernel typecheck

# Run existing tests to ensure baseline is green
pnpm --filter @oscorpex/kernel test
```
