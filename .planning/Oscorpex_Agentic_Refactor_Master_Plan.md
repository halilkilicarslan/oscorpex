# Oscorpex Agentic Refactor Master Plan

Version: v1.0  
Date: 2026-04-20  
Audience: Founder, Tech Lead, Claude CLI execution workflow  
Scope: End-to-end refactor plan to evolve Oscorpex from a semi-agentic DAG orchestration platform into a controlled agentic software engineering platform.

---

## 1. Executive Summary

Oscorpex today is best understood as a **semi-agentic DAG-orchestrated development studio with CLI-delegated execution**, not a fully agentic platform. Its strongest foundation is the orchestration layer: DAG scheduling, review loops, model routing, edge types, and durable workflow persistence. Its weakest layer is true agency: named "agents" are mostly role-bound execution slots, not autonomous entities with goals, behavioral memory, dynamic planning, or negotiation. This framing is grounded in the architecture analysis of the codebase. fileciteturn1file0L1-L18

The correct strategy is **not** a full rewrite. The correct strategy is:

1. Stabilize the execution core and remove production hazards.
2. Add a real agent runtime on top of the current orchestration engine.
3. Evolve the static DAG into a dynamic coordination graph.
4. Add memory, inter-agent protocol, adaptive planning, and controlled autonomy.

This document is designed to be a single execution pack so the plan can be started in Claude without repeated replanning.

---

## 2. Current Reality

### 2.1 What Oscorpex is today

Oscorpex currently behaves as a:

- DAG-based task orchestration engine
- LLM-assisted planner and decomposer
- CLI-based execution dispatcher for Claude Code, Codex, and Cursor
- review / retry / escalation workflow manager
- stateful project execution backend with PostgreSQL persistence

This means the system already has serious infrastructure value. The orchestration core is not the problem. The problem is that agency is weak relative to the product vision. The analysis identifies the current “12-agent Scrum team” model as largely metaphorical, because agents mostly do not self-direct, negotiate, adapt, or learn across tasks. fileciteturn1file0L82-L109 fileciteturn1file0L270-L276

### 2.2 Strong foundations already present

The following are legitimate strengths and should be preserved:

- Kahn’s algorithm DAG orchestration with edge typing
- review loop as a first-class lifecycle
- model routing and provider fallback chain
- event bus with PG LISTEN/NOTIFY bridge
- policy engine already wired into task execution
- context retrieval store with FTS/RRF style retrieval
- durable PostgreSQL workflow state and analytics tables

These strengths were called out explicitly in the architecture analysis and should be treated as the permanent foundation of the platform. fileciteturn1file0L218-L229

---

## 3. Target State

## 3.1 Final target definition

The target system is:

**A controlled agentic orchestration platform for software engineering.**

It should support:

- goal-directed agents instead of purely task-directed executors
- dynamic graph mutation at runtime
- episodic and behavioral memory
- structured inter-agent coordination
- observation → reasoning → action loops
- human-in-the-loop control for high-risk actions
- bounded autonomy under governance policies

### 3.2 Design principle

The system must remain:

- deterministic where correctness matters
- agentic where exploration and decision-making matter
- auditable where production actions matter
- interruptible where humans need control

### 3.3 Strategic rule

Do not destroy the current DAG and task engine.

Instead:

- keep the DAG as the initial coordination substrate
- keep the current task lifecycle as the baseline execution model
- add an agent runtime capable of creating, modifying, and redirecting work
- gradually shift from static plan execution to adaptive coordination

---

## 4. Non-Negotiable Product Truths

1. **Orchestration is the moat.** The biggest value today is the coordination graph and lifecycle control, not the LLM wrappers.
2. **Agent labels are not enough.** A frontend_dev entry in the database is not a real agent.
3. **Memory must change behavior.** If memory only adds prompt context, it is retrieval, not memory.
4. **Autonomy without governance is a production incident waiting to happen.**
5. **Dynamic replanning is the threshold capability.** The system does not need full autonomy immediately, but it must be able to adapt its plan based on runtime outcomes.
6. **Safety fixes come before agentic ambition.** The current system still has material platform risks such as split-brain pipeline state, missing output verification, missing distributed dispatch lock, and inactive RLS. fileciteturn1file0L205-L217 fileciteturn1file0L230-L244

---

## 5. Master Gap List

