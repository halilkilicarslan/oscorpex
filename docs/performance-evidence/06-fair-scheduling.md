# Fair Scheduling & Starvation Prevention (TASK 4)

**Module**: `apps/kernel/src/studio/task-scheduler.ts`
**Consumers**: `ExecutionEngine.dispatchReadyTasks()` → `sortTasksByFairness()`

---

## Scheduling Rule (Single Point of Truth)

```typescript
// task-scheduler.ts::sortTasksByFairness()
export function sortTasksByFairness(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    // 1. Category priority: short (1) < medium (2) < long (3)
    const catA = CATEGORY_PRIORITY[getTaskCategory(a.complexity)];
    const catB = CATEGORY_PRIORITY[getTaskCategory(b.complexity)];
    if (catA !== catB) return catA - catB;

    // 2. Lower retry count first
    const retryA = a.retryCount ?? 0;
    const retryB = b.retryCount ?? 0;
    if (retryA !== retryB) return retryA - retryB;

    // 3. Older tasks first (FIFO tiebreaker)
    const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return createdA - createdB;
  });
}
```

---

## Complexity → Category Mapping

| Complexity | Category | Priority | Rationale |
|------------|----------|----------|-----------|
| S | short | 1 | Quick tasks should not wait behind slow ones |
| M | medium | 2 | Moderate duration, scheduled after short |
| L | long | 3 | Long tasks can tolerate more queue wait |
| XL | long | 3 | Same as L — both are long-running |

---

## Why Short Tasks Are Never Starved

**Problem**: In a naive FIFO queue, if 5 XL tasks are queued first, a new S task must wait for all 5 XL tasks to complete.

**Solution**: `sortTasksByFairness` reorders the dispatch list **every time** `dispatchReadyTasks()` runs. Short tasks always bubble to the front, regardless of arrival order.

**Example**:
```
Arrival order: [XL-1, XL-2, XL-3, S-1, M-1, S-2]
Dispatch order: [S-1, S-2, M-1, XL-1, XL-2, XL-3]
```

**Tie-breakers** ensure fairness within the same category:
1. Fresh tasks (retryCount = 0) before retried tasks
2. Older tasks before newer tasks (FIFO)

---

## Lane-Based Grouping

`groupTasksByLane()` visualizes the dispatch order:

```
Lane "short":   [S-1, S-2]
Lane "medium":  [M-1]
Lane "long":    [XL-1, XL-2, XL-3]
```

This is used for:
- Telemetry (how many tasks per lane)
- UI display (Kanban-style lanes)
- Queue depth metrics per category

---

## Integration Point

```typescript
// execution-engine.ts::dispatchReadyTasks()
const fairOrder = sortTasksByFairness(toDispatch);
for (const task of fairOrder) {
  await this.executeTask(projectId, task);
}
```

The fair sort happens **after** dependency resolution (only ready tasks are considered) and **before** the adaptive concurrency semaphore is acquired. This means:
1. Only tasks with all dependencies met enter the fairness sort
2. The sort order determines which task claims the semaphore first
3. Short tasks acquire the semaphore before long tasks

---

## Starvation Guarantee

**Theorem**: In a steady-state system with mixed task arrivals, no short task will wait longer than `(N_long × T_long) + T_short` where `N_long` is the number of currently running long tasks and `T_long` is their average duration.

**Proof sketch**:
- `sortTasksByFairness` is called on every dispatch cycle
- Short tasks always sort before long tasks
- The semaphore may be held by a long task, but as soon as it releases, the next short task (if any) acquires it
- Long tasks never preempt short tasks (no preemption in our model), but they also never block future short tasks from being first in line

In practice, with adaptive concurrency (1-10 slots), short tasks rarely wait for more than one long task to complete.
