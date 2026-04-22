# Phase 01: State Transition Matrices

**Gathered:** 2025-04-22
**Status:** Complete

---

## 1. TaskStatus State Machine

**Type definition** (`types.ts:57-68`):
```
"queued" | "assigned" | "running" | "review" | "revision" | "waiting_approval" | "blocked" | "deferred" | "cancelled" | "done" | "failed"
```

### Transition Table

| # | From | To | Trigger Function | File:Line | Event Emitted | Side Effects |
|---|------|----|-------------------|-----------|---------------|-------------|
| 1 | `queued` | `assigned` | `TaskEngine.assignTask()` | task-engine.ts:121 | `task:assigned` | DB: updateTask(status, assignedAgent, assignedAgentId) |
| 2 | `queued` | `running` | `TaskEngine.startTask()` | task-engine.ts:219 | `task:started` | DB: updateTask(status, startedAt); auto-classify risk |
| 3 | `assigned` | `running` | `TaskEngine.startTask()` | task-engine.ts:217 | `task:started` | DB: updateTask(status, startedAt); auto-classify risk |
| 4 | `queued`/`assigned` | `waiting_approval` | `TaskEngine.startTask()` (policy/budget) | task-engine.ts:278,308 | `task:approval_required` | DB: updateTask(status, requiresApproval, approvalStatus) |
| 5 | `queued`/`assigned` | `failed` | `TaskEngine.startTask()` (policy block) | task-engine.ts:248 | `task:failed` | DB: updateTask(status, error) |
| 6 | `waiting_approval` | `queued` | `TaskEngine.approveTask()` | task-engine.ts:378 | `task:approved` | DB: updateTask(status, approvalStatus="approved") |
| 7 | `waiting_approval` | `failed` | `TaskEngine.rejectTask()` | task-engine.ts:410 | `task:rejected` | DB: updateTask(status, approvalStatus="rejected", error) |
| 8 | `waiting_approval` | `failed` | `TaskEngine.checkApprovalTimeouts()` | task-engine.ts:1261 | `task:failed` | DB: updateTask(status, error) |
| 9 | `running`/`revision` | `review` | `TaskEngine.completeTask()` (has reviewer) | task-engine.ts:483 | `task:completed` (reviewRequired=true) | DB: updateTask; creates review sub-task |
| 10 | `running`/`revision` | `done` | `TaskEngine.markTaskDone()` (no reviewer) | task-engine.ts:539 | `task:completed` | DB: updateTask(status, completedAt); hooks; sub-task rollup; phase advance |
| 11 | `review` | `done` | `TaskEngine.submitReview()` (approved) | task-engine.ts:664 | `task:completed` | DB: updateTask(status, reviewStatus, completedAt); phase advance |
| 12 | `review` | `revision` | `TaskEngine.submitReview()` (rejected, count<3) | task-engine.ts:698 | `task:review_rejected` | DB: updateTask(status, reviewStatus, revisionCount, error) |
| 13 | `review` | `failed` | `TaskEngine.escalateTask()` (count>=3) | task-engine.ts:728 | `escalation:user` | DB: updateTask(status, assignedAgent=tech-lead); create bug work-item |
| 14 | `revision` | `queued` | `TaskEngine.restartRevision()` | task-engine.ts:784 | `task:retry` | DB: updateTask(status, startedAt=null, reviewStatus=null) |
| 15 | `running` | `failed` | `TaskEngine.failTask()` (no edges) | task-engine.ts:904 | `task:failed` + `execution:error` | DB: updateTask; create defect; updatePhaseStatus(failed); updateProject(failed) |
| 16 | `running` | `queued` | `TaskEngine.failTask()` (fallback edge) | task-engine.ts:875 | (via notifyCompleted) | DB: updateTask(assignedAgentId=fallback, retryCount+1) |
| 17 | `running` | `queued` | `TaskEngine.failTask()` (escalation edge) | task-engine.ts:891 | (via notifyCompleted) | DB: updateTask(assignedAgent=escalation) |
| 18 | `failed` | `queued` | `TaskEngine.retryTask()` | task-engine.ts:943 | `task:retry` | DB: updateTask(retryCount+1, error=null); updatePhaseStatus(running) |
| 19 | `running` | `blocked` | `ExecutionEngine._executeTaskInner()` (protocol blockers) | execution-engine.ts:636 | `agent:requested_help` | DB: updateTask(status) |
| 20 | `blocked` | `queued` | Agentic routes (blocker resolved) | agentic-routes.ts:253 | (none) | DB: updateTask(status) |
| 21 | `running`/`assigned` | `queued` | `ExecutionEngine.cancelRunningTasks()` (pipeline pause) | execution-engine.ts:413 | (none) | DB: direct SQL UPDATE; abort processes |
| 22 | `running`/`assigned` | `queued` | `ExecutionEngine.recoverStuckTasks()` | execution-engine.ts:291 | (none) | DB: updateTask(status, startedAt=null); releaseTaskClaim |
| 23 | `running` | `queued` | `ExecutionEngine._executeTaskInner()` (providers exhausted) | execution-engine.ts:831 | `pipeline:degraded` | DB: updateTask(status); setTimeout retry |
| 24 | `running` | `queued` | `ExecutionEngine._executeTaskInner()` (rate limited) | execution-engine.ts:1049 | `pipeline:rate_limited` | DB: updateTask; pipelineEngine.pausePipeline() |
| 25 | `failed` | `queued` | `PipelineEngine.retryFailedPipeline()` | pipeline-engine.ts:969 | (indirect) | DB: updateTask(retryCount=0, error=null) |

