# Oscorpex — Implementation Truth Audit

**Date**: 2026-04-21
**Auditor**: Principal Engineer / Systems Architect (AI-assisted deep audit)
**Scope**: Full codebase inspection — execution paths, agentic claims, safety enforcement, persistence, orchestration
**Method**: 5 parallel deep-investigation agents reading ~50 source files end-to-end, cross-referenced against 3 planning documents

> **ERRATA (2026-04-21)**: Two findings corrected post-audit:
> 1. **Policy engine**: Originally classified as "COSMETIC". Corrected to **ENFORCED** — `evaluatePolicies()` is called at `task-engine.ts:219` and blocks tasks with `allowed: false`.
> 2. **Context-mode native implementation**: Originally only `context-packet.ts` was inspected and declared "dead code". Post-audit investigation revealed **6 additional context-mode modules** (`context-store.ts`, `context-sandbox.ts`, `context-session.ts`, `context-builder.ts`, `vector-store.ts`, `document-indexer.ts`) that ARE wired into `execution-engine.ts` (lines 16-18, 1077, 1093, 1106) and `task-engine.ts:547`. The native context-mode implementation is **ACTIVE and FUNCTIONAL**. Only `context-packet.ts` (token-budgeted assembly) remains unwired.

---

# 1. Executive Truth Summary

Oscorpex is a **DAG-orchestrated software development platform with genuine but shallow agentic capabilities**. The core orchestration layer (pipeline engine, task engine, execution engine) is **production-quality engineering** — DB-authoritative state, distributed task claiming via `SELECT FOR UPDATE SKIP LOCKED`, real CLI subprocess execution via Claude Code, proper review loops with escalation, and a working DAG parallelism engine.

The v7.0 "agentic" layer is **half-real, half-theater**:
- **Memory, strategy, sessions, and protocol** are wired into the execution path and materially change agent prompts
- **Constraints, task injection, cross-project learning, and context-packet** are either cosmetic or dead code
- **Safety gates** are selectively enforced: approval gates and budget guard are real blockers; sandbox and policy engine are cosmetic

The system's **single biggest strength** is its execution backbone: task claiming, CLI execution with provider fallback, review loops, and DAG orchestration. Its **single biggest illusion** is that governance, sandboxing, and runtime constraints are enforced — they are not.

**Bottom line**: This is a **semi-agentic DAG orchestrator** with a genuine behavioral learning loop (memory → strategy → execution → episode recording → future strategy improvement). It is NOT a fully autonomous multi-agent platform. Agents do not self-assign work, negotiate with each other, inject tasks during execution, or operate under enforced governance constraints.

---

# 2. What This System Actually Is

**Classification**: Semi-Agentic DAG-Orchestrated Development Studio with Behavioral Learning

