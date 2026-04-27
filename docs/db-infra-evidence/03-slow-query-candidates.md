# Slow Query Candidates (EPIC 1.3)

**Analysis Scope**: `execution-engine.ts`, `task-engine.ts`, `db/*.ts` repos
**Focus**: Read patterns, repeated queries, N+1 risks

---

## High-Frequency Read Patterns

### 1. `getTask(id)` — Called Multiple Times Per Task Lifecycle

**Frequency**: 6+ times per task execution in `execution-engine.ts`, plus internal calls in `task-engine.ts`

**Usage Points**:
- Line 311: After recovery, refresh task state
- Line 943: After execution completes, refresh for status check
- Line 1219: After failure, refresh for retry decision
- Line 1262: Before retry, check current state
- Line 1408: Before final status update
- Plus internal calls within `taskEngine.completeTask()`, `taskEngine.failTask()`, etc.

**Risk**: MEDIUM — Each `getTask()` is a `SELECT * FROM tasks WHERE id = $1`. The task row is small but the query is executed repeatedly for the same ID within milliseconds.

**Optimization**: Cache the task object in memory during execution lifecycle. Invalidate only if a concurrent modification is detected.

---

### 2. `getProject(projectId)` — Called 3-4 Times Per Task

**Frequency**: 4 times per task execution

**Usage Points**:
- Line 432: `dispatchReadyTasks()` — load project config
- Line 563: `executeTask()` — load project for execution context
- Line 1367: `advancePipeline()` — load project for pipeline check

**Risk**: LOW-MEDIUM — `projects` table is small, query is fast. But redundant.

**Optimization**: Cache project config for the duration of execution. Project settings rarely change mid-execution.

---

### 3. `getLatestPlan(projectId)` + `listPhases(planId)` — Always Paired

**Frequency**: 2-3 times per task execution, always together

**Usage Points**:
- Line 272, 275: Recovery
- Line 438, 440: Dispatch
- Line 1282, 1284: Pipeline advance
- Line 1347, 1349: Pipeline advance (failure path)

**Risk**: LOW — Plan and phases are relatively static during execution. But the paired queries add up.

**Optimization**: 
1. Cache plan + phases together for the project
2. Or add a repo function `getPlanWithPhases(projectId)` that returns both in a single JOIN query

---

### 4. `taskEngine.getReadyTasks(phaseId)` — Called Per Dispatch Cycle

**Frequency**: Every dispatch cycle (could be multiple times per minute under load)

**Query Pattern** (inferred from `task-engine.ts`):
```sql
SELECT * FROM tasks
WHERE phase_id = $1
  AND status = 'queued'
  AND (depends_on IS NULL OR depends_on = '{}')
ORDER BY created_at;
```

**Risk**: LOW — Indexed query, but runs frequently.

**Optimization**: Add composite index on `(phase_id, status, created_at)` if not already present.

---

### 5. `claimTask(id, workerId)` — SELECT FOR UPDATE

**Frequency**: Once per task execution

**Query Pattern**:
```sql
UPDATE tasks
SET status = 'claimed', worker_id = $2, claimed_at = NOW()
WHERE id = $1
  AND status = 'queued'
RETURNING *;
```

**Risk**: LOW — Fast indexed update, but uses row-level lock. Under high concurrency, contention on hot tasks.

**Optimization**: Ensure index on `(id, status)` or at least `(status)` for the WHERE clause.

---

## Repeated Read Anti-Patterns

### Anti-Pattern 1: Re-read After Every State Change

```typescript
// execution-engine.ts pattern:
await taskEngine.assignTask(task.id, agent.id);   // UPDATE
startedTask = await taskEngine.startTask(task.id); // UPDATE + SELECT RETURNING
// ... later ...
const currentTask = await getTask(task.id);        // SELECT (REDUNDANT)
```

**Impact**: `startTask()` already returns the updated task via `RETURNING *`. The subsequent `getTask()` is redundant.

**Fix**: Use the return value from `startTask()` instead of re-querying.

---

### Anti-Pattern 2: Re-load Project Config in Every Stage