The top gaps blocking the transition to a real agentic platform are:

1. No true agent autonomy
2. No dynamic replanning
3. No behavioral memory
4. No dynamic task injection
5. No inter-agent messaging that changes execution
6. No output verification gate
7. Split-brain pipeline state
8. No distributed lock in task dispatch
9. RLS not enabled for multi-tenancy
10. No budget circuit breaker
11. No graceful degraded mode on total provider failure
12. No hard verification that execution artifacts match claimed CLI output
13. No strategy selection per agent
14. No observation-action loop
15. No runtime graph mutation protocol

These findings align directly with the architectural analysis. fileciteturn1file0L245-L268

---

## 6. Transformation Overview

The transformation is split into three phases.

### Phase 1 — Stabilization and Production Hardening
Goal: make the current engine safe, deterministic, and operationally reliable.

### Phase 2 — Agentic Core Introduction
Goal: introduce real agent runtime capabilities while preserving the current orchestration foundation.

### Phase 3 — Dynamic Agentic Platform
Goal: evolve the system from static orchestration into adaptive, graph-mutating, goal-driven coordination.

---

## 7. Phase 1 — Stabilization and Production Hardening

Duration: 3–5 weeks  
Goal: remove architectural hazards before increasing autonomy.

### 7.1 Workstream A — Pipeline State Unification

#### Problem
The analysis highlights a split-brain risk because pipeline state exists both in-memory and in the database. A crash or failed persistence can produce divergence between the true workflow state and the hydrated state on restart. fileciteturn1file0L234-L239

#### Objective
Make PostgreSQL the single source of truth for pipeline state.

#### Required changes

- Deprecate or reduce the in-memory `_states` map to a read-through cache only.
- All state transitions must be persisted transactionally first.
- Runtime state hydration must always read from DB.
- Pipeline mutations must be done under row-level lock.

#### Implementation direction

- `pipeline-engine.ts`
- `task-engine.ts`
- `db/pipeline-runs.ts`
- `withTransaction()` helpers

#### Acceptance criteria

- Restarting the process never changes pipeline truth.
- State is reconstructible entirely from DB records.
- No pipeline action depends on process-local state for correctness.

---

### 7.2 Workstream B — Distributed Dispatch Locking

#### Problem
Dispatch race conditions can occur because readiness checks and assignment compete without a real distributed lock. The current guard is defensive but not authoritative. fileciteturn1file0L232-L237

#### Objective
Guarantee that only one worker can acquire and dispatch a task at a time.

#### Required changes

- Move ready-task acquisition behind DB locking.
- Use `SELECT ... FOR UPDATE SKIP LOCKED`.
- Prefer queue-backed task claiming for execution.
- Separate “task ready” from “task claimed” from “task running”.

#### Suggested schema updates

Add fields to `tasks` if missing:

```sql
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS claimed_by TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatch_attempts INT NOT NULL DEFAULT 0;
```

#### Acceptance criteria

- No duplicate task dispatch under concurrent workers.
- Dispatching remains safe under horizontal scaling.

---

### 7.3 Workstream C — Output Verification Gate

#### Problem
The analysis notes that CLI output is trusted too easily. The system may mark a task successful based on claimed file changes rather than verified filesystem state. fileciteturn1file0L241-L244

#### Objective
Verify that execution artifacts actually exist and match the expected result.

#### Required changes

Create a verification stage after execution and before completion:

- verify files exist
- verify modified files were actually changed
- optionally verify patch applies cleanly
- optionally verify generated file categories align with task intent

#### Module additions

- `output-verifier.ts`
- `artifact-inspector.ts`

#### Acceptance criteria

- Tasks cannot complete without verified artifacts.
- False positive completions are blocked.

---

### 7.4 Workstream D — Test Gate Integration

#### Problem
The analysis indicates the test runner exists but is not a mandatory completion gate. fileciteturn1file0L278-L286

#### Objective
Make test execution a first-class post-execution validation gate.

#### Required changes

- Route code-affecting tasks through `runTests()` or task-scoped test policies.
- Store test outcomes linked to task runs.
- Support test policies by task type:
  - required
  - optional warning
  - skip allowed

#### Suggested policy examples

- backend code task → required tests
- frontend styling task → optional smoke + typecheck
- infra task → config validation required

#### Acceptance criteria