### Key Observations

- **`deferred`** and **`cancelled`** are defined in TaskStatus but **never written** by any code path — dead states.
- **`assigned`** is optional — `startTask()` accepts both "queued" and "assigned".
- **Lifecycle bypass**: `failTask()`, `retryTask()`, and `beginExecution()` write to `projects.status` directly, bypassing `transitionProject()` validator.
- **Approval timeout**: `checkApprovalTimeouts()` can auto-fail `waiting_approval` tasks, but must be called externally (no automatic trigger).

---

## 2. PipelineStatus State Machine

**Type definition** (`types.ts:393`):
```
"idle" | "running" | "paused" | "completed" | "failed"
```

| # | From | To | Trigger Function | File:Line | Event Emitted | Side Effects |
|---|------|----|-------------------|-----------|---------------|-------------|
| 1 | `idle` | `running` | `PipelineEngine.startPipeline()` | pipeline-engine.ts:447 | `pipeline:stage_started` | DB: createPipelineRun + updatePipelineRun; create git branch |
| 2 | `running` | `paused` | `PipelineEngine.pausePipeline()` | pipeline-engine.ts:901 | `pipeline:paused` | DB: mutatePipelineState; cancelRunningTasks |
| 3 | `paused` | `running` | `PipelineEngine.resumePipeline()` | pipeline-engine.ts:923 | `pipeline:resumed` | DB: mutatePipelineState; startProjectExecution |
| 4 | `running` | `completed` | `PipelineEngine.markCompleted()` | pipeline-engine.ts:647 | `pipeline:completed` | DB: mutatePipelineState; generateReadme; auto PR; transitionProject("completed") |
| 5 | `running` | `failed` | `PipelineEngine.markFailed()` | pipeline-engine.ts:728 | `pipeline:failed` | DB: mutatePipelineState |
| 6 | `failed` | `running` | `PipelineEngine.retryFailedPipeline()` | pipeline-engine.ts:953 | `pipeline:resumed` | DB: mutatePipelineState; reset failed tasks |
| 7 | `idle`/`failed` | `running` | `PipelineEngine.startPipeline()` (auto-start hook) | pipeline-engine.ts:1079 | `pipeline:stage_started` | DB: startPipeline + advanceStage |

---

## 3. PipelineStageStatus State Machine

**Type definition** (`types.ts:390`):
```
"pending" | "running" | "completed" | "failed"
```

| # | From | To | Trigger Function | File:Line | Event Emitted | Side Effects |
|---|------|----|-------------------|-----------|---------------|-------------|
| 1 | `pending` | `running` | `PipelineEngine.startStage()` | pipeline-engine.ts:483 | `pipeline:stage_started` | DB: mutatePipelineState; git branch |
| 2 | `running` | `completed` | `PipelineEngine.completeStage()` | pipeline-engine.ts:562 | `pipeline:stage_completed` | DB: mutatePipelineState; merge branch; evaluateReplan |
| 3 | `running` | `failed` | `PipelineEngine.markFailed()` | pipeline-engine.ts:733 | `pipeline:failed` | DB: mutatePipelineState |
| 4 | `failed` | `running` | `PipelineEngine.retryFailedPipeline()` | pipeline-engine.ts:953 | (via resumed) | DB: mutatePipelineState |

---

## 4. PhaseStatus State Machine

**Type definition** (`types.ts:43`):
```
"pending" | "running" | "completed" | "failed"
```

| # | From | To | Trigger Function | File:Line | Event Emitted | Side Effects |
|---|------|----|-------------------|-----------|---------------|-------------|
| 1 | `pending` | `running` | `TaskEngine.startPhase()` | task-engine.ts:1017 | `phase:started` | DB: updatePhaseStatus |
| 2 | `running` | `completed` | `TaskEngine.checkAndAdvancePhase()` | task-engine.ts:1058 | `phase:completed` | DB: updatePhaseStatus; start next phase or mark project completed |
| 3 | `running` | `failed` | `TaskEngine.failTask()` | task-engine.ts:931 | (via task:failed) | DB: updatePhaseStatus; updateProject(failed) |
| 4 | `failed` | `running` | `TaskEngine.retryTask()` | task-engine.ts:964 | (none for phase) | DB: updatePhaseStatus; updateProject(running) |

---

## 5. AgentProcessStatus State Machine

**Type definition** (`types.ts:431`):
```
"idle" | "starting" | "running" | "stopping" | "stopped" | "error"
```

