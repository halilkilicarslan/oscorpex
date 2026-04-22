# Phase 01: Event Type Inventory

**Gathered:** 2025-04-22
**Status:** Complete

---

## Current Schema vs. Target (BaseEvent)

| Field | Current `StudioEvent` | Target `BaseEvent` | Gap |
|-------|----------------------|-------------------|-----|
| `id` | ✓ `string` | ✓ `string` | — |
| `projectId` | ✓ `string` | ✓ `string` | — |
| `type` | ✓ `EventType` | ✓ `string` | — |
| `agentId` | ✓ `string?` | ✓ (in `taskId`) | Rename to consistent field |
| `taskId` | ✓ `string?` | ✓ `string?` | — |
| `payload` | ✓ `Record<string, unknown>` | ✓ (typed per event) | Needs per-event typing |
| `timestamp` | ✓ `string` | ✓ `string` | — |
| `correlationId` | ✗ **MISSING** | ✓ `string` | **Required for traceability** |
| `causationId` | ✗ **MISSING** | ✓ `string?` | **Required for causal chains** |
| `stageId` | ✗ **MISSING** | ✓ `string?` | Required for pipeline stage tracking |
| `provider` | ✗ **MISSING** | ✓ `string?` | Required for provider traceability |

---

## Event Catalogue by Domain

### `task:*` Events (14 types)

| Event Type | Producer File:Line | Payload Shape | DB Persisted | Consumer(s) |
|------------|--------------------|--------------|-------------|-------------|
| `task:assigned` | task-engine.ts:134 | `{ title }` | ✓ | webhook-sender, plugin bridge, ws-manager, context-session |
| `task:started` | task-engine.ts:360 | `{ title }` | ✓ | webhook-sender, plugin bridge, ws-manager, context-session |
| `task:completed` | task-engine.ts:483,548,607,671 | `{ title, filesCreated?, filesModified?, testResults?, reviewRequired?, reviewerAgentId?, autoCompleted? }` | ✓ | webhook-sender, graph-coordinator, plugin bridge, ws-manager, context-session |
| `task:failed` | task-engine.ts:248,313,906,1265 | `{ title, error, policyBlocked?, budgetExceeded?, approvalTimeout? }` | ✓ | webhook-sender, graph-coordinator, plugin bridge, ws-manager, context-session |
| `task:retry` | task-engine.ts:798,957 | `{ title, isRevision?, revisionCount?, retryCount? }` | ✓ | webhook-sender, plugin bridge |
| `task:approval_required` | task-engine.ts:284 | `{ title, taskTitle, agentName, complexity, description }` | ✓ | webhook-sender, plugin bridge |
| `task:approved` | task-engine.ts:391 | `{ title, taskTitle, agentName }` | ✓ | webhook-sender, plugin bridge |
| `task:rejected` | task-engine.ts:427 | `{ title, taskTitle, agentName, reason }` | ✓ | webhook-sender, plugin bridge |
| `task:timeout` | execution-engine.ts:1071 | `{ timeoutMs, taskTitle, message }` | ✓ | webhook-sender |
| `task:timeout_warning` | execution-engine.ts:705 | `{ timeoutMs, remainingMs, taskTitle, message }` | ✓ | webhook-sender |
| `task:transient_failure` | execution-engine.ts:1116 | `{ error, retryCount, maxRetries }` | ✓ | webhook-sender |
| `task:review_rejected` | task-engine.ts:705 | `{ title, revisionCount, feedback, reviewerAgentId }` | ✓ | webhook-sender |
| `task:added` | incremental-planner.ts:125 | `{ title, phaseId, complexity }` | ✓ | webhook-sender, plugin bridge |
| `task:proposal_created` | agent-runtime/task-injection.ts:203 | `{ proposalId, title, riskLevel, reason, requiresApproval }` | ✓ | plugin bridge |
| `task:proposal_approved` | agent-runtime/task-injection.ts:185 | `{ proposalId, title, riskLevel, autoApproved, reason }` | ✓ | plugin bridge |

### `agent:*` Events (7 types)

