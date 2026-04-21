# Oscorpex — Deep Architectural Analysis Report

**Date:** 2026-04-21
**Analyst:** Claude Opus 4.6 (Staff Engineer — Agentic Systems)
**Method:** Full codebase inspection via 4 parallel exploration agents + manual wiring verification
**Scope:** 96 core engine files, 40 DB repos, 28 route files, 7 agent-runtime modules, ~4375 lines orchestration code, ~3212 lines agent runtime code, 97-table schema

---

## 1. What This System Actually Is

**Classification: DAG-Orchestrated Semi-Agentic Software Development Studio with Genuine Behavioral Learning**

Oscorpex is a **multi-agent execution platform** that orchestrates AI-powered software development through a DAG-based pipeline. It sits between a pure workflow engine and a truly autonomous agentic system.

More precisely:

- **Core execution model**: Static DAG pipeline (Kahn's algorithm) with runtime mutation capability
- **Agent model**: Role-based executors (PM, Frontend Dev, Backend Dev, QA, Tech Lead, etc.) with genuine behavioral memory, strategy selection, and inter-agent communication
- **Execution substrate**: External CLI tools (Claude Code, Codex, Aider, Cursor) invoked via `child_process.execFile`
- **State management**: PostgreSQL as single source of truth, event logging (not event sourcing), read-through cache for pipeline state
- **Governance**: Multi-layered safety controls — some fully wired, others advisory-only

This is NOT "mostly scripted automation with LLM wrappers." The system has genuine learning loops, dynamic graph mutation, and behavioral memory that materially affect execution. However, it is also NOT a fully autonomous agentic system — agents cannot independently set goals, discover tools, or coordinate without the pipeline orchestrator.

**Honest label: Semi-Agentic DAG-Orchestrated Development Platform with Real Behavioral Learning**

---

## 2. Repository Architecture Map

### Core Backend (`src/studio/`) — 96 files

| Layer | Files | Purpose |
|-------|-------|---------|
| **Orchestration** | `execution-engine.ts` (1659L), `pipeline-engine.ts` (1077L), `task-engine.ts` (1210L), `task-decomposer.ts` (429L) | DAG execution, task lifecycle, phase progression |
| **Agent Runtime** | `agent-runtime/` (7 files, ~824L) | Memory, strategy, session, protocol, constraints, task-injection |
| **Planning** | `pm-agent.ts` (1002L), `team-architect.ts` (69L), `incremental-planner.ts`, `work-item-planner.ts` | Plan generation, team composition |
| **Dynamic Platform** | `graph-coordinator.ts` (278L), `adaptive-replanner.ts` (294L), `goal-engine.ts` (217L), `cross-project-learning.ts` (218L) | Runtime graph mutation, replanning, goals, learning |
| **Safety/Control** | `budget-guard.ts`, `output-verifier.ts`, `test-gate.ts`, `sandbox-manager.ts`, `policy-engine.ts`, `command-policy.ts` | Budget, verification, testing, sandbox, policy enforcement |
| **Model/Provider** | `model-router.ts` (147L), `ai-provider-factory.ts`, `provider-state.ts`, `cli-adapter.ts`, `cli-runtime.ts` | Model selection, provider management, CLI execution |
| **Context** | `context-packet.ts` (419L), `context-builder.ts`, `context-store.ts`, `context-sandbox.ts`, `behavioral-prompt.ts` | Prompt assembly, FTS augmentation |
| **Communication** | `event-bus.ts`, `agent-protocol.ts`, `agent-messaging.ts`, `agent-chat.ts`, `notification-service.ts` | Events, inter-agent protocol, notifications |
| **Infrastructure** | `pg.ts`, `db-bootstrap.ts`, `job-queue.ts`, `ws-server.ts`, `ws-cluster.ts`, `telemetry.ts`, `shared-state.ts` | DB pool, job queue, WebSocket, tracing |
| **Integrations** | `github-integration.ts`, `gitlab-integration.ts`, `ci-tracker.ts`, `app-runner.ts`, `git-manager.ts` | SCM, CI/CD, app execution |

### Persistence (`src/studio/db/`) — 40 files, 97 tables

22+ repository modules covering: projects, tasks, agents, plans, events, episodes, strategies, sessions, proposals, protocols, approvals, capabilities, graph mutations, jobs, templates, marketplace, analytics, settings, work items, etc.

### API (`src/studio/routes/`) — 28+ route files

All mounted under `/api/studio`. Covers: projects, tasks, agents, pipeline, agentic (sessions/episodes/strategies/proposals), graph (mutations/goals/replan), sandbox, analytics, git, CI, collaboration, marketplace, templates, etc.

### Frontend (`console/`) — React 19 + Vite + Tailwind 4

58 studio pages, 25 API client modules, 15 components, 5 hooks. Operationally decoupled from orchestration — the frontend is a read/control UI, not part of the execution loop. Notable: AgenticPanel provides observability into sessions, proposals, goals, graph mutations, and capability grants.

### CLI (`src/cli/`) — 9 files

Commander-based CLI (init, start, status, deploy, projects). Talks to backend API.

---

## 3. Agent Model Assessment

### Agent Definition

Agents in Oscorpex are **role-based executors with genuine behavioral state**. They are NOT autonomous entities with their own goal-setting, tool discovery, or independent planning capabilities. However, they are significantly more than "named wrappers."

### Per-Module Assessment

| Module | Role | Truly Agentic? | Has State? | Affects Behavior? |
|--------|------|----------------|------------|-------------------|
| `agent-memory.ts` | Loads past episodes as behavioral prompt injection | **Yes** — prevents repeating failures | DB-backed (episodes) | **Yes** — changes strategy selection |
| `agent-strategy.ts` | Selects from role-specific strategy catalog based on history | **Yes** — data-driven selection | DB-backed (patterns) | **Yes** — different prompt instructions per strategy |
| `agent-session.ts` | Bounded execution context with observation logging | **Yes** — records learning episodes | DB-backed (sessions, observations) | **Yes** — feeds back into memory/strategy |
| `agent-protocol.ts` | Inter-agent messaging (request_info, blocker_alert, handoff) | **Yes** — can block execution | DB-backed (messages) | **Yes** — blocking messages halt tasks |
| `agent-constraints.ts` | Risk classification and approval checking | **Partial** — checks but doesn't enforce autonomously | DB-backed (rules) | **Advisory** — caller must honor |
| `task-injection.ts` | Agents propose new tasks at runtime | **Yes** — agents create work | DB-backed (proposals) | **Yes** — low-risk auto-creates tasks |
| `goal-engine.ts` | Goal-based success criteria validation | **Yes** — criteria-driven completion | DB-backed (goals) | **Yes** — agents see goal prompts |
| `graph-coordinator.ts` | Dynamic DAG mutation (insert/split/defer/merge) | **Yes** — restructures execution | DB-backed (mutations) | **Yes** — changes what executes next |
| `adaptive-replanner.ts` | Phase-boundary replanning with patches | **Yes** — auto-adjusts plan | DB-backed (replan events) | **Yes** — defers/adds/removes tasks |
| `cross-project-learning.ts` | Anonymized pattern extraction across tenants | **Yes** — cross-project learning | DB-backed (patterns) | **Yes** — influences strategy selection |
| `model-router.ts` | Complexity + failure-based model escalation | **Yes** — adapts capability | Settings-backed | **Yes** — Haiku vs Opus = massive difference |
| `pm-agent.ts` | Plan generation via AI tool calls | **Utility** — stateless prompt + tools | N/A | **Yes** — creates entire plan structure |
| `team-architect.ts` | Team composition via AI prompt | **Utility** — stateless prompt | N/A | **Yes** — determines team before planning |

### Verdict

**Real agents with behavioral memory, NOT autonomous agents.** The system has genuine learning loops (episode → memory → strategy → episode) that materially change future behavior. However, agents cannot:
- Set their own goals (goals come from the plan)
- Discover or create new tools
- Decide execution order (pipeline controls this)
- Communicate proactively (protocol is read-on-demand)
- Override governance decisions

**Classification: Behaviorally Adaptive Role-Based Executors**

---

## 4. Orchestration Model

### Architecture Type: **Hybrid DAG + Event-Driven Orchestration**

The orchestration is **primarily DAG-driven** with event-driven side effects:

1. **Static DAG** (`pipeline-engine.ts`): Phases ordered by `depends_on`, tasks ordered by `dependsOn`. Kahn's algorithm (`buildDAGWaves()`) computes parallelizable waves. This is the **primary control flow**.

2. **Event-Driven Reactions** (`event-bus.ts`): Events trigger side effects (notifications, memory updates, diff capture, stats) but do NOT drive the main execution flow. Events are post-hoc logging, not the source of truth.

3. **Runtime Mutations** (`graph-coordinator.ts`, `adaptive-replanner.ts`): The DAG CAN change at runtime via:
   - `insertNode()` — add task to phase
   - `splitTask()` — decompose task into children
   - `addEdge()`/`removeEdge()` — modify dependencies
   - `deferBranch()` — defer all queued tasks in phase
   - `mergeIntoPhase()` — inject tasks from another phase
   - `evaluateReplan()` — phase-boundary plan patches

4. **Pipeline State** (`mutatePipelineState()`): DB-authoritative with SELECT FOR UPDATE + version bump. The `_cache` is read-through only. Split-brain eliminated.

### Where Decisions Actually Happen

| Decision | Location | Mechanism |
|----------|----------|-----------|
| Phase ordering | `pipeline-engine.ts:buildDAGWaves()` | Kahn's topological sort |
| Task readiness | `task-engine.ts:getReadyTasks()` | Dependency check (all deps done?) |
| Task decomposition | `execution-engine.ts:507` | L/XL complexity + no parent → decompose |
| Model selection | `model-router.ts:resolveModel()` | Complexity + failure history |
| Strategy selection | `agent-strategy.ts:selectStrategy()` | Historical patterns → role default → builtin |
| Approval gate | `task-engine.ts:248-277` | XL complexity OR keyword match |
| Review routing | `task-engine.ts:456` | Agent dependency lookup |
| Phase advancement | `task-engine.ts:checkAndAdvancePhase()` | All tasks done/review? |
| Replanning | `adaptive-replanner.ts:evaluateReplan()` | Phase boundary trigger |
| Provider selection | `execution-engine.ts:697` | Try adapters in sequence |

### Verdict

**Static DAG with limited runtime dynamism.** The DAG structure is generated at plan time and mostly executes as-is. Runtime mutations exist and are wired but represent edge-case adjustments, not continuous restructuring. The system is **graph-driven for ordering, state-machine-driven for task lifecycle, and event-driven for side effects**.

---

## 5. Task Lifecycle

### Complete State Machine (Verified from `task-engine.ts`)

```
queued
  ↓ assignTask()
assigned
  ↓ startTask() [approval gate + budget check]
  ├─ needs approval → waiting_approval
  │    ├─ approveTask() → queued
  │    └─ rejectTask() → failed
  └─ approved/no approval needed
running
  ├─ completeTask() + has reviewer
  │    ↓
  │   review
  │    ├─ submitReview(approved=true) → done
  │    └─ submitReview(approved=false)
  │         ├─ revisionCount < 3 → revision → running (loop)
  │         └─ revisionCount ≥ 3 → escalateTask() → failed
  ├─ completeTask() + no reviewer → done
  └─ failTask()
       ├─ has fallback edge + retryCount=0 → queued (fallback agent)
       ├─ has escalation edge + retryCount≥maxFailures → queued (escalation agent)
       └─ else → failed

done → checkAndAdvancePhase() → phase progression
```

### Additional Statuses (v7.0)
- `blocked` — waiting on graph mutation (splitTask parent)
- `deferred` — deferred by replanner or sandbox policy
- `cancelled` — cancelled by replanner patch

### Strengths
- **Claim-based dispatch**: `SELECT FOR UPDATE SKIP LOCKED` prevents duplicate execution
- **Review loop**: Real reviewer agent creates review task, inspects files, approves/rejects
- **Fallback/escalation edges**: Structural recovery via agent dependency graph
- **Sub-task rollup**: Parent auto-completes when all children done
- **Budget gate**: Pre-execution budget check (in task-engine `startTask()`)

### Weak Points
- **Review loop ceiling**: MAX_REVISION_CYCLES=3 → escalation, but escalation creates a work item (manual) rather than auto-retrying with different approach
- **No partial completion**: Task is all-or-nothing (no incremental progress tracking within a task)
- **Timeout handling**: Timeout resets to queued for retry, but no memory of what was already done
- **Zero-file decision**: Writing decision.md is creative but fragile (relies on filesystem existence)

---

## 6. State, Memory, and Persistence

### What Is Persisted (97 tables)

| Category | Tables | Purpose |
|----------|--------|---------|
| **Core State** | projects, project_plans, phases, tasks, pipeline_runs | Transactional state (CRUD) |
| **Agent State** | project_agents, agent_dependencies, agent_capabilities, agent_capability_grants | Team structure, permissions |
| **Behavioral Memory** | agent_sessions, agent_observations, agent_episodes, agent_strategy_patterns | Learning loop data |
| **Coordination** | agent_protocol_messages, task_proposals, approval_rules | Inter-agent protocol, governance |
| **Dynamic Platform** | execution_goals, graph_mutations, replan_events, learning_patterns | Goals, DAG mutations, replanning |
| **Safety** | verification_results, test_results, sandbox_policies, sandbox_sessions | Safety control outputs |
| **Events** | events | Append-only audit trail |
| **Infrastructure** | jobs, token_usage, chat_messages, notifications, webhooks | Support tables |

### Is Agent Memory Meaningful?

**YES — with caveats.**

The learning loop is real and closed:
```
Task Execution → Episode Recording → Behavioral Memory Loading → Strategy Selection → Task Execution
```

Evidence:
1. `completeSession()` records success episode with strategy, task type, output quality
2. `failSession()` records failure episode with error reason
3. `loadBehavioralContext()` fetches recent successes/failures + best strategies
4. `selectStrategy()` uses pattern success rates (≥3 samples, ≥60% threshold)
5. `formatBehavioralPrompt()` injects "BEHAVIORAL MEMORY" section into agent prompt

**Caveat**: The quality of behavioral memory depends on the quality of episode recording. Since execution happens via external CLI tools (Claude Code, etc.), the system can only record coarse-grained outcomes (success/failure), not fine-grained reasoning traces.

### Event Sourcing Assessment

**NOT event sourcing. Pure CRUD with event logging.**

| Aspect | Event Sourcing | Oscorpex |
|--------|----------------|----------|
| Source of truth | Event stream | Database tables |
| State retrieval | Replay events | Direct SELECT |
| Events role | Immutable facts | Post-hoc audit trail |
| Recovery | Rebuild from events | Restore DB backup |
| Temporal queries | Replay to time T | Not supported |

Events are inserted AFTER state changes. `insertEvent()` is called after `updateTask()`. No event handler reconstructs state from events.

### Memory Tiers

| Tier | Mechanism | Durability | Impact |
|------|-----------|------------|--------|
| **Project-level** | projects, plans, phases tables | Permanent | Structural |
| **Task-level** | tasks table + events | Permanent | Lifecycle |
| **Session-level** | agent_sessions + observations | Permanent | Learning |
| **Episode-level** | agent_episodes | Permanent | Behavioral |
| **Strategy-level** | agent_strategy_patterns | Permanent | Selection |
| **Cross-project** | learning_patterns | Permanent | Global learning |
| **Runtime cache** | pipeline `_cache` Map | In-memory | Performance |

**Verdict: Real memory with genuine behavioral impact, not merely stored metadata.**

---

## 7. Control, Safety, and Governance

### Verified Wiring Status

| Safety Layer | Imported In | Called At | Enforcement | Status |
|-------------|-------------|----------|-------------|--------|
| **Budget Guard** | execution-engine.ts:11 | Line 799 (after token recording) | Calls `enforceBudgetGuard()` → pauses pipeline | **WIRED** |
| **Budget Pre-Check** | task-engine.ts:147-207 | In `startTask()` before execution | Fails task if budget exceeded | **WIRED** |
| **Output Verification** | execution-engine.ts:50 | Line 858 (after CLI execution) | Records result, does NOT block completion | **WIRED but ADVISORY** |
| **Test Gate** | execution-engine.ts:52 | Line 885 (after verification) | Records result, blocks if policy=required | **WIRED, CONDITIONALLY ENFORCED** |
| **Sandbox Session** | execution-engine.ts:51 | Line 635 (before CLI execution) | Starts session, resolves policy | **WIRED** |
| **Approval Gate** | task-engine.ts:248-277 | In `startTask()` | Blocks task (waiting_approval) | **WIRED and ENFORCED** |
| **Agent Constraints** | task-injection.ts | In `proposeTask()` | Blocks high-risk proposals | **WIRED and ENFORCED** |
| **Policy Engine** | task-engine.ts | In `startTask()` | `evaluatePolicies()` called | **WIRED** |
| **Adaptive Replanning** | pipeline-engine.ts:38 | Line 583 (phase boundary) | Auto-applies low-risk patches | **WIRED** |
| **Model Escalation** | execution-engine.ts | Task assignment | Bumps model tier on failures | **WIRED and ENFORCED** |

### Human-in-the-Loop Controls

1. **Approval gate**: XL tasks + sensitive keywords → `waiting_approval` status
2. **Task proposals**: High-risk proposals → `task:proposal_created` event → UI approval
3. **Replanning patches**: Medium+ risk patches → queued for approval (not auto-applied)
4. **Pipeline pause/resume**: Manual control via API
5. **PM chat**: User can interact with PM agent for requirement clarification

### Gaps

1. **Output verification is advisory** — records results but doesn't block completion
2. **Test gate is optional by default** — only blocks if policy explicitly set to "required"
3. **Sandbox enforcement is incomplete** — `checkToolAllowed()` and `checkPathAllowed()` exist but violation only records, doesn't prevent
4. **No rate limiting on API routes** — no per-user/per-project request throttling
5. **No approval audit trail table** — approvals recorded as events, no dedicated history

---

## 8. Failure Modes

### 1. Review Loop Stagnation
**Risk: MEDIUM** — Reviewer consistently rejects, developer consistently fails to fix.
MAX_REVISION_CYCLES=3 provides ceiling, but escalation creates a work item (manual follow-up), not auto-resolution. Pipeline could stall waiting for human intervention.

### 2. Dead DAG Branches
**Risk: LOW** — `deferBranch()` can defer tasks, but no mechanism to detect if a deferred branch was forgotten. Deferred tasks persist indefinitely with no timeout.

### 3. Cost Blowups
**Risk: MEDIUM** — Budget guard is wired (lines 799 + startTask check), but there's a window between task start and budget check completion where costs accumulate. Multiple concurrent tasks could exceed budget before any single check triggers.

### 4. Provider Exhaustion Cascade
**Risk: MEDIUM** — If all providers are exhausted (`isAllExhausted()` returns true), tasks are deferred with scheduled retry. But if the issue persists, deferred tasks accumulate without bound.

### 5. Partial State Corruption
**Risk: LOW** — `mutatePipelineState()` uses SELECT FOR UPDATE + version bump, and task claiming uses SKIP LOCKED. However, non-transactional post-completion hooks (memory updates, diff capture, stats) could fail silently without corrupting core state.

### 6. False Completion
**Risk: MEDIUM** — Output verification is advisory. A task could "complete" with empty output if verification results are ignored. The zero-file decision mechanism mitigates this for coding tasks but not for other task types.

### 7. Timeout Race Condition
**Risk: LOW** — AbortController timeout races with actual CLI completion. Task could complete just as timeout fires. Timeout handler checks task status before acting, but there's a small window.

### 8. Cross-Project Learning Leakage
**Risk: LOW** — `promoteToGlobal()` strips tenant_id but keeps strategy names and task types. If strategy names contain project-specific information, it could leak between tenants.

### 9. Behavioral Memory Poisoning
**Risk: LOW-MEDIUM** — If a flawed strategy records false "success" episodes, the learning loop will reinforce that strategy. No mechanism to detect or correct poisoned memory.

### 10. Event Bus Silent Failure
**Risk: MEDIUM** — PG LISTEN/NOTIFY failures are silently swallowed (`.catch(() => {})`). Multi-process systems could miss events without detection. Dedup TTL of 5s could suppress legitimate duplicate notifications.

---

## 9. Strongest Architectural Decisions

1. **Claim-based task dispatch** (`SELECT FOR UPDATE SKIP LOCKED`) — Eliminates duplicate dispatch in distributed environments. Industry-standard pattern, correctly implemented.

2. **DB-authoritative pipeline state** (`mutatePipelineState()` with version bump) — Eliminates split-brain between cache and DB. Read-through cache for performance, DB for consistency.

3. **Closed behavioral learning loop** (episode → memory → strategy → episode) — Genuine machine learning at the system level. Agents improve over time based on empirical outcomes, not just static prompts.

4. **Multi-provider failover chain** — Tries adapters in sequence, defers on exhaustion instead of failing. Graceful degradation preserves pipeline state.

5. **Review loop with structural recovery** — Fallback edges (try different agent), escalation edges (escalate to senior role), revision cycles with ceiling. Multiple recovery paths before permanent failure.

6. **Token-efficient context assembly** (`context-packet.ts`) — Mode-based prompt construction with per-section token budgets. Avoids context window overflow.

7. **Dynamic graph mutation with audit trail** — All mutations persisted in `graph_mutations` table with full payload. Enables post-hoc analysis and debugging.

8. **Modular repository pattern** — 40 repo files with barrel export (`db/index.ts`). Clean separation of persistence from business logic.

9. **Strategy catalog per role** — 9 builtin strategies across 5 roles, each with explicit prompt addendum. Not a generic "think step by step" but role-specific behavioral instructions.

10. **Idempotent schema** — `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` throughout `init.sql`. Safe to re-run migrations.

---

## 10. Biggest Architectural Gaps

### Gap 1: No Agent Autonomy in Goal Setting
Agents execute tasks assigned by the pipeline. They cannot set their own goals, prioritize work, or decide what to build next. The PM agent generates plans, but execution agents are pure executors.

### Gap 2: Coarse-Grained Execution Observability
Agents execute via external CLI tools (`child_process.execFile`). The system sees only final output (success/failure + files). No visibility into intermediate reasoning, tool calls, or decision points during execution.

### Gap 3: Output Verification Not Enforced
`verifyTaskOutput()` is called (line 858) but its result is advisory. A task can "complete" with verification failures. This undermines the entire quality assurance chain.

### Gap 4: No Idempotent Task Execution
If a task is retried after timeout, there's no mechanism to detect or undo partial work from the previous attempt. The retry starts from scratch with error context but no state recovery.

### Gap 5: No Formal State Machine
Task status transitions are enforced by code convention (if checks in each method), not by a formal state machine. Invalid transitions are possible if code is modified carelessly.

### Gap 6: Sandbox Enforcement is Infrastructure Without Teeth
`checkToolAllowed()` and `checkPathAllowed()` return `{allowed: boolean}` but violations are only recorded, never prevented. The sandbox is a monitoring system, not an isolation system.

### Gap 7: No Agent-to-Agent Proactive Communication
`agent-protocol.ts` is read-on-demand (loaded at session init). Agents cannot interrupt each other mid-execution. A blocker alert only takes effect when the blocked agent's next task starts.

### Gap 8: Learning Quality Is Unvalidated
The behavioral learning loop trusts episode outcomes at face value. No mechanism to detect false positives (task "succeeded" but output was wrong) or false negatives (task "failed" but output was salvageable).

### Gap 9: No Distributed Tracing / Correlation IDs
Events have no correlation ID linking a single user request through multiple tasks, agents, and phases. Debugging complex failures requires manual event timeline reconstruction.

### Gap 10: Single-Process Architecture
Despite PostgreSQL-backed concurrency control, the system is designed as a single Node.js process. `ws-cluster.ts` and `shared-state.ts` exist but are stubs (InMemory provider). True horizontal scaling is not possible without significant infrastructure work.

---

## 11. Agentic Maturity Score

| Dimension | Score | Justification |
|-----------|-------|---------------|
| **Orchestration Maturity** | 72/100 | Solid DAG orchestration with Kahn's algorithm, phase dependencies, claim-based dispatch. Runtime mutations exist. Missing: formal state machine, distributed orchestration. |
| **Agent Maturity** | 58/100 | Genuine behavioral memory and strategy selection. But agents are executors, not autonomous. No goal-setting, tool discovery, or proactive communication. |
| **Memory Maturity** | 65/100 | Closed learning loop with DB-backed episodes, strategies, and cross-project patterns. But coarse-grained (success/failure only), no reasoning trace capture, no memory validation. |
| **Autonomy Maturity** | 42/100 | Task injection and graph mutation enable limited autonomy. But agents can't prioritize, plan, or decide execution order. PM agent is the only planner. |
| **Control/Safety Maturity** | 55/100 | Budget guard, approval gates, and review loops are wired. But output verification is advisory, sandbox is toothless, test gate is optional by default. |
| **Production Readiness** | 48/100 | Solid DB patterns (SKIP LOCKED, version bumps). But single-process, no distributed tracing, no horizontal scaling, stale job recovery is timer-based. |
| **Overall** | **57/100** | A genuinely innovative system with real behavioral learning, held back by advisory safety controls, single-process architecture, and limited agent autonomy. |

---

## 12. Brutally Honest Verdict

### Is this a true agentic system today?

**No — but it's closer than most systems that claim to be agentic.**

It has genuine behavioral learning (not just stored metadata), real strategy selection (not just random prompting), and dynamic graph mutation (not just static workflows). These are uncommon capabilities in the AI developer tool space.

However, true agency requires:
- **Goal autonomy**: Agents set and pursue their own goals → Oscorpex agents execute assigned tasks
- **Tool discovery**: Agents find and learn new tools → Oscorpex agents use pre-configured CLI adapters
- **Proactive coordination**: Agents initiate communication → Oscorpex protocol is read-on-demand
- **Self-correction**: Agents detect and fix their own mistakes → Oscorpex relies on external review

### What is it actually?

**A DAG-orchestrated software factory with behaviorally adaptive worker agents and a genuine learning feedback loop.**

It's an impressive workflow engine that uses AI for execution and has real adaptive behavior, but the pipeline — not the agents — drives all decisions.

### What is the single biggest illusion?

**The safety/governance layer.** The system has extensive safety infrastructure (budget guard, output verifier, test gate, sandbox, constraints, approval rules) that creates an impression of robust control. In reality:
- Output verification is advisory (doesn't block)
- Test gate is optional by default
- Sandbox records violations but doesn't prevent them
- Constraint checks return recommendations, not enforcement

The system looks well-governed from the schema and module count but has significant enforcement gaps.

### What is the single most promising part?

**The closed behavioral learning loop** (episode → memory → strategy → execution → episode). This is genuinely innovative and correctly implemented. Most AI systems treat each execution as independent. Oscorpex agents actually learn from past successes and failures, select strategies based on empirical performance data, and propagate learnings across projects. With better execution observability and learning quality validation, this could become a real competitive advantage.

---

## 13. Evolution Plan

### Stage 1: Near-Term Stabilization (4-6 weeks)

**Goal: Make existing capabilities reliable and enforceable**

1. **Enforce output verification** — Change execution-engine to fail task if `verifyTaskOutput()` returns `allPassed: false`. Add configurable strictness levels (strict/warn/off).

2. **Default test gate to "required" for code tasks** — Change `resolveTestPolicy()` default from "optional" to "required" for code-producing agents (frontend-dev, backend-dev).

3. **Add formal task state machine** — Extract status transitions into a dedicated state machine with explicit allowed transitions. Reject invalid transitions with errors.

4. **Wire sandbox enforcement** — Make `checkToolAllowed()` and `checkPathAllowed()` throw/block instead of just returning boolean. Add pre-execution sandbox validation.

5. **Add correlation IDs** — Generate `correlationId` at plan execution start, propagate through all events, tasks, and sessions. Enable end-to-end tracing.

6. **Fix event bus silent failures** — Replace `.catch(() => {})` with proper error logging and circuit breaker pattern for PG LISTEN/NOTIFY.

7. **Add approval history table** — Dedicated `approval_history` table with (who, what, when, decision, reason) for audit compliance.

### Stage 2: Medium-Term Agentic Restructuring (3-4 months)

**Goal: Increase agent autonomy and execution observability**

1. **Execution trace capture** — Instrument CLI adapters to capture intermediate tool calls, file operations, and reasoning steps (not just final output). Store in `execution_traces` table.

2. **Agent-initiated communication** — Allow agents to emit protocol messages DURING execution (not just at session boundaries). Add WebSocket channel for real-time inter-agent messaging.

3. **Learning quality validation** — Add LLM-based episode quality scoring. Before recording an episode as "success," verify output actually meets acceptance criteria (not just non-empty).

4. **Proactive replanning** — Extend `adaptive-replanner.ts` to trigger on ANY task completion (not just phase boundaries). Enable continuous plan adjustment based on emerging information.

5. **Agent goal proposals** — Allow agents to propose goals (not just tasks) via `task-injection.ts` extension. PM agent evaluates and approves/rejects goal proposals.

6. **Multi-strategy execution** — Allow agents to attempt multiple strategies in parallel (A/B test approach) for high-value tasks. Compare outputs and select best.

7. **Memory validation loop** — Periodically re-evaluate stored episodes against current code quality metrics. Detect and downgrade episodes that led to later reverts or bugs.

### Stage 3: Long-Term Platform Architecture (6-12 months)

**Goal: Horizontal scaling, true agent autonomy, platform ecosystem**

1. **Distributed execution** — Replace single-process architecture with worker pool. Each worker claims tasks via SKIP LOCKED (already supported). Add Kubernetes-native deployment with auto-scaling.

2. **Agent capability marketplace** — Extend `agent-marketplace` from templates to runtime capabilities. Agents can discover and load new tools/strategies from marketplace during execution.

3. **Hierarchical agent orchestration** — Replace flat pipeline with hierarchical coordination. Tech Lead agent orchestrates backend/frontend agents. PM orchestrates Tech Leads. Each level has autonomy within bounds.

4. **Continuous learning platform** — Cross-project learning becomes a platform service. Anonymized patterns continuously extracted, validated, and promoted. Global strategy recommendations improve all tenants.

5. **Formal verification of safety properties** — Use model checking or property-based testing to formally verify safety invariants (budget never exceeded, approval never bypassed, sandbox never violated).

6. **Plugin-based execution substrates** — Abstract execution beyond CLI tools. Support container-based execution, cloud function execution, and direct API execution. Agent can choose execution substrate based on task type.

7. **Self-healing pipeline** — Pipeline detects stuck states (stale tasks, dead branches, orphaned sessions) and auto-recovers without human intervention. Chaos engineering tests validate recovery.

---

## Appendix: Key File References

| File | Lines | Purpose |
|------|-------|---------|
| `src/studio/execution-engine.ts` | 1659 | Task execution orchestration |
| `src/studio/pipeline-engine.ts` | 1077 | DAG phase orchestration |
| `src/studio/task-engine.ts` | 1210 | Task lifecycle state machine |
| `src/studio/task-decomposer.ts` | 429 | L/XL task decomposition |
| `src/studio/pm-agent.ts` | 1002 | PM agent prompt + tools |
| `src/studio/context-packet.ts` | 419 | Token-efficient prompt assembly |
| `src/studio/agent-runtime/agent-session.ts` | 226 | Session lifecycle + learning |
| `src/studio/agent-runtime/agent-memory.ts` | 90 | Behavioral context loading |
| `src/studio/agent-runtime/agent-strategy.ts` | 110 | Strategy selection |
| `src/studio/agent-runtime/agent-protocol.ts` | 153 | Inter-agent messaging |
| `src/studio/agent-runtime/agent-constraints.ts` | 113 | Risk classification |
| `src/studio/agent-runtime/task-injection.ts` | 132 | Runtime task proposals |
| `src/studio/graph-coordinator.ts` | 278 | Dynamic DAG mutations |
| `src/studio/adaptive-replanner.ts` | 294 | Phase-boundary replanning |
| `src/studio/goal-engine.ts` | 217 | Goal-based execution |
| `src/studio/cross-project-learning.ts` | 218 | Cross-project pattern extraction |
| `src/studio/model-router.ts` | 147 | Complexity-based model routing |
| `src/studio/budget-guard.ts` | ~80 | Cost circuit breaker |
| `src/studio/output-verifier.ts` | ~120 | Output artifact verification |
| `src/studio/test-gate.ts` | ~140 | Test execution gate |
| `src/studio/sandbox-manager.ts` | ~200 | Capability isolation |
| `src/studio/event-bus.ts` | ~250 | Event emission + PG LISTEN |
| `src/studio/job-queue.ts` | ~200 | Durable job queue |
| `scripts/init.sql` | ~2000 | Full 97-table schema |

---

*Report generated from direct codebase inspection. All claims verified against implementation, not documentation.*