| # | From | To | Trigger Function | File:Line | Event Emitted | Side Effects |
|---|------|----|-------------------|-----------|---------------|-------------|
| 1 | (new) | `starting` | `startAgent()` | agent-runtime.ts:152 | (none) | In-memory: processes.set; DB: _createRunInDb |
| 2 | `starting` | `running` | `startAgent()` (spawned) | agent-runtime.ts:182 | `agent:started` | In-memory: record.process, record.pid |
| 3 | `starting` | `idle` | `startAgent()` (cliTool="none") | agent-runtime.ts:163 | (none) | No child process spawned |
| 4 | `running` | `stopped` | child exit (code=0, not stopping) | agent-runtime.ts:224 | `agent:stopped` | DB: _syncRunToDb |
| 5 | `running` | `error` | child exit (code!=0, not stopping) | agent-runtime.ts:224 | `agent:stopped` | DB: _syncRunToDb |
| 6 | `starting` | `error` | child spawn error | agent-runtime.ts:242 | `agent:error` | DB: _syncRunToDb |
| 7 | `running`/`starting` | `stopping` | `stopAgent()` | agent-runtime.ts:279 | (none) | SIGTERM; 5s SIGKILL timer |
| 8 | `stopping` | `stopped` | child exit | agent-runtime.ts:226 | `agent:stopped` | DB: _syncRunToDb; SIGKILL timer cleared |
| 9 | `idle`/`error`/`stopped` | `running` | `ensureVirtualProcess()` | agent-runtime.ts:514 | (none) | In-memory status update |
| 10 | `running` | `stopped` | `markVirtualStopped()` | agent-runtime.ts:551 | (none) | In-memory status update |

---

## 6. ProjectStatus State Machine

**Type definition** (`types.ts:7-15`):
```
"planning" | "approved" | "running" | "paused" | "completed" | "failed" | "maintenance" | "archived"
```

**VALID_TRANSITIONS** (from lifecycle-manager.ts:17-26):

| From | Valid Tos |
|------|-----------|
| `planning` | `approved`, `archived` |
| `approved` | `running`, `planning` |
| `running` | `paused`, `completed`, `failed` |
| `paused` | `running`, `failed` |
| `completed` | `maintenance`, `archived` |
| `failed` | `planning`, `archived` |
| `maintenance` | `planning`, `archived` |

**Actual transitions observed in code** (includes lifecycle bypass):

| # | From | To | Trigger Function | Event Emitted | Notes |
|---|------|----|-------------------|---------------|-------|
| 1 | `planning` | `approved` | `transitionProject()` | `lifecycle:transition` | Validates against VALID_TRANSITIONS |
| 2 | `planning` | `archived` | `transitionProject()` | `lifecycle:transition` | |
| 3 | `approved` | `running` | `transitionProject()` / `taskEngine.beginExecution()` | `lifecycle:transition` | beginExecution bypasses validator |
| 4 | `approved` | `planning` | `transitionProject()` | `lifecycle:transition` | |
| 5 | `running` | `paused` | `transitionProject()` / `pipelineEngine.pausePipeline()` | `lifecycle:transition` | |
| 6 | `running` | `completed` | `transitionProject()` / `taskEngine.checkAndAdvancePhase()` | `lifecycle:transition` | |
| 7 | `running` | `failed` | `taskEngine.failTask()` (direct DB write) | `task:failed` | **Bypasses lifecycle validator** |
| 8 | `paused` | `running` | `transitionProject()` / `pipelineEngine.resumePipeline()` | `lifecycle:transition` | |
| 9 | `paused` | `failed` | `transitionProject()` | `lifecycle:transition` | |
| 10 | `completed` | `maintenance` | `transitionProject()` / `triggerHotfix()` | `lifecycle:transition` | triggerHotfix also creates hotfix task |
| 11 | `completed` | `archived` | `transitionProject()` | `lifecycle:transition` | |
| 12 | `failed` | `planning` | `transitionProject()` | `lifecycle:transition` | |
| 13 | `failed` | `archived` | `transitionProject()` | `lifecycle:transition` | |
| 14 | `maintenance` | `archived` | `transitionProject()` | `lifecycle:transition` | |
| 15 | `maintenance` | `planning` | `transitionProject()` | `lifecycle:transition` | |
| 16 | `failed` | `running` | `taskEngine.retryTask()` (direct DB write) | (none for project) | **Bypasses lifecycle validator** |
| 17 | `running` | `failed` | `executionEngine.executeSpecialTask()` (direct DB write) | `agent:error` | **Bypasses lifecycle validator** |

### Critical Bug: Lifecycle Validator Bypass

`TaskEngine.failTask()`, `TaskEngine.retryTask()`, `TaskEngine.beginExecution()`, and `ExecutionEngine.executeSpecialTask()` all call `updateProject()` directly, bypassing the `VALID_TRANSITIONS` table in `lifecycle-manager.ts`. This means the formal state machine is not the single source of truth — direct DB writes can create transitions that the validator would reject. This must be preserved (or fixed) during kernel extraction.

---

*Phase: 01-prep-inventory*
*Inventory gathered: 2025-04-22*