| Event Type | Producer File:Line | Payload Shape | DB Persisted | Consumer(s) |
|------------|--------------------|--------------|-------------|-------------|
| `agent:started` | agent-runtime.ts:257 | `{ pid, cliTool, cwd }` | ✓ | webhook-sender, plugin bridge |
| `agent:stopped` | agent-runtime.ts:232 | `{ exitCode, signal }` | ✓ | webhook-sender, plugin bridge |
| `agent:error` | agent-runtime.ts:246, execution-engine.ts:1084,1218 | `{ error }` | ✓ | webhook-sender, plugin bridge |
| `agent:session_started` | agent-runtime/agent-session.ts:81 | `{ sessionId, strategy }` | ✓ | plugin bridge |
| `agent:strategy_selected` | agent-runtime/agent-session.ts:88 | `{ strategy, confidence, reason }` | ✓ | plugin bridge |
| `agent:requested_help` | agent-runtime/agent-protocol.ts:63, execution-engine.ts:638 | `{ description, messageType, toAgentId }` or `{ title, taskTitle, agentName, reason, protocolBlocked }` | ✓ | plugin bridge |
| `agent:output` | *(transient)* — 13 source locations | `{ output }` (max 2000 chars) | ✗ **NOT persisted** | ws-manager (via pg-listener skip), SSE streams |

### `pipeline:*` Events (10 types)

| Event Type | Producer File:Line | Payload Shape | DB Persisted | Consumer(s) |
|------------|--------------------|--------------|-------------|-------------|
| `pipeline:stage_started` | pipeline-engine.ts:506 | `{ stageIndex, stageOrder, agentCount, taskCount }` | ✓ | webhook-sender, plugin bridge, context-session |
| `pipeline:stage_completed` | pipeline-engine.ts:578 | `{ stageIndex, stageOrder }` | ✓ | webhook-sender, plugin bridge |
| `pipeline:branch_created` | pipeline-engine.ts:547 | `{ branch, stageIndex }` | ✓ | webhook-sender |
| `pipeline:branch_merged` | pipeline-engine.ts:632 | `{ branch, target, stageIndex }` | ✓ | webhook-sender |
| `pipeline:completed` | pipeline-engine.ts:657 | `{ completedAt }` | ✓ | webhook-sender, graph-coordinator, plugin bridge, context-session |
| `pipeline:failed` | pipeline-engine.ts:744 | `{ reason, failedAt }` | ✓ | webhook-sender, plugin bridge, context-session |
| `pipeline:paused` | pipeline-engine.ts:909 | `{ pausedAt, currentStage, cancelledTasks }` | ✓ | webhook-sender, plugin bridge |
| `pipeline:resumed` | pipeline-engine.ts:927,973 | `{ resumedAt, currentStage, reason? }` | ✓ | webhook-sender, plugin bridge |
| `pipeline:degraded` | execution-engine.ts:832 | `{ message, retryMs }` | ✓ | webhook-sender, plugin bridge |
| `pipeline:rate_limited` | execution-engine.ts:1051 | `{ message, taskTitle }` | ✓ | plugin bridge |

### `phase:*` Events (2 types)

| Event Type | Producer File:Line | Payload Shape | DB Persisted | Consumer(s) |
|------------|--------------------|--------------|-------------|-------------|
| `phase:started` | task-engine.ts:1019 | `{ phaseId }` | ✓ | webhook-sender, plugin bridge, context-session |
| `phase:completed` | task-engine.ts:1060 | `{ phaseId }` | ✓ | webhook-sender, plugin bridge, context-session |

### `plan:*` Events (4 types)

| Event Type | Producer File:Line | Payload Shape | DB Persisted | Consumer(s) |
|------------|--------------------|--------------|-------------|-------------|
| `plan:created` | pm-agent.ts:525 | `{ planId, version, phaseCount }` | ✓ | webhook-sender, plugin bridge |
| `plan:approved` | routes/project-routes.ts:1018 | `{ planId }` | ✓ | webhook-sender, plugin bridge |
| `plan:phase_added` | incremental-planner.ts:70 | `{ planId, phaseId, name, order }` | ✓ | plugin bridge |
| `plan:replanned` | incremental-planner.ts:171, adaptive-replanner.ts:426,464 | `{ reason, cancelledCount?, keptCompletedCount?, trigger?, patchCount?, autoApplied?, pendingApproval?, replanEventId?, approvedBy? }` | ✓ | plugin bridge |