More precisely:
- **Core**: A DAG workflow engine that dispatches coding tasks to AI CLI tools (Claude Code) with phase-based parallelism
- **Planning**: LLM-driven (PM agent generates phased plans via AI SDK tools)
- **Execution**: CLI subprocess spawning with complexity-based model routing and provider fallback
- **Agentic layer**: Behavioral memory and strategy selection that influence prompt construction (but not execution control)
- **Safety layer**: Selective enforcement (approvals block, sandbox doesn't)
- **Learning**: Closed feedback loop for strategy optimization (episodes → patterns → strategy selection → prompt injection)

**What it is NOT**:
- Not a true multi-agent system (agents don't communicate bidirectionally during execution)
- Not a self-organizing system (execution order is predetermined by DAG)
- Not a goal-autonomous system (goals are advisory, not enforced)
- Not a sandboxed system (sandbox tracks but doesn't prevent)

---

# 3. End-to-End Runtime Flow

```
User describes idea via UI
    ↓
POST /api/studio/projects/:id/chat
    ↓
pm-agent.ts → LLM-driven planning via AI SDK tools
    → createProjectPlan() → phases + tasks written to DB
    → Plan marked as "draft" → user approval required
    ↓
User approves plan via UI
    ↓
POST /api/studio/projects/:id/pipeline/start
    ↓
pipeline-engine.ts → startPipeline()
    → buildDAGWaves() [Kahn's algorithm on agent_dependencies]
    → Creates pipeline_run with stages (parallel waves)
    → Starts first stage
    ↓
pipeline-engine.ts → startStage()
    → mutatePipelineState() [SELECT FOR UPDATE + version bump]
    → Marks stage "running"
    → Creates git branch (non-blocking)
    ↓
execution-engine.ts → dispatchReadyTasks()
    → taskEngine.getReadyTasks(phaseId) [queries DB for queued tasks with met dependencies]
    → For each ready task: executeTask()
    ↓
execution-engine.ts → executeTask() [THE CRITICAL PATH]
    ├── claimTask() [SELECT FOR UPDATE SKIP LOCKED — distributed lock]
    ├── shouldDecompose() → decomposeTask() [L/XL only, try/catch]
    ├── Semaphore.acquire() [limits concurrent CLI processes to 3]
    ├── initSession() [try/catch — loads behavioral memory + strategy + protocol messages]
    │   ├── agent-memory.ts → loadBehavioralContext() → failure lessons + strategy recommendations
    │   ├── agent-strategy.ts → selectStrategy() → role-appropriate execution approach
    │   └── agent-protocol.ts → loadProtocolContext() → unread inter-agent messages
    ├── getGoalForTask() → formatGoalPrompt() [try/catch — goal criteria injection]
    ├── startSandboxSession() [try/catch — creates DB record, no enforcement]
    ├── resolveModel() [model-router.ts — complexity + failure escalation]
    ├── getAdapterChain() → adapter.execute() [CLI SUBPROCESS SPAWN]
    │   └── cli-runtime.ts → spawn(CLAUDE_BIN, args) → stream-json parsing → token accounting
    │   └── Provider fallback chain: Claude → Codex → Cursor (only Claude fully implemented)
    ├── verifyTaskOutput() [ENFORCED — hard fail on empty output]
    ├── runTestGate() [ENFORCED — blocks if policy=required and tests fail]
    ├── taskEngine.completeTask() [marks done or creates review task]
    ├── endSandboxSession() [.catch() — records completion]
    ├── evaluateGoal() [try/catch — keyword-based heuristic validation]
    └── completeSession() [.catch() — records episode for future learning]
    ↓
task-engine.ts → completeTask()
    ├── If reviewer exists: task → "review" status → creates review task
    │   └── submitReview() → approved → markTaskDone() | rejected → revision (max 3) → escalation
    ├── If no reviewer: markTaskDone() directly
    └── checkAndAdvancePhase() → if all tasks done → next phase
    ↓
execution-engine.ts → dispatchReadyTasks() [callback on task completion]
    → Dispatches next ready tasks in current + new phases
    ↓
pipeline-engine.ts → advanceStage() / completeStage()
    → mutatePipelineState() → starts next stage or completes pipeline
    → evaluateReplan() [.catch() — phase boundary replanning, rarely triggers]
    ↓
pipeline-engine.ts → markCompleted()
    → Pipeline status "completed"
    → Event: pipeline:completed
```

### Key Files in Critical Path

| Stage | File | Function |
|-------|------|----------|
| Planning | `pm-agent.ts` | LLM tool calls → `createProjectPlan()` |
| DAG Build | `pipeline-engine.ts` | `buildDAGWaves()` (Kahn's algorithm) |
| Stage Mgmt | `pipeline-engine.ts` | `startStage()`, `completeStage()`, `mutatePipelineState()` |
| Dispatch | `execution-engine.ts` | `dispatchReadyTasks()`, `executeTask()` |
| Task Claim | `db/task-repo.ts` | `claimTask()` (SELECT FOR UPDATE SKIP LOCKED) |
| CLI Exec | `cli-runtime.ts` | `spawn(CLAUDE_BIN)` → stream-json parsing |
| Model Route | `model-router.ts` | `resolveModel()` (complexity-based) |
| Task Lifecycle | `task-engine.ts` | `completeTask()`, `failTask()`, `submitReview()` |
| Review Loop | `task-engine.ts` | `findReviewerForTask()` → review task creation |
| Escalation | `task-engine.ts` | `escalateTask()` (after 3 revision cycles) |
| Behavioral | `agent-memory.ts` | `loadBehavioralContext()` → prompt injection |
| Strategy | `agent-strategy.ts` | `selectStrategy()` → `promptAddendum` injection |
| Session | `agent-session.ts` | `initSession()` / `completeSession()` / `failSession()` |
| Safety | `output-verifier.ts` | `verifyTaskOutput()` (hard fail on empty) |
| Safety | `test-gate.ts` | `runTestGate()` (blocks if policy=required) |
| Safety | `budget-guard.ts` | `enforceBudgetGuard()` (pauses pipeline) |

---

# 4. Agentic Capability Audit

## 4.1 Behavioral Memory

- **Code**: `src/studio/agent-memory.ts` — `loadBehavioralContext()`, `formatBehavioralPrompt()`
- **Wired**: YES — Called from `execution-engine.ts:597` via `initSession()`
- **Runtime behavior**: Loads recent episodes + failure lessons + strategy recommendations from `agent_episodes` table. Formatted as prompt sections injected into `promptSuffix`.
- **Centrality**: Every task execution attempts to load behavioral context (try/catch wrapped — non-blocking on failure)
- **Evidence**: Agents receive formatted sections like failure avoidance warnings and strategy recommendations based on historical performance data
- **Verdict**: **REAL BUT LIMITED** — Episodes are recorded and injected. However, memory is coarse-grained (success/failure outcome only), no reasoning traces stored, and validation of whether memory actually improves outcomes is absent.

## 4.2 Strategy Selection

- **Code**: `src/studio/agent-strategy.ts` — `selectStrategy()`
- **Wired**: YES — Called from `initSession()` at execution-engine.ts:597
- **Runtime behavior**: Queries `agent_strategy_patterns` table for strategies with ≥3 samples and ≥60% success rate. Falls back to role default → builtin strategies. Selected strategy's `promptAddendum` injected into prompt.
- **Centrality**: Every task execution attempts strategy selection
- **Evidence**: 9 builtin strategies across 5 roles. Strategy addendum actually changes agent approach (e.g., "Write tests first" vs "Scaffold then refine")
- **Verdict**: **REAL AND ENFORCED** — Data-driven strategy selection with historical pattern influence. The selected strategy materially changes the prompt content agents receive. This is genuine adaptive behavior.

## 4.3 Agent Session Model

- **Code**: `src/studio/agent-session.ts` — `initSession()`, `completeSession()`, `failSession()`
- **Wired**: YES — init at line 597, complete at line 930, fail at line 1007
- **Runtime behavior**: Creates bounded session context. On completion/failure, records episode to `agent_episodes` and updates `agent_strategy_patterns` with aggregated statistics.
- **Centrality**: Full lifecycle coverage — init before execution, complete/fail after
- **Evidence**: `completeSession` and `failSession` both wrapped in `.catch()` — non-blocking but always attempted
- **Verdict**: **REAL AND ENFORCED** — Session lifecycle is complete. Episode recording creates the feedback loop that feeds behavioral memory and strategy selection. This is the backbone of the learning system.

## 4.4 Inter-Agent Protocol

- **Code**: `src/studio/agent-protocol.ts` — `loadProtocolContext()`, `acknowledgeMessages()`
- **Wired**: YES — Called from execution-engine.ts:607
- **Runtime behavior**: Loads unread protocol messages (request_info, blocker_alert, handoff_artifact, design_decision), formats them, injects into prompt. Messages marked as read after injection.
- **Centrality**: Every task execution loads protocol context
- **Evidence**: Defines `BLOCKING_TYPES` (blocker_alert, request_info, dependency_warning) but does NOT actually block execution — just informs the agent via prompt
- **Verdict**: **REAL BUT LIMITED** — Agents receive inter-agent messages in their prompts. However, communication is passive (read-only during execution), not bidirectional. "Blocking" types inform but don't enforce. Agents cannot send messages during execution.

## 4.5 Runtime Task Injection

- **Code**: `src/studio/task-injection.ts` — `proposeTask()`, `autoApproveProposal()`
- **Wired**: PARTIALLY — Called via HTTP API (`agentic-routes.ts`) only, NOT from agents during execution
- **Runtime behavior**: Framework for proposals with auto-approval for low-risk, capability enforcement via `hasCapability()`
- **Centrality**: **Edge-case only** — Agents have no mechanism to call `proposeTask()` during CLI execution. Only manual HTTP API.
- **Evidence**: `checkConstraints()` and `canAutoApprove()` exist but are never called from execution-engine
- **Verdict**: **ARCHITECTURAL ILLUSION** — The framework is complete (proposals, risk classification, auto-approval, capability gates) but agents cannot trigger it during execution. Task injection requires external HTTP calls, which agents don't make. This is infrastructure without activation.

## 4.6 Dynamic Graph Mutation

- **Code**: `src/studio/graph-coordinator.ts` — `insertNode()`, `splitTask()`, `addEdge()`, `removeEdge()`, `deferBranch()`, `mergeIntoPhase()`
- **Wired**: Via API routes only (`graph-routes.ts`). NOT called from execution-engine or pipeline-engine.
- **Runtime behavior**: Mutations modify task graph in DB and record audit trail to `graph_mutations` table. Emit events to eventBus.
- **Centrality**: **Decoupled from execution** — Mutations don't invalidate pipeline cache or modify `pipeline_runs`. Execution engine picks up new tasks on next `dispatchReadyTasks()` cycle.
- **Evidence**: All 6 mutation functions record to DB and emit events but none call `pipelineEngine` methods
- **Verdict**: **REAL BUT LIMITED** — Mutations work and are auditable, but they're asynchronous API operations, not runtime decisions made by agents during execution. The pipeline will eventually see new tasks, but this isn't dynamic runtime coordination — it's manual graph editing via API.

## 4.7 Adaptive Replanning

- **Code**: `src/studio/adaptive-replanner.ts` — `evaluateReplan()`
- **Wired**: YES — Called from `pipeline-engine.ts:583` at phase boundary, `.catch()` wrapped (non-blocking)
- **Runtime behavior**: Checks if replanning should trigger (rate-limited to 1/10min). Generates patches based on failure ratios or injection thresholds. Low-risk patches auto-applied, medium+ queued for approval.
- **Centrality**: **Edge-case only** — Only triggers at phase boundaries. `generatePatches()` has 4 conditions, most requiring specific failure patterns to fire.
- **Evidence**: Can mark tasks as cancelled/deferred, create new tasks. Does NOT modify pipeline stages directly.
- **Verdict**: **PARTIAL / EDGE-CASE ONLY** — Real code that rarely activates. Replanning infrastructure exists but trigger conditions are narrow. In practice, most pipelines complete without ever triggering a replan. When it does trigger, patches are real (task creation/cancellation).

## 4.8 Goal-Driven Execution

- **Code**: `src/studio/goal-engine.ts` — `getGoalForTask()`, `formatGoalPrompt()`, `validateCriteriaFromOutput()`
- **Wired**: YES — Goal injection at execution-engine.ts:616 (try/catch), validation at line 916 (try/catch)
- **Runtime behavior**: Goals with success criteria injected into agent prompts. After execution, `validateCriteriaFromOutput()` checks output against criteria using keyword-matching heuristic (50% threshold).
- **Centrality**: In the execution path but entirely non-blocking
- **Evidence**: Validation is naive keyword matching, NOT LLM-based. Goal failure does NOT fail the task — just records status to DB.
- **Verdict**: **ADVISORY / NON-BLOCKING** — Goals influence prompts (real) but validation is cosmetic (keyword heuristic) and non-enforcing (failure doesn't block). This is observability, not goal-driven execution.

## 4.9 Cross-Project Learning

- **Code**: `src/studio/cross-project-learning.ts` — `extractPatternsFromEpisodes()`, `getLearningPatterns()`, `promoteToGlobal()`
- **Wired**: Via HTTP API only (`graph-routes.ts`). NOT called automatically.
- **Runtime behavior**: Aggregates strategy successes and failure signatures from episodes. Can promote patterns across tenants.
- **Centrality**: **NOT IN EXECUTION PATH** — Extraction never runs automatically. `selectStrategy()` in `agent-strategy.ts` does NOT call `getLearningPatterns()`.
- **Evidence**: No automatic triggers. No integration with strategy selection pipeline.
- **Verdict**: **ARCHITECTURAL ILLUSION** — Infrastructure exists but the extraction pipeline is dormant. Patterns are never auto-extracted, never auto-promoted, and never consumed by the strategy selection system. This is code that could work but doesn't because it's never invoked.

---

# 5. Safety and Governance Audit

## 5.1 Budget Guard — **ENFORCED (Retroactive)**

- **Called from**: `execution-engine.ts:799` after token usage recording
- **Behavior**: `enforceBudgetGuard()` queries total spend from `token_usage`, compares against `project_settings.budget.max_usd`. If exceeded: emits `budget:halted` event + calls `pipelineEngine.pausePipeline()`
- **Blocks execution**: YES — Pipeline paused, no new tasks dispatched
- **Gap**: Retroactive only. Budget checked AFTER cost is incurred. A single expensive task can overshoot budget significantly before pause activates.

## 5.2 Pre-Execution Budget Check — **ENFORCED**

- **Called from**: `task-engine.ts:startTask()` (line ~239)
- **Behavior**: Checks project budget + per-agent limits before task starts
- **Blocks execution**: YES — Task blocked if budget already exceeded
- **Gap**: Only prevents new tasks from starting. Running tasks continue consuming budget.

## 5.3 Output Verification — **ENFORCED (Critical Only)**

- **Called from**: `execution-engine.ts:858`
- **Behavior**: `verifyTaskOutput()` checks: files_exist, files_modified, output_non_empty. Results persisted to `verification_results` table.
- **Blocks execution**: PARTIALLY — `output_non_empty` failure is a **hard fail** (throws, aborts completion). File existence failures are **logged but allow completion**.
- **Gap**: Only the "no output at all" case actually blocks. Missing files that were claimed as created pass through.

## 5.4 Test Gate — **ENFORCED (Policy-Dependent)**

- **Called from**: `execution-engine.ts:885`
- **Behavior**: `runTestGate()` resolves policy per task (required/optional/skip). If `required` and tests fail → throws exception, blocking completion.
- **Blocks execution**: YES when policy=required, NO when policy=optional or skip
- **Gap**: Default policy resolution may default to `optional` for many task types. Only explicitly configured "required" policies actually block.

## 5.5 Sandbox Enforcement — **COSMETIC**

- **Called from**: `execution-engine.ts:635` (startSandboxSession), `execution-engine.ts:911` (endSandboxSession)
- **Behavior**: Creates DB record of sandbox session with policy. `checkToolAllowed()`, `checkPathAllowed()`, `checkOutputSize()` exist but are **never called** from execution-engine.
- **Blocks execution**: NO — Sessions are tracked, check functions available, but nobody invokes the checks during CLI execution
- **Gap**: **Complete enforcement gap**. No OS-level isolation. No tool/path blocking. Policy is application-level metadata that nothing enforces. Agents execute with full filesystem and tool access regardless of sandbox policy.

## 5.6 Approval Gate — **ENFORCED**

- **Called from**: `task-engine.ts:startTask()` (line ~249)
- **Behavior**: Checks `task.requiresApproval` OR project approval rules OR DAG approval edges. If approval needed and not yet granted → task enters `waiting_approval` status → returns early. Task cannot proceed until human calls `approveTask()`.
- **Blocks execution**: YES — Hard gate. Pipeline stalls on unapproved tasks.
- **Triggers**: XL complexity, deployment keywords, DAG "approval" edge type, approval rules table

## 5.7 Policy Engine — **COSMETIC**

- **Code**: `src/studio/policy-engine.ts` — `evaluatePolicies()`
- **Called from**: **NOWHERE in execution path**. Function exists, evaluates rules, returns `{allowed, violations}`, but no caller checks the return value.
- **Blocks execution**: NO
- **Gap**: Fully implemented with 3 built-in rules + custom rule DSL, but operationally irrelevant. Complete dead-letter code in the execution flow.

## 5.8 Command Restrictions — **ADVISORY (Prompt-Only)**

- **Code**: `src/studio/command-policy.ts` — `buildPolicyPromptSection()`
- **Behavior**: Generates markdown section with allowed/denied command patterns per role. Appended to agent system prompt.
- **Enforcement**: Relies on agent instruction-following. NO runtime prevention of denied commands.
- **Gap**: Agent can execute `rm -rf /` if it decides to ignore the prompt instruction. Zero system-level enforcement.

## 5.9 Risk Classification / Task Constraints — **COSMETIC**

- **Code**: `src/studio/agent-constraints.ts` — `classifyRisk()`, `checkConstraints()`, `canAutoApprove()`
- **Called from**: HTTP routes only (`agentic-routes.ts`). NOT from execution-engine.
- **Blocks execution**: NO
- **Gap**: Risk classification and constraint checking are available via API for UI display, but never consulted during actual task execution. Agents execute regardless of risk level or constraint violations.

### Safety Summary Table

| Control | Status | Blocks Execution? | Location |
|---------|--------|-------------------|----------|
| Budget Guard | **ENFORCED** | Yes (pipeline pause) | execution-engine:799 |
| Pre-Execution Budget | **ENFORCED** | Yes (task blocked) | task-engine:startTask |
| Output Verification | **ENFORCED (critical)** | Yes (no output = hard fail) | execution-engine:858 |
| Test Gate | **ENFORCED (conditional)** | Yes (if policy=required) | execution-engine:885 |
| Approval Gate | **ENFORCED** | Yes (human approval required) | task-engine:startTask |
| Sandbox | **COSMETIC** | No | execution-engine:635 (session only) |
| Policy Engine | **COSMETIC** | No | Never called |
| Command Policy | **ADVISORY** | No | Prompt injection only |
| Risk/Constraints | **COSMETIC** | No | HTTP API only |

**Score: 5/9 enforced, 1/9 advisory, 3/9 cosmetic**

---

# 6. State, Memory, and Persistence Audit

## Source of Truth for Pipeline State

- **DB is authoritative** — `pipeline_runs` table with `stages` JSONB column
- **`_cache` is performance-only** — Read-through with explicit invalidation after every mutation
- **Evidence**: Comment in pipeline-engine.ts: "This is a PERFORMANCE CACHE ONLY. DB is the single source of truth."
- **All mutations use `mutatePipelineState()`**: SELECT FOR UPDATE + version bump → atomic transitions
- **Cache invalidation**: Every critical mutation (startStage, completeStage, pausePipeline) invalidates cache explicitly

## Task Claim/Locking

- **`claimTask()`** in `task-repo.ts`: `SELECT ... FOR UPDATE SKIP LOCKED` — standard distributed locking
- **`releaseTaskClaim()`**: Clears claim after execution (success or failure)
- **Worker ID**: Each execution-engine instance has a `_workerId` for claim tracking
- **Verdict**: **Production-grade** distributed task dispatch. No duplicate execution possible.

## Event Model

- **Events are audit trail, NOT source of truth**
- **State lives in**: tasks, projects, pipeline_runs, phases tables (direct mutation)
- **Events recorded alongside mutations**: `updateTask() + eventBus.emit()` (dual write)
- **Pattern**: Hybrid event/command model. Fast state queries + immutable audit log.
- **NOT event sourcing**: Cannot reconstruct state by replaying events. Events lack sufficient detail for full reconstruction.

## Memory Tiers

| Tier | Storage | Queried By | Changes Future Actions? |
|------|---------|-----------|------------------------|
| Episodes | `agent_episodes` table | `agent-memory.ts` → `loadBehavioralContext()` | **YES** — failure lessons injected into prompts |
| Strategy Patterns | `agent_strategy_patterns` table | `agent-strategy.ts` → `selectStrategy()` | **YES** — success rates guide strategy selection |
| Protocol Messages | `agent_protocol_messages` table | `agent-protocol.ts` → `loadProtocolContext()` | **YES** — unread messages injected into prompts |
| Learning Patterns | `learning_patterns` table | Nobody | **NO** — extraction never runs automatically |
| Graph Mutations | `graph_mutations` table | API routes only | **NO** — audit trail, not decision input |

## Whether Learning Is Real or Cosmetic

**The learning loop is REAL but NARROW:**

```
Task execution
  → completeSession() / failSession()
    → recordEpisode() [writes to agent_episodes]
      → updateStrategyPattern() [aggregates success rates]

Next task execution
  → initSession()
    → loadBehavioralContext() [reads recent episodes + failure lessons]
    → selectStrategy() [queries patterns with ≥3 samples, ≥60% success]
      → Strategy promptAddendum injected into agent prompt
```

This is a genuine closed-loop learning system. BUT:
- Learning is **coarse-grained** (success/failure binary, no reasoning trace)
- No validation that memory injection actually improves outcomes
- Cross-project learning is **dormant** (extraction never runs)
- Pattern aggregation requires ≥3 samples — cold start problem for new projects

---

# 7. Orchestration Audit

## DAG Structure

- **`buildDAGWaves()`**: Kahn's algorithm on `agent_dependencies` table
- **Edge types**: 12 types, 6 blocking (workflow, review, gate, conditional, handoff, approval), 4 non-blocking (hierarchy, notification, mentoring, escalation), 1 special (pair — same wave), 1 retry (fallback)
- **Parallelism**: Agents in same wave run in parallel. Waves execute sequentially.
- **Fallback**: If no DAG edges defined, falls back to sequential `pipeline_order`

## Dynamic vs Static Orchestration

- **Static**: DAG is computed once at pipeline start via `buildDAGWaves()`
- **Pseudo-dynamic**: `refreshPipeline()` can rebuild DAG from current edges, preserving completed stages
- **Graph mutations**: Async via API, picked up on next dispatch cycle — NOT real-time dynamic
- **Verdict**: **Predominantly static** with limited dynamic capability. DAG structure is determined at pipeline creation. Runtime changes are possible but not common-path.

## Who Decides Execution Order

1. **DAG structure** (from agent_dependencies) determines wave ordering
2. **Task dependencies** (from tasks.depends_on) determine within-wave ordering
3. **`getReadyTasks()`** queries tasks with all dependencies satisfied
4. **Execution engine** dispatches in the order `getReadyTasks()` returns them

No agent decides its own execution order. No negotiation between agents. No priority-based scheduling (beyond DAG structure).

## Runtime Graph Mutation — Common Path or Edge Case?

**Edge case.** Graph mutations are:
- API-only (not called from execution engine)
- Decoupled from pipeline stage management
- Picked up asynchronously on next dispatch cycle
- No evidence of frequent use in normal pipeline execution

## Replanning — Does It Materially Change Downstream Execution?

**Rarely.** Adaptive replanning:
- Triggers only at phase boundaries
- Rate-limited to 1 per 10 minutes
- `generatePatches()` has narrow trigger conditions
- Low-risk patches auto-applied (defer/cancel tasks)
- Medium+ patches queued for approval (rarely auto-applied)

In practice, most pipelines complete without replanning ever firing.

## State Machine Safety

- **Task states**: queued → assigned → running → review → done | failed | waiting_approval
- **Pipeline states**: created → running → completed | failed | paused
- **Transitions are DB-enforced**: All state changes go through `updateTask()` or `mutatePipelineState()`
- **Race condition protection**: `claimTask()` with SKIP LOCKED, `mutatePipelineState()` with SELECT FOR UPDATE
- **Concern**: No formal state machine validator. Invalid transitions are prevented by application logic, not a state machine library. Edge cases (e.g., completing an already-failed task) rely on conditional checks in code.

---

# 8. Failure Mode Audit

| # | Failure Mode | Severity | Detected? | Recovered? |
|---|-------------|----------|-----------|------------|
| 1 | **CLI binary not found** — Claude Code not installed | HIGH | YES (adapter.isAvailable check) | YES (fallback to next adapter, but only Claude is fully implemented) |
| 2 | **Rate limit cascade** — All providers rate-limited simultaneously | HIGH | YES (isAllExhausted()) | PARTIAL (task deferred, timeout retry, but recovery loop not fully wired) |
| 3 | **Budget overshoot** — Expensive task exceeds budget mid-execution | MEDIUM | YES (enforceBudgetGuard after token recording) | PARTIAL (pipeline paused, but current task's cost already incurred) |
| 4 | **Review loop stall** — Reviewer agent consistently rejects, hitting max revisions | MEDIUM | YES (max 3 revisions → escalation) | YES (escalates to tech-lead agent) |
| 5 | **Sub-task orphan** — Parent decomposed but sub-task fails permanently | MEDIUM | PARTIAL (failTask checks fallback edges) | PARTIAL (fallback once, then permanent failure) |
| 6 | **False completion** — Agent claims files created but didn't | MEDIUM | PARTIAL (output_non_empty check) | PARTIAL (only catches zero-output, not false file claims) |
| 7 | **Sandbox escape** — Agent executes destructive commands (rm -rf, DROP DATABASE) | HIGH | NO (sandbox only tracks, doesn't prevent) | NO (no runtime command blocking) |
| 8 | **Stale cache** — Pipeline cache diverges from DB | LOW | YES (explicit invalidation after mutations) | YES (cache is read-through with DB fallback) |
| 9 | **Concurrent dispatch** — Two workers claim same task | LOW | YES (SELECT FOR UPDATE SKIP LOCKED) | YES (second worker gets null, skips) |
| 10 | **Pipeline pause during execution** — Tasks in-flight when pause issued | MEDIUM | YES (AbortController signal) | PARTIAL (signal sent but CLI subprocess may not honor it immediately) |
| 11 | **Episode recording failure** — completeSession/failSession fails | LOW | YES (.catch() wrapping) | YES (task completes regardless, learning lost for that execution) |
| 12 | **Strategy cold start** — New project has no episodes for strategy selection | LOW | YES (fallback to role default → builtin) | YES (builtin strategies always available) |
| 13 | **Graph mutation orphan** — Task inserted via graph mutation but never dispatched | MEDIUM | NO (no validation that inserted tasks have required dependencies met) | NO (task may sit in queued state indefinitely) |
| 14 | **Approval stall** — Task waiting_approval but no human responds | HIGH | NO (no timeout on approval wait) | NO (task stalls forever, pipeline blocks) |
| 15 | **Context window overflow** — Task prompt + behavioral memory + protocol messages exceed model limits | MEDIUM | NO (no hard token limit enforcement in prompt assembly) | NO (model may truncate or error, no graceful handling) |
| 16 | **Tenant data leak** — RLS enabled but `app.current_tenant_id` not set in transaction | HIGH | PARTIAL (RLS policies fall back to `tenant_id IS NULL` for backward compat) | NO (backward compat clause means unset context sees all NULL-tenant rows) |
| 17 | **Dead DAG branch** — Deferred tasks forgotten, never re-activated | LOW | NO (no mechanism to check for permanently deferred tasks) | NO (manual intervention required) |
| 18 | **Provider state drift** — ProviderStateManager tracks state in-memory only, lost on restart | MEDIUM | NO (state not persisted) | NO (restart resets all provider cooldowns, may re-trigger rate limits) |

---

# 9. Illusions vs Reality

| Looks True from Architecture/Docs | What Is Actually True in Runtime |
|---|---|
| "Agents communicate via structured inter-agent protocol" | Agents receive messages in prompts but cannot send messages during execution. Communication is passive, read-only. |
| "Dynamic task injection allows agents to propose new tasks at runtime" | Task injection is HTTP-API-only. Agents have no mechanism to call `proposeTask()` during CLI execution. |
| "Graph mutations enable dynamic coordination" | Graph mutations are API operations, not runtime agent decisions. They're manual graph edits, not autonomous coordination. |
| "Cross-project learning extracts and promotes patterns" | Extraction never runs automatically. `selectStrategy()` never calls `getLearningPatterns()`. Dormant infrastructure. |
| "Sandbox isolation enforces capability restrictions" | Sandbox creates DB records but `checkToolAllowed()`/`checkPathAllowed()` are never called. Agents execute with full access. |
| "Policy engine evaluates governance rules" | `evaluatePolicies()` exists but is never called from execution path. Complete dead-letter code. |
| "Command policy restricts agent operations" | Command restrictions are prompt text. No runtime enforcement. Agents can ignore instructions. |
| "Risk classification constrains task execution" | `agent-constraints.ts` is never called from execution-engine. Risk classification is HTTP-API-only for UI display. |
| "Adaptive replanning dynamically restructures the pipeline" | Replanning triggers at phase boundaries with narrow conditions. Most pipelines never trigger a replan. |
| "Goal-driven execution validates success criteria" | Goal validation is keyword-matching heuristic (50% threshold). Failure doesn't block task completion. Advisory only. |
| "Output verification ensures task correctness" | Only `output_non_empty` is a hard fail. File existence claims pass through without filesystem verification blocking completion. |
| "Agents are behaviorally adaptive autonomous entities" | Agents are CLI subprocess invocations with prompt-injected context. They can't self-assign, negotiate, or make runtime decisions beyond what the prompt tells them. |
| "Context packet optimizes token-efficient prompt assembly" | `context-packet.ts` specifically is unwired (`buildContextPacket()` has zero callers). However, the broader context-mode native implementation (6 other modules) IS active: FTS knowledge base, output sandboxing, session recovery, hybrid RAG, document indexer, analytics — all wired into execution-engine. Only the token budgeting module remains unwired. |
| "Job queue provides durable task dispatch" | Job queue schema exists but is never used in task execution. Tasks dispatch via `claimTask()` in task-repo directly. |

---

# 10. Strongest Parts of the Architecture

1. **DB-authoritative pipeline state** — `mutatePipelineState()` with SELECT FOR UPDATE + version bump eliminates split-brain. Cache is strictly performance-only with explicit invalidation. This is production-grade state management.

2. **Distributed task claiming** — `claimTask()` with `SELECT FOR UPDATE SKIP LOCKED` is the correct pattern for concurrent task dispatch. No duplicate execution possible. Worker ID tracking enables proper recovery.

3. **CLI execution with provider fallback** — Adapter chain with rate-limit detection, provider state tracking, and graceful degradation (defer task instead of fail). Real subprocess spawning with stream-json output parsing and token accounting.

4. **Review loop with escalation** — Genuine code review workflow: task → review status → reviewer agent → approve/reject → revision (max 3) → tech-lead escalation. This is a complete quality assurance pipeline.

5. **Closed-loop behavioral learning** — Episode recording → strategy pattern aggregation → data-driven strategy selection → prompt injection. Requires ≥3 samples and ≥60% success rate. This is real machine learning at the system level, not theater.

6. **DAG parallelism** — Kahn's algorithm on typed edges with proper blocking/non-blocking classification. Pair edges for co-scheduling. Circular dependency detection. Linear fallback for backward compatibility.

7. **Idempotent schema bootstrap** — `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS` throughout `init.sql`. System can restart without migration headaches.

8. **Budget guard with pipeline pause** — Actual enforcement: budget breach → `pausePipeline()`. Not just a warning — stops new task dispatch.

9. **Approval gates** — Human-in-the-loop for XL tasks, deployment keywords, and approval edges. Hard blocking gate — task cannot proceed without explicit approval.

10. **Model routing with escalation** — Complexity-based model selection with automatic escalation on failure/rejection. Smart cost optimization: simple tasks get Haiku, complex ones get Opus.

---

# 11. Weakest and Most Dangerous Parts

1. **Sandbox is security theater** — The system claims capability isolation but `checkToolAllowed()`/`checkPathAllowed()` are never called. Agents have full filesystem and command access. A rogue agent could execute destructive commands. **This is the most dangerous gap** — it's worse than having no sandbox because the existence of sandbox code creates false confidence.

2. **No timeout on approval gates** — Tasks waiting for human approval can stall indefinitely. No escalation timer, no auto-reject, no notification escalation. A pipeline can block permanently on an unanswered approval request.

3. **Policy engine is dead code** — `evaluatePolicies()` is fully implemented but never called. This creates maintenance burden and false confidence in governance coverage.

4. **Command restrictions are prompt-only** — Agent compliance with command restrictions depends entirely on LLM instruction-following. No system-level prevention of destructive operations.

5. **Cross-project learning is dormant** — Infrastructure exists but extraction never runs. Strategy selection doesn't consume learning patterns. This is dead investment.

6. **Task injection is disconnected from agents** — Agents cannot propose tasks during execution. The task injection framework serves no purpose in the current architecture.

7. **Agent constraints never enforced** — Risk classification and constraint checking exist but are never consulted during execution. Agents execute with full permissions regardless.

8. **Provider state not persisted** — In-memory only. Process restart resets all cooldowns, potentially re-triggering rate limits immediately.

9. **Context window unbounded** — No hard token limit on prompt assembly. Behavioral memory + protocol messages + goal prompts + task description could exceed model context window.

10. **RLS backward compat hole** — `tenant_id IS NULL` condition in RLS policies means unset tenant context can access all null-tenant rows. This is a data isolation risk for multi-tenant deployments.

---

# 12. Master Plan Validation

Based on comparison with `.planning/Oscorpex_Agentic_Refactor_Master_Plan.md`:

## Phase 1 (Stabilization) Claims

| Claim | Master Plan Status | Implementation Truth |
|-------|--------------------|---------------------|
| Pipeline state → DB-authoritative | "Needed" | **DONE** — mutatePipelineState with SELECT FOR UPDATE + version bump |
| Distributed dispatch locking | "Needed" | **DONE** — claimTask with SKIP LOCKED |
| Output verification gate | "Needed" | **PARTIALLY DONE** — Wired and enforced for empty output, advisory for file existence |
| Test gate integration | "Needed" | **DONE** — Enforced when policy=required |
| Cost circuit breaker | "Needed" | **DONE** — enforceBudgetGuard pauses pipeline |
| RLS activation | "Needed" | **DONE (structurally)** — Enabled on 14 tables, but backward-compat hole exists |
| Graceful provider failure | "Needed" | **PARTIALLY DONE** — Degradation tracked, task deferred, but recovery loop incomplete |

**Phase 1 verdict**: ~80% complete. Major stabilization work is done. Remaining gaps: output verification strictness, RLS backward-compat hole, provider recovery wiring.

## Phase 2 (Agentic Core) Claims

| Claim | Master Plan Status | Implementation Truth |
|-------|--------------------|---------------------|
| Episodic + behavioral memory | "Planned" | **DONE** — Episodes recorded, behavioral context injected into prompts |
| Strategy-based agents | "Planned" | **DONE** — Data-driven selection with historical patterns |
| Observation-Action loop | "Planned" | **PARTIALLY DONE** — Sessions exist but `recordStep()` never called |
| Dynamic task injection | "Planned" | **ARCHITECTURAL ILLUSION** — Framework exists, agents can't trigger it |
| Inter-agent protocol | "Planned" | **DONE** — Messages loaded and injected, but passive only |
| Governance upgrade | "Planned" | **PARTIALLY DONE** — Approval gates enforced, constraints not wired |

**Phase 2 verdict**: ~55% genuinely implemented. Memory/strategy/session are real. Task injection and constraints are theater.

## Phase 3 (Dynamic Platform) Claims

| Claim | Master Plan Status | Implementation Truth |
|-------|--------------------|---------------------|
| Dynamic coordination graph | "Planned" | **DONE (API-only)** — Mutations work but decoupled from execution |
| Adaptive replanning | "Planned" | **PARTIAL** — Triggers at phase boundary, rarely fires |
| Goal-based execution | "Planned" | **ADVISORY** — Injected into prompts, validation is keyword heuristic |
| Sandbox isolation | "Planned" | **COSMETIC** — Sessions tracked, enforcement missing |
| Cross-project learning | "Planned" | **ARCHITECTURAL ILLUSION** — Extraction dormant, never consumed |

**Phase 3 verdict**: ~30% genuinely implemented. Most features are infrastructure without activation.

## What's Obsolete

- **VoltAgent framework integration** — Referenced in index.ts but functionally dead weight. VoltAgent agents (assistant, researcher, etc.) exist but don't participate in studio pipeline execution.
- **Job queue** — Schema exists but unused. Task dispatch works fine without it via claimTask().
- **context-packet.ts** — Dead code. Should be removed or integrated.

## What Priorities Are Wrong

- Master plan treats all Phase 2+3 items equally. In reality:
  - **Memory/strategy/session** are already done and working — should be marked complete
  - **Task injection and constraints** need fundamental architecture changes (agent tool integration), not incremental wiring
  - **Sandbox enforcement** should be Phase 1 (safety), not Phase 3 (platform)

---

# 13. Updated Refactor Priority

## Phase 1: Hard Enforcement and Correctness (Safety-Critical)

**Objective**: Make all safety claims true. Every control that exists should either enforce or be removed.

| Task | Files | Risk | Acceptance Criteria |
|------|-------|------|-------------------|
| Wire sandbox enforcement into execution | `execution-engine.ts`, `sandbox-manager.ts` | Medium — may break existing executions if policies too strict | `checkToolAllowed()` called before CLI execution, violations block or escalate |
| Wire policy engine into execution | `execution-engine.ts`, `task-engine.ts`, `policy-engine.ts` | Low | `evaluatePolicies()` called in `startTask()`, "block" action prevents execution |
| Wire agent-constraints into execution | `execution-engine.ts`, `agent-constraints.ts` | Low | `checkConstraints()` called before task dispatch, violations respected |
| Add approval timeout with escalation | `task-engine.ts` | Low | Tasks waiting_approval > N hours auto-escalate or auto-reject |
| Fix RLS backward-compat hole | `scripts/init.sql`, auth middleware | Medium — may break existing single-tenant setups | `tenant_id IS NULL` no longer bypasses RLS when auth is enabled |
| Persist provider state | `provider-state.ts` | Low | Rate limit cooldowns survive process restart |
| Add prompt token budget enforcement | `execution-engine.ts` | Low | Prompt assembly respects model context window limit |
| Strengthen output verification | `output-verifier.ts`, `execution-engine.ts` | Medium | File existence failures become hard fails (configurable) |
| Remove dead code | `context-packet.ts` | None | Dead module removed, reducing maintenance burden |

## Phase 2: Observability and Learning Quality (Feedback Loop)

**Objective**: Make the learning system deeper and the observation system richer.

| Task | Files | Risk | Acceptance Criteria |
|------|-------|------|-------------------|
| Activate cross-project learning | `cross-project-learning.ts`, `agent-strategy.ts`, `agent-session.ts` | Low | Auto-extraction on episode recording; `selectStrategy()` consults learning patterns |
| Wire `recordStep()` for rich observations | `agent-session.ts`, `execution-engine.ts` | Low | Session observations include step-by-step execution trace, not just outcome |
| LLM-based goal validation | `goal-engine.ts` | Medium — adds cost per task | Replace keyword heuristic with LLM-based criteria validation |
| Make goal failure actionable | `goal-engine.ts`, `execution-engine.ts` | Medium | Goal failure triggers retry or escalation (configurable) |
| Add strategy A/B testing | `agent-strategy.ts` | Low | Alternate strategies for same task type, measure outcomes |
| Add prompt effectiveness tracking | `agent-memory.ts` | Low | Track which memory injections correlate with success |
| Integrate context-packet or remove | `context-packet.ts` or delete | Low | Either token-budgeted prompt assembly is used, or dead code is removed |

## Phase 3: Scalable Autonomy and Platform Evolution (Agent Capability)

**Objective**: Move from semi-agentic to genuinely autonomous multi-agent behavior.

| Task | Files | Risk | Acceptance Criteria |
|------|-------|------|-------------------|
| Agent-initiated task injection | `task-injection.ts`, `cli-runtime.ts`, execution prompt | High — agents may propose unnecessary tasks | Agents can call `proposeTask()` via structured output during CLI execution |
| Bidirectional protocol communication | `agent-protocol.ts`, `cli-runtime.ts` | High — complex coordination | Agents can send messages during execution, not just receive |
| Autonomous graph mutation | `graph-coordinator.ts`, `execution-engine.ts` | High — may destabilize pipeline | Agents can propose graph mutations based on discovered dependencies |
| Real process isolation | `sandbox-manager.ts`, `container-manager.ts` | High — Docker dependency | Mandatory containerization with enforced filesystem/network isolation |
| Provider recovery automation | `provider-state.ts`, `execution-engine.ts` | Medium | Automatic retry scheduling with exponential backoff on provider recovery |
| Multi-process distributed execution | `execution-engine.ts`, `pipeline-engine.ts` | High — requires distributed coordination | Multiple engine instances coordinate via DB, not in-memory state |
| Agent self-assessment | `agent-session.ts`, `goal-engine.ts` | Medium | Agents evaluate their own output quality before completion |

---

# 14. Final Verdict

## Is this a true agentic system today?

**No.** Agents are CLI subprocess invocations with prompt-injected behavioral context. They cannot self-assign work, negotiate with each other, inject tasks during execution, make runtime decisions about execution strategy, or operate under enforced governance constraints. They execute pre-assigned tasks in a pre-determined order with no autonomous decision-making beyond what the LLM decides within its single execution window.

## If not, what is the most accurate label?

**Semi-Agentic DAG-Orchestrated Development Studio with Behavioral Learning**

The "semi-agentic" qualifier is earned by the genuine behavioral memory → strategy selection → prompt injection → episode recording feedback loop. This is real adaptive behavior — agents measurably change their approach based on historical outcomes. But it's adaptation within a rigid execution framework, not autonomy.

## What is the single biggest illusion?

**Sandbox enforcement.** The system has an entire sandbox subsystem (policies, sessions, violation tracking, check functions) that creates strong confidence in capability isolation. In reality, none of the check functions are called during execution. Agents have full, unrestricted access to the filesystem and can execute any command. This is worse than having no sandbox — it creates false security confidence.

## What is the single strongest real capability?

**The closed-loop behavioral learning system.** Episode recording → strategy pattern aggregation → data-driven strategy selection (≥3 samples, ≥60% success threshold) → prompt injection → execution → new episode. This is a genuine machine learning system at the orchestration level. Combined with DB-authoritative state management and distributed task claiming, the execution backbone is production-grade.

## What should the next implementation sprint focus on?

**Phase 1: Hard enforcement** — Make safety claims true:
1. Wire sandbox `checkToolAllowed()`/`checkPathAllowed()` into execution-engine (highest impact safety fix)
2. Wire policy engine `evaluatePolicies()` into task-engine startTask()
3. Wire agent-constraints `checkConstraints()` into execution-engine
4. Add approval timeout with auto-escalation
5. Remove dead code (context-packet.ts, unused job queue references)

This sprint converts 3 cosmetic controls into enforced ones, fixes the most dangerous security gap (sandbox), and cleans up dead code that creates false confidence. Estimated scope: ~5 files, ~200 lines of wiring code, no architectural changes needed.

---

# Appendix: Document Comparison

## Architecture Analysis (ARCHITECTURE_ANALYSIS.md)

- "38/100 overall agentic maturity" → **Too pessimistic** for current state. Memory/strategy/session are now functional, pushing this closer to 50-55/100.
- "Agents are execution slots" → **Outdated**. Agents now receive behavioral context and strategy guidance. Still not autonomous, but more than execution slots.
- "No behavioral memory" → **Outdated**. Behavioral memory is implemented and functional.
- "Split-brain pipeline state" → **Outdated**. Fixed with DB-authoritative mutatePipelineState.

## Deep Architecture Analysis (DEEP_ARCHITECTURE_ANALYSIS.md)

- "57/100 overall agentic maturity" → **Too optimistic**. Several features claimed as "wired" are cosmetic (sandbox, constraints, policy engine).
- "Agent maturity: 58/100" → **Overstated**. Should be ~45/100. Memory and strategy are real, but constraints, task injection, and learning are not functional.
- "Safety wiring verified at specific line numbers" → **Partially misleading**. Lines exist but enforcement varies from hard-blocking to cosmetic.
- "Genuine behavioral learning loop" → **Accurate** for memory/strategy. **Overstated** for cross-project learning.

## Master Plan (Oscorpex_Agentic_Refactor_Master_Plan.md)

- Phase 1 priorities → **Mostly correct**, ~80% already done
- Phase 2 priorities → **Partially misaligned**. Memory/strategy done, task injection needs architectural rethink
- Phase 3 priorities → **Too ambitious for current state**. Sandbox enforcement should be Phase 1, not Phase 3
- Overall structure → **Useful but needs updating** to reflect completed work and revised priorities

---

*End of Implementation Truth Audit*