- Code tasks cannot reach `done` without passing required gates.
- Failures push task into review/fix flow, not silent completion.

---

### 7.5 Workstream E — Cost Circuit Breaker

#### Problem
The current system emits budget signals but does not enforce an automatic stop condition when spend exceeds threshold. fileciteturn1file0L205-L217

#### Objective
Prevent runaway cost escalation caused by retries, review loops, and model tier bumps.

#### Required changes

- Add project-level spend caps.
- Add run-level spend caps.
- Add per-task retry-spend caps.
- Auto-pause pipeline on hard cap breach.
- Emit a human action request to resume.

#### Acceptance criteria

- Exceeding spend thresholds pauses further execution.
- Resume requires explicit human action or policy override.

---

### 7.6 Workstream F — Multi-Tenant Safety and RLS Activation

#### Problem
RLS policies may exist in SQL but are not enabled, leaving tenant isolation incomplete. fileciteturn1file0L205-L217

#### Objective
Make tenant isolation enforceable at the database layer.

#### Required changes

- Enable RLS for all tenant-scoped tables.
- Ensure `tenant_id` is present everywhere it should be.
- Apply `SET LOCAL app.tenant_id` in request transactions.
- Add tests proving cross-tenant reads fail.

#### Acceptance criteria

- Cross-tenant data leakage is impossible via accidental query omissions.
- All multi-tenant tests pass.

---

### 7.7 Workstream G — Graceful Provider Failure Handling

#### Problem
When all providers are exhausted or rate-limited, the system currently fails loudly without a durable degrade mode. The analysis flags this as a gap. fileciteturn1file0L240-L244

#### Objective
Introduce a provider-failure operating mode.

#### Required changes

- “deferred queue” for provider-blocked tasks
- global “degraded execution” state
- retry window scheduling
- operator-visible health summary per provider

#### Acceptance criteria

- Full provider exhaustion no longer causes chaotic failures.
- System safely pauses and recovers when providers return.

---

## 8. Phase 2 — Agentic Core Introduction

Duration: 5–8 weeks  
Goal: turn execution slots into bounded decision-making units.

### 8.1 New Core Concept — Agent Runtime

#### Definition
An agent is not just a role. An agent must have:

- goal
- local state
- tool access
- memory
- strategy selection
- observation loop
- governed action authority

#### New module group
Create a new core package:

```text
src/studio/agent-runtime/
  agent-runtime.ts
  agent-session.ts
  agent-strategy.ts
  agent-observer.ts
  agent-memory.ts
  agent-decision.ts
  agent-tools.ts
  agent-constraints.ts
  agent-protocol.ts
```

#### Principle
The current task engine remains the workflow skeleton. The new agent runtime becomes the reasoning and decision layer that sits between task acquisition and task completion.

---

### 8.2 Workstream H — Episodic and Behavioral Memory

#### Problem
The current memory layer is useful context, but not behavior-changing memory. The analysis explicitly classifies it as metadata/RAG rather than true memory. fileciteturn1file0L191-L204

#### Objective
Allow agents to learn from prior attempts and adjust strategy.

#### Memory model

Add a dedicated table:

```sql
CREATE TABLE IF NOT EXISTS agent_episodes (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  agent_id UUID NOT NULL,
  task_id UUID,
  task_type TEXT NOT NULL,
  strategy TEXT NOT NULL,
  action_summary TEXT NOT NULL,
  outcome TEXT NOT NULL,
  failure_reason TEXT,
  quality_score NUMERIC,
  cost NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Add derived patterns table:

```sql
CREATE TABLE IF NOT EXISTS agent_strategy_patterns (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  agent_role TEXT NOT NULL,
  task_type TEXT NOT NULL,
  strategy TEXT NOT NULL,
  success_rate NUMERIC NOT NULL,
  avg_cost NUMERIC,
  avg_quality NUMERIC,
  sample_count INT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### Runtime behavior
Before execution, an agent should retrieve:

- recent episodes for similar task type
- strongest successful strategy patterns
- high-confidence failure reasons to avoid

#### Acceptance criteria

- Agent prompts include behavioral lessons, not just factual context.
- Repeated similar failures decline over time.

---

### 8.3 Workstream I — Strategy-Based Agents

#### Problem
Today the system routes models, but agents do not choose among execution strategies.

#### Objective
Make agent behavior strategy-aware.

#### Strategy examples

For backend agent:

- `test_first`
- `scaffold_then_refine`
- `spec_contract_first`
- `minimal_patch`

For frontend agent:

- `component_first`
- `page_shell_then_wire`
- `design_system_first`

For QA agent:

- `risk_hotspot_review`
- `test_gap_review`
- `regression_path_review`

#### Required changes

Add agent strategies table:

```sql
CREATE TABLE IF NOT EXISTS agent_strategies (
  id UUID PRIMARY KEY,
  agent_role TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  default_prompt_addendum TEXT,
  allowed_task_types TEXT[] NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false
);
```

#### Acceptance criteria

- Each major role has 2–4 selectable strategies.
- Strategy selection is visible in task run records.

---

### 8.4 Workstream J — Observation → Reasoning → Action Loop

#### Problem
The current execution model is essentially fire-and-forget.

#### Objective
Give agents a looped runtime, not a one-shot execution call.

#### Runtime stages

1. Observe context
2. Choose strategy
3. Decide action
4. Execute tool call
5. Observe result
6. Decide next step or completion
7. Persist episode and outcome

#### Proposed run model

```text
agent_acquire_task
  -> load_context
  -> load_memory
  -> select_strategy
  -> plan_steps
  -> execute_step
  -> inspect_result
  -> either continue / request help / inject task / fail / complete
```

#### Acceptance criteria

- Agent can perform multiple bounded reasoning steps inside a task run.
- Multi-step agent behavior is auditable.

---

### 8.5 Workstream K — Dynamic Task Injection

#### Problem
The system cannot yet create meaningful new tasks during execution as a first-class runtime behavior. The analysis calls this a critical gap. fileciteturn1file0L245-L268

#### Objective
Allow running agents to create, propose, or request additional work.

#### New concepts

- `proposed_task`
- `injected_task`
- `task_request`
- `task_split`
- `task_dependency_patch`

#### Suggested tables

```sql
CREATE TABLE IF NOT EXISTS task_proposals (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  originating_task_id UUID,
  originating_agent_id UUID NOT NULL,
  proposal_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT,
  suggested_role TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### Policy model

Task injection can be:

- auto-approved for low-risk task types
- require approval for architecture/security/database changes
- denied if graph mutation is locked for the project

#### Acceptance criteria

- Agents can create sub-tasks and graph patches during execution.
- Policies govern whether injected tasks execute immediately.

---

### 8.6 Workstream L — Structured Inter-Agent Protocol

#### Problem
Existing messaging does not materially change execution behavior. The analysis flags this clearly. fileciteturn1file0L245-L268

#### Objective
Allow agents to request clarification, hand off structured artifacts, and negotiate dependencies.

#### Message types

- `request_info`
- `provide_info`
- `request_review`
- `dependency_warning`
- `handoff_artifact`
- `design_decision`
- `blocker_alert`
- `plan_adjustment_request`

#### Suggested schema

```sql
CREATE TABLE IF NOT EXISTS agent_protocol_messages (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  from_agent_id UUID NOT NULL,
  to_agent_id UUID,
  related_task_id UUID,
  message_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### Example payload

```json
{
  "type": "request_info",
  "topic": "api_contract",
  "question": "Confirm request and response shape for POST /auth/login",
  "needed_by_task_id": "..."
}
```

#### Acceptance criteria

- Agents can block or redirect execution based on structured messages.
- Important protocol messages become part of prompt context.

---

### 8.7 Workstream M — Human-in-the-Loop Governance Upgrade

#### Objective
Keep autonomy bounded while the agentic core expands.

#### Required controls

- approval categories by risk type
- max autonomous graph mutations per run
- approval for filesystem-wide refactors
- approval for schema-changing migrations
- approval for deployment actions

#### Acceptance criteria

- Human approval remains required for high-risk graph changes and production actions.
- Operator UI exposes why approval is required.

---

## 9. Phase 3 — Dynamic Agentic Platform

Duration: 8–14 weeks  
Goal: graduate from static workflow engine to adaptive software engineering platform.

### 9.1 Workstream N — Dynamic Coordination Graph

#### Problem
Current DAG topology is mostly built once, then executed with limited adaptation. The analysis labels the orchestration as graph-driven but largely static. fileciteturn1file0L111-L136

#### Objective
Enable graph mutation during execution.

#### Required capabilities

- insert node
- split task into children
- add dependency edge
- remove invalid edge
- defer branch
- open review branch
- open fix branch
- merge findings into future phase

#### New table

```sql
CREATE TABLE IF NOT EXISTS graph_mutations (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  pipeline_run_id UUID NOT NULL,
  caused_by_agent_id UUID,
  mutation_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### Acceptance criteria

- Graph changes are durable, auditable, and replayable.
- Pipeline can safely continue after graph mutation.

---

### 9.2 Workstream O — Adaptive Replanning

#### Objective
Re-evaluate future work after key outcomes.

#### Trigger points

- end of phase
- repeated review failure
- repeated provider/tool failure
- task injection exceeding threshold
- design decision drift

#### New process

- summarize current project state
- compare planned future graph with actual current state
- propose plan patch
- auto-apply low-risk patch / queue approval for high-risk patch

#### Acceptance criteria

- The system can revise future work without a full reset.
- Replanning produces auditable plan diffs.

---

### 9.3 Workstream P — Goal-Based Execution

#### Objective
Shift from “task as terminal command” to “goal as executable unit.”

#### Target model

A high-level work item becomes a goal package:

```json
{
  "goal": "Implement Google OAuth login for the application",
  "constraints": [
    "must use existing auth layer",
    "must include backend tests",
    "must not break email login"
  ],
  "success_criteria": [
    "user can log in with Google",
    "tests pass",
    "frontend flow handles auth errors"
  ]
}
```

The agent runtime decomposes within bounds and can request additional help.

#### Acceptance criteria

- Selected work types can execute as goals instead of rigid predefined tasks.
- Goal completion requires criteria validation, not only file changes.

---

### 9.4 Workstream Q — Sandbox and Capability Isolation

#### Objective
Protect the host environment as agent autonomy increases.

#### Required controls

- workspace isolation per task run or per agent session
- allowlisted tool set
- restricted filesystem scope
- network policy by project mode
- explicit elevated-capability tasks

#### Acceptance criteria

- Agents cannot operate with uncontrolled host access.
- Sensitive tasks run in isolated execution environments.

---

### 9.5 Workstream R — Cross-Project Learning

#### Objective
Extract reusable successful patterns without leaking tenant data.

#### Learning types

- successful strategy by task type
- stable execution sequence patterns
- common failure signatures
- low-cost high-quality model/strategy combinations

#### Guardrails

- no raw tenant code reuse
- patterns only, never source exfiltration
- tenant-local by default, global only if explicitly allowed and anonymized

#### Acceptance criteria

- The platform improves strategy selection over time.
- Learning remains privacy-safe.

---

## 10. New Architecture Blueprint

```text
[ API / UI / Operator Controls ]
              |
              v
      [ Governance Layer ]
  policies / approvals / budgets / risk rules
              |
              v
      [ Coordination Engine ]
 static DAG + dynamic graph mutations + replanning
              |
              v
        [ Agent Runtime ]
 sessions / strategies / memory / observation loop
              |
              v
      [ Tool Execution Layer ]
 Claude CLI / Codex / Cursor / tests / git / runtime tools
              |
              v
       [ Verification Layer ]
 artifact verification / tests / diff checks / policy checks
              |
              v
       [ Persistence Layer ]
 pipeline state / tasks / episodes / graph mutations / analytics
              |
              v
        [ Event / Telemetry ]
 event bus / audit / traces / operator visibility
```

---

## 11. Module-by-Module Refactor Map

### Existing modules to preserve

- `pipeline-engine.ts`
- `task-engine.ts`
- `execution-engine.ts`
- `event-bus.ts`
- `policy-engine.ts`
- `model-router.ts`
- `context-store.ts`
- `context-builder.ts`
- `cli-adapter.ts`
- `provider-state.ts`

### Existing modules to refactor

#### `pipeline-engine.ts`
Change from:
- static wave scheduler

Change to:
- static + mutable coordination graph engine
- supports graph mutations, branch insertion, and replanning hooks

#### `task-engine.ts`
Change from:
- lifecycle manager for tasks

Change to:
- lifecycle manager plus agent-session state machine integration
- task proposal and approval handling

#### `execution-engine.ts`
Change from:
- task dispatch and CLI execution

Change to:
- execution shell under agent runtime
- supports multi-step runs and observation loop

#### `context-packet.ts`
Change from:
- token-efficient prompt builder

Change to:
- layered context assembler:
  - task context
  - project facts
  - episodic memory
  - strategy rules
  - protocol messages

#### `cli-runtime.ts`
Change from:
- subprocess runner

Change to:
- step-aware execution stream processor
- structured result extraction
- artifact observation hooks

### New modules to build

- `agent-runtime/agent-runtime.ts`
- `agent-runtime/agent-session.ts`
- `agent-runtime/agent-memory.ts`
- `agent-runtime/agent-strategy.ts`
- `agent-runtime/agent-protocol.ts`
- `agent-runtime/agent-observer.ts`
- `graph-mutation-engine.ts`
- `replanning-engine.ts`
- `output-verifier.ts`
- `budget-guard.ts`
- `risk-classifier.ts`
- `approval-audit.ts`

---

## 12. Database Change Plan

Apply schema changes in this order.

### 12.1 Stabilization schema

- `tasks.claimed_by`
- `tasks.claimed_at`
- `tasks.dispatch_attempts`
- `pipeline_runs.version`
- `pipeline_runs.locked_at`
- `task_runs` if missing a normalized run table
- `verification_results`
- `approval_records`

Suggested verification table:

```sql
CREATE TABLE IF NOT EXISTS verification_results (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL,
  task_run_id UUID,
  verification_type TEXT NOT NULL,
  status TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 12.2 Agentic core schema

- `agent_episodes`
- `agent_strategy_patterns`
- `agent_strategies`
- `task_proposals`
- `agent_protocol_messages`
- `agent_sessions`

Suggested session table:

```sql
CREATE TABLE IF NOT EXISTS agent_sessions (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  agent_id UUID NOT NULL,
  related_task_id UUID,
  status TEXT NOT NULL,
  selected_strategy TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
```

### 12.3 Dynamic platform schema

- `graph_mutations`
- `plan_diffs`
- `goal_executions`
- `capability_grants`

---

## 13. Event Model Expansion

Current event infrastructure is a strength and should be extended rather than replaced. The analysis explicitly highlights the event bus plus PG bridge as one of the strongest decisions in the system. fileciteturn1file0L218-L224

### 13.1 New event families

- `agent:session_started`
- `agent:strategy_selected`
- `agent:requested_help`
- `agent:memory_written`
- `task:proposal_created`
- `task:proposal_approved`
- `graph:mutation_proposed`
- `graph:mutation_applied`
- `plan:replanned`
- `verification:passed`
- `verification:failed`
- `budget:halted`
- `provider:degraded`

### 13.2 Rules

- every graph mutation must emit an event
- every approval requirement must emit an event
- every strategy selection must be traceable
- every provider failure state transition must be explicit

---

## 14. Governance and Safety Framework

### 14.1 Risk classes

Define action risk levels:

- `low`: local code patch, docs update, test addition
- `medium`: endpoint implementation, config change, task injection within same phase
- `high`: DB schema change, auth changes, cross-module refactor, deployment action
- `critical`: deletion-heavy refactor, secrets manipulation, production release, infrastructure mutation

### 14.2 Approval policy matrix

| Action | Risk | Approval |
|---|---:|---|
| add low-risk subtask | low | auto |
| add dependency edge in same phase | medium | policy-based |
| introduce schema migration | high | required |
| deploy or merge release branch | critical | required |
| cross-project learning export | critical | required |

### 14.3 Agent capability grants

Capability tokens define what an agent may do inside a run:

- `can_propose_task`
- `can_inject_task_low_risk`
- `can_request_replan`
- `can_modify_graph_same_phase`
- `can_trigger_tests`
- `can_request_human_review`
- `can_commit_code`
- `can_open_deploy_request`

These should be project/policy controlled, not implicit in role names.

---

## 15. Claude CLI Execution Plan

This section is designed so you can use Claude to implement the plan in a controlled order.

### 15.1 Execution mode

Use Claude as an implementation partner, not as a replanning engine. Keep the plan stable and move step by step.

### 15.2 Recommended implementation order

#### Milestone 1 — Stabilization
1. unify pipeline state
2. add distributed dispatch lock
3. add output verification
4. wire test gate
5. add budget guard
6. enable and test RLS
7. add degraded provider mode

#### Milestone 2 — Agentic Core
8. add `agent_sessions`
9. add `agent_episodes`
10. add `agent_strategies`
11. build `agent-runtime/*`
12. integrate strategy selection into task execution
13. add task proposals and injection
14. add structured inter-agent protocol
15. add approval matrix for graph and task mutations

#### Milestone 3 — Dynamic Platform
16. add graph mutation engine
17. add replanning engine
18. introduce goal execution for selected work types
19. add sandbox/capability isolation
20. add cross-project pattern learning

### 15.3 Claude instruction template

Use this exact operating style with Claude:

```text
You are implementing against an already approved master architecture plan.
Do not redesign the system unless you find a hard implementation blocker.
For the current milestone:
1. inspect the relevant modules,
2. propose the minimal viable implementation that matches the plan,
3. list affected files,
4. implement in small coherent patches,
5. after each patch, explain what changed and what remains.
Do not broaden scope beyond the current milestone.
```

### 15.4 Milestone prompt template

```text
We are executing the Oscorpex Agentic Refactor Master Plan.
Current milestone: [INSERT MILESTONE NAME].
Goal: [INSERT GOAL].
Constraints:
- follow the approved plan
- avoid unrelated refactors
- preserve backward compatibility where practical
- prefer minimal coherent changes
Tasks:
1. inspect current relevant modules,
2. identify exact file changes,
3. propose an implementation sequence,
4. implement step by step,
5. add or update tests,
6. summarize completed work and next patch.
```

### 15.5 First Claude milestone to start with

Start with:

```text
Milestone: Pipeline State Unification
Goal: Make PostgreSQL the single source of truth for pipeline state and remove split-brain risk between in-memory and persisted pipeline state.
Relevant areas likely include pipeline-engine.ts, task-engine.ts, persistence helpers, pipeline_runs access, and restart recovery logic.
Implement the smallest coherent patch set that makes state transitions DB-authoritative.
```

---

## 16. Detailed Engineering Backlog

### Epic A — Stabilization

#### Story A1 — Pipeline DB-authoritative state
- remove correctness dependency on in-memory state map
- lock rows during mutation
- recover purely from DB on restart
- tests for restart consistency

#### Story A2 — Safe task claim and dispatch
- add claimed fields
- queue/claim with SKIP LOCKED
- tests for concurrent workers

#### Story A3 — Artifact verification
- add verifier module
- confirm file existence / change evidence
- connect verifier before completion
- tests for false-positive CLI output

#### Story A4 — Test gates
- map task type to required verification profile
- connect tests to completion logic
- persist test results

#### Story A5 — Budget guard
- track spend thresholds
- emit pause event
- require explicit resume

#### Story A6 — RLS enablement
- enable RLS
- tenant context propagation
- multi-tenant regression suite

#### Story A7 — Degraded provider mode
- project-level degraded status
- deferred retry queue
- resume workflow

### Epic B — Agentic Core

#### Story B1 — Agent sessions
- create session lifecycle
- persist selected strategy
- persist step-level decision log

#### Story B2 — Episodic memory
- write episode after each run
- query similar episodes pre-run
- integrate into prompt assembly

#### Story B3 — Strategy selection
- role-based strategies
- selection heuristics using memory + task type
- log chosen strategy

#### Story B4 — Multi-step runtime loop
- bounded step budget
- intermediate observation
- continue / request help / fail / complete

#### Story B5 — Task proposal/injection
- structured output contract
- proposal review
- graph insertion workflow

#### Story B6 — Inter-agent protocol
- request and response types
- message consumption into context
- blocker-aware routing

#### Story B7 — Approval governance
- risk classifier
- approval records
- UI reasons and audit

### Epic C — Dynamic Platform

#### Story C1 — Graph mutation engine
- durable mutation records
- validation rules
- replay support

#### Story C2 — Replanning engine
- trigger conditions
- project state summarization
- plan diff generation

#### Story C3 — Goal executions
- selected task classes execute as goals
- criteria validation

#### Story C4 — Capability isolation
- capability grants per run
- restricted execution scope

#### Story C5 — Cross-project pattern learning
- anonymized strategy patterns
- guarded opt-in

---

## 17. Testing Strategy

### 17.1 Test categories

- unit tests for new runtime modules
- integration tests for task claim, execution, verification, and completion
- concurrency tests for dispatch locking
- restart recovery tests for pipeline state
- policy tests for approvals and budget guards
- tenant isolation tests for RLS
- mutation tests for graph changes
- replay tests for events and graph mutation auditability

### 17.2 Must-have regression tests

1. duplicate task dispatch cannot occur under concurrency
2. false CLI success does not mark task done
3. failed tests block completion
4. budget breach pauses pipeline
5. provider exhaustion enters degraded mode instead of chaos
6. cross-tenant query leakage is blocked
7. graph mutation with denied approval cannot apply
8. strategy selection reads episodic memory
9. injected low-risk task can be auto-approved
10. injected high-risk mutation requires approval

---

## 18. Observability and Metrics

### 18.1 New metrics to add

- task claim latency
- duplicate dispatch prevention count
- verification failure rate
- strategy success rate by task type
- average retries before completion
- review rejection rate by role and strategy
- injected task volume per project
- graph mutation approval rate
- replan trigger frequency
- degraded-provider duration

### 18.2 Success metrics by phase

#### Phase 1 success metrics
- zero duplicate dispatches in test/staging
- zero false-success completions in verification suite
- pipeline state restart consistency proven
- budget pause works in staging
- RLS tests green

#### Phase 2 success metrics
- agents visibly choose strategies
- at least one role successfully adapts behavior based on memory
- structured inter-agent protocol influences execution path
- low-risk task injection works end to end

#### Phase 3 success metrics
- graph mutation works without corrupting pipeline state
- replanning updates future work after real runtime outcomes
- selected goals can execute without rigid predefined tasks

---

## 19. Delivery Sequence and Timeline

### Weeks 1–2
- state unification
- dispatch locking
- output verification skeleton

### Weeks 3–4
- test gates
- budget guard
- RLS enablement
- degraded mode

### Weeks 5–6
- agent sessions
- episodic memory
- strategy catalog

### Weeks 7–8
- multi-step runtime loop
- task proposals and injection
- structured inter-agent protocol

### Weeks 9–10
- graph mutation engine
- approval-aware graph patching

### Weeks 11–12
- replanning engine
- goal execution pilot

### Weeks 13+
- sandboxing
- learning system
- advanced operator controls

This sequence is intentionally conservative: production reliability first, autonomy second.

---

## 20. What Not To Do

1. Do not rewrite the entire backend.
2. Do not delete the current pipeline engine.
3. Do not chase “full autonomy” before governance.
4. Do not conflate more prompting with more agency.
5. Do not implement cross-project learning before tenant isolation is truly safe.
6. Do not let agents mutate graph state without audit trails.
7. Do not broaden milestone scope while Claude is implementing a patch.

---

## 21. Final Recommendation

The correct next action is to begin with **Milestone 1: Pipeline State Unification**.

This choice is justified because the architecture analysis shows that the most immediate operational hazard is split-brain state between in-memory and DB pipeline representations, followed closely by dispatch race conditions and unverified completion paths. Fixing these first creates a stable substrate for every later agentic capability. fileciteturn1file0L230-L244 fileciteturn1file0L278-L286

After Milestone 1 is done, move directly to:

- Safe task claim and dispatch
- Output verification
- Test gate integration

Only after those should the agent runtime begin.

---

## 22. Ready-to-Paste Kickoff Prompt for Claude

Use this first:

```text
We are executing the approved Oscorpex Agentic Refactor Master Plan.
Start with Milestone 1: Pipeline State Unification.

Goal:
Make PostgreSQL the single source of truth for pipeline state and remove split-brain risk between in-memory and persisted pipeline state.

Instructions:
- inspect the relevant modules first,
- identify exact files that own pipeline truth today,
- propose the smallest coherent implementation plan,
- implement in minimal safe patches,
- preserve existing behavior where possible,
- add or update tests for restart consistency and DB-authoritative transitions,
- after each patch, summarize completed work, remaining work, and any blocker.

Important constraints:
- do not redesign unrelated systems,
- do not broaden scope into agent runtime yet,
- keep changes aligned to the master plan,
- prefer DB-authoritative state over process-local truth.
```

Then follow the same pattern for each milestone in this document.

---

## 23. Final One-Line Positioning

Oscorpex should evolve from:

**“a semi-agentic DAG-orchestrated development studio”**

into:

**“a controlled agentic orchestration platform for software engineering, with dynamic coordination, behavioral memory, and governed autonomy.”**