### `budget:*` Events (2 types, 3 in type definition)

| Event Type | Producer File:Line | Payload Shape | DB Persisted | Consumer(s) |
|------------|--------------------|--------------|-------------|-------------|
| `budget:warning` | *(not emitted in current code — handled by task-engine.ts:342 via `escalation:user`)* | — | — | — |
| `budget:exceeded` | *(not directly emitted — budget-guard emits `budget:halted`)* | — | — | — |
| `budget:halted` | budget-guard.ts:80 | `{ totalSpentUsd, budgetMaxUsd, message }` | ✓ | plugin bridge |

### `execution:*` Events (2 types)

| Event Type | Producer File:Line | Payload Shape | DB Persisted | Consumer(s) |
|------------|--------------------|--------------|-------------|-------------|
| `execution:started` | execution-engine.ts:465 | `{ readyTaskCount }` | ✓ | webhook-sender, plugin bridge |
| `execution:error` | task-engine.ts:933 | `{ title, error, phaseId }` | ✓ | plugin bridge |

### `lifecycle:*` Events (1 type)

| Event Type | Producer File:Line | Payload Shape | DB Persisted | Consumer(s) |
|------------|--------------------|--------------|-------------|-------------|
| `lifecycle:transition` | lifecycle-manager.ts:58,129 | `{ from, to, projectName, transitionedAt?, reason?, hotfixTaskId? }` | ✓ | plugin bridge |

### `policy:*` Events (1 type)

| Event Type | Producer File:Line | Payload Shape | DB Persisted | Consumer(s) |
|------------|--------------------|--------------|-------------|-------------|
| `policy:violation` | policy-engine.ts:185 | `{ taskTitle, violations, blocked, evaluatedAt }` | ✓ | plugin bridge |

### `goal:*` Events (1 type)

| Event Type | Producer File:Line | Payload Shape | DB Persisted | Consumer(s) |
|------------|--------------------|--------------|-------------|-------------|
| `goal:evaluated` | goal-engine.ts:174 | `{ goalId, status, metCount, totalCount }` | ✓ | plugin bridge |

### `verification:*` Events (2 types)

| Event Type | Producer File:Line | Payload Shape | DB Persisted | Consumer(s) |
|------------|--------------------|--------------|-------------|-------------|
| `verification:passed` | output-verifier.ts:178 | `{ allPassed, checks, failed[] }` | ✓ | plugin bridge |
| `verification:failed` | output-verifier.ts:178, execution-engine.ts:1025 | `{ source, violationType, detail, enforcementMode, taskTitle }` or `{ allPassed, checks, failed[] }` | ✓ | plugin bridge |

### `graph:*` Events (2 types)

| Event Type | Producer File:Line | Payload Shape | DB Persisted | Consumer(s) |
|------------|--------------------|--------------|-------------|-------------|
| `graph:mutation_proposed` | graph-coordinator.ts:472 | `{ mutationId, mutationType, status }` | ✓ | plugin bridge |
| `graph:mutation_applied` | graph-coordinator.ts:297,335,411,445,532 | `{ mutationType, taskId?, title?, ...detail }` | ✓ | plugin bridge |

### `ceremony:*` Events (2 types)

| Event Type | Producer File:Line | Payload Shape | DB Persisted | Consumer(s) |
|------------|--------------------|--------------|-------------|-------------|
| `ceremony:standup` | ceremony-engine.ts:102 | `{ agentCount, generatedAt }` | ✓ | plugin bridge |
| `ceremony:retrospective` | ceremony-engine.ts:208 | `{ agentCount, completionRate, actionItemCount, generatedAt }` | ✓ | plugin bridge |

### `git:*` Events (1 type, 2 in definition)

| Event Type | Producer File:Line | Payload Shape | DB Persisted | Consumer(s) |
|------------|--------------------|--------------|-------------|-------------|
| `git:commit` | *(not emitted in current code)* | — | — | — |
| `git:pr-created` | pipeline-engine.ts:721 | `{ prNumber, prUrl, branch }` | ✓ | webhook-sender, plugin bridge |