```typescript
// dispatchReadyTasks:
const project = await getProject(projectId);       // SELECT

// executeTask:
const project = await getProject(projectId);       // SELECT (SAME PROJECT)

// advancePipeline:
const project = await getProject(projectId);       // SELECT (SAME PROJECT)
```

**Impact**: 3 identical queries for the same project ID within seconds.

**Fix**: Pass project object through the execution flow instead of re-loading.

---

### Anti-Pattern 3: Plan + Phases Loaded Independently

```typescript
const plan = await getLatestPlan(projectId);       // SELECT plans
const phases = await listPhases(plan.id);          // SELECT phases WHERE plan_id = $1
```

**Impact**: 2 round-trips when 1 JOIN would suffice.

**Fix**: `getPlanWithPhases(projectId)` → single JOIN query.

---

### Anti-Pattern 4: Raw pgExecute Bypasses Repo Layer

```typescript
// execution-engine.ts line 405:
await pgExecute("UPDATE tasks SET status = 'queued', started_at = NULL WHERE id = $1", [task.id]);
```

**Impact**: 
- No `RETURNING` clause — requires re-read to get updated state
- Bypasses repo layer consistency (triggers, audit logs, etc.)
- No type safety

**Fix**: Replace with `updateTask(task.id, { status: 'queued', startedAt: null })`

---

## Potential N+1 Risks

### Risk 1: Recovery Loop

```typescript
for (const project of projects) {          // N projects
  const plan = await getLatestPlan(project.id);    // N queries
  const phases = await listPhases(plan.id);        // N queries
  for (const phase of phases) {            // M phases
    for (const task of phase.tasks) {      // K tasks
      await updateTask(task.id, ...);      // N×M×K queries
    }
  }
}
```

**Current State**: Recovery runs sequentially, one project at a time. Not a critical N+1 because it runs at startup only.

**Mitigation**: Acceptable for now. If project count grows > 100, consider batching.

---

### Risk 2: Dispatch Loop

```typescript
for (const phase of phases) {             // M phases
  const ready = await taskEngine.getReadyTasks(phase.id);  // M queries
}
```

**Current State**: `dispatchReadyTasks()` iterates phases. Under normal load, phases per plan = 3-5. Acceptable.

**Mitigation**: If phases grow > 10, batch ready-task check across all phases.

---

## Index Recommendations

| Table | Column(s) | Query Benefit |
|-------|-----------|---------------|
| `tasks` | `(phase_id, status, created_at)` | `getReadyTasks()` |
| `tasks` | `(status, worker_id)` | `claimTask()` + `releaseTaskClaim()` |
| `tasks` | `(project_id, status)` | `listProjectTasks()` filtered by status |
| `phases` | `(plan_id, status)` | `listPhases()` + phase filtering |
| `provider_execution_records` | `(task_id, success)` | Failure count query (line 1264) |

---

## Top 5 Most Expensive DB Touches

| Rank | Operation | Est. Cost | Why |
|------|-----------|-----------|-----|
| 1 | `taskEngine.completeTask()` | HIGH | UPDATE tasks + INSERT episodes + possibly INSERT agent_steps + UPDATE memory + FK checks |
| 2 | `taskEngine.failTask()` | HIGH | UPDATE tasks + INSERT episodes + possibly INSERT learning_patterns |
| 3 | `claimTask()` | MEDIUM | SELECT FOR UPDATE + row lock contention |
| 4 | `listProjectTasks()` | MEDIUM | Full table scan on tasks for project (if no index) |
| 5 | `recordTokenUsage()` | LOW-MEDIUM | INSERT into token_usage table |

---

## Quick Wins

| Priority | Fix | Effort | Impact |
|----------|-----|--------|--------|
| P1 | Use `startTask()` return value instead of `getTask()` | 10 min | -1 round-trip |
| P1 | Cache `getProject()` in execution flow | 30 min | -2 round-trips |
| P2 | Replace raw `pgExecute()` with `updateTask()` | 15 min | Consistency + -1 round-trip |
| P2 | Create `getPlanWithPhases()` repo function | 30 min | -2 round-trips |
| P3 | Add composite index on `tasks(phase_id, status, created_at)` | 10 min | Faster `getReadyTasks()` |