### `message:*` Events (1 type)

| Event Type | Producer File:Line | Payload Shape | DB Persisted | Consumer(s) |
|------------|--------------------|--------------|-------------|-------------|
| `message:created` | agent-messaging.ts:100 | `{ messageId, from }` | ✓ | plugin bridge |

### `escalation:*` Events (1 type, multiple emitters)

| Event Type | Producer File:Line | Payload Shape | DB Persisted | Consumer(s) |
|------------|--------------------|--------------|-------------|-------------|
| `escalation:user` | routes/project-routes.ts:844,973, pm-agent.ts:613, task-engine.ts:326,342,743 | Various: `{ questions[] }` or `{ answered }` or `{ question, options }` or `{ budgetExceeded?, budgetWarning? }` or `{ title, reason, escalatedTo, feedback, revisionCount }` | ✓ | webhook-sender, plugin bridge |

### Transient-Only Events (not persisted to events table)

| Event Type | Producer Sources | Purpose |
|------------|-----------------|---------|
| `agent:output` | 13 source locations (agent-runtime, execution-engine, execution-gates, cli-runtime, container-manager, runtime-routes) | Real-time console output broadcast — not stored, only forwarded via WebSocket/SSE |
| `prompt:size` | prompt-budget.ts:86, context-packet.ts:405 | Telemetry — token budget monitoring |
| `provider:degraded` | provider-state.ts:49 | Provider availability alert — not persisted |

### Missing from EventType but Emitted

No events are currently emitted that are not in the `EventType` union — all emit calls use valid types.

### EventType Values with No Emitter (defined but unused)

| Event Type | Definition Source | Notes |
|------------|-----------------|-------|
| `git:commit` | types.ts | No emit call found; may be planned for future git integration |
| `budget:warning` | types.ts | Budget warnings are routed through `escalation:user` instead |
| `budget:exceeded` | types.ts | Replaced by `budget:halted` in actual implementation |
| `work_item:created` | types.ts | Work item creation likely happens via direct DB writes |
| `work_item:planned` | types.ts | Same as above |
| `sprint:started` | types.ts | Sprint lifecycle likely via direct DB writes |
| `sprint:completed` | types.ts | Same |
| `provider:degraded` | types.ts | Emitted as transient (via emitTransient), IS in the union — **actually used** |

---

## Subscription Summary

### Dedicated Handlers (type-specific)

| File:Line | Event Type | Handler |
|-----------|-----------|---------|
| routes/index.ts:78 | `task:completed` | Sends webhook `task_completed` |
| routes/index.ts:88 | `task:failed` | Sends webhook `execution_error` |
| routes/index.ts:99 | `pipeline:completed` | Sends webhook `pipeline_completed` |
| routes/index.ts:105 | `budget:warning` | Sends webhook `budget_warning` |
| graph-coordinator.ts:135 | `task:completed` | Auto-completes/fails split-parent |
| graph-coordinator.ts:136 | `task:failed` | Same propagation logic |

### Bulk Handlers (many event types)

| File | Event Count | Handler |
|------|------------|---------|
| webhook-sender.ts:245 | 26 types | Maps to webhook event strings; dispatches to active webhooks |
| routes/index.ts:175 | 52 types | Plugin registry + legacy hook bridge (task:completed, pipeline:completed, work_item:created, phase:completed) |
| routes/index.ts:221 | 3 types | Notification creation (task:completed, task:failed, pipeline:completed) |
| context-session.ts:116 | 10 types | AI context session tracking |

### Project-Scoped Handlers (SSE + WebSocket)

| File:Line | Handler |
|-----------|---------|
| routes/project-routes.ts:1264 | SSE stream: forwards all events to connected clients |
| routes/task-routes.ts:261 | SSE stream: filtered to specific task's agent output |
| ws-manager.ts:288 | WebSocket bridge: broadcasts events to subscribed WS clients |

---

*Phase: 01-prep-inventory*
*Inventory gathered: 2025-04-22*