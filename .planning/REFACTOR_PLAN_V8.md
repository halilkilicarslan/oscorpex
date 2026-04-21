# Oscorpex v8.0 — Hardened Collaborative Autonomy Refactor Plan

**Date**: 2026-04-21
**Based on**: Implementation Truth Audit (`.planning/IMPLEMENTATION_TRUTH_AUDIT.md`)
**Vision**: Collaborative Autonomy — agents propose tasks, communicate bidirectionally, suggest graph changes, all under enforced governance
**Approach**: Incremental sprints. Preserve architecture. Strengthen step by step.

---

## Audit Corrections

Before planning, two audit findings were corrected during brainstorming:

| # | Audit Claim | Reality | Evidence |
|---|-------------|---------|----------|
| 1 | "Policy engine is COSMETIC — never called" | **WRONG** — Policy engine IS enforced | `task-engine.ts:219-240`: `evaluatePolicies()` called in `startTask()`. If `allowed: false`, task status → `"failed"` with `policyBlocked: true`. Try/catch wraps only crash-resilience, not the result. |
| 2 | "context-packet.ts is dead code — context-mode not implemented" | **PARTIALLY WRONG** — Context-mode IS natively implemented via 6 active modules | Audit focused only on `context-packet.ts` and missed the broader implementation. `context-store.ts`, `context-sandbox.ts`, `context-session.ts`, `context-builder.ts`, `vector-store.ts`, `document-indexer.ts` are ALL wired into execution-engine. Only `context-packet.ts` (token-budgeted assembly) is genuinely unwired. |

### Context-Mode Native Implementation — Verified Active

| Module | File | LOC | context-mode Equivalent | Wired? |
|--------|------|-----|------------------------|--------|
| FTS Knowledge Base | `context-store.ts` | 424 | `ctx_search` / FTS5 → PG tsvector + pg_trgm + RRF ranking | **YES** — used by context-sandbox, context-builder |
| Output Sandboxing | `context-sandbox.ts` | 184 | `ctx_execute` output sandbox → 3-tier (inline/compact/index) | **YES** — `execution-engine.ts:L1077` |
| Session Recovery | `context-session.ts` | 248 | Session continuity → event tracking + resume snapshot | **YES** — `execution-engine.ts:L1106` |
| Hybrid RAG | `context-builder.ts` + `vector-store.ts` | ~400 | `ctx_batch_execute` → pgvector semantic + FTS hybrid | **YES** — `execution-engine.ts:L1093` |
| Document Indexer | `document-indexer.ts` | ~200 | `ctx_index` / `ctx_fetch_and_index` | **YES** — standalone pipeline |
| Analytics | `context-analytics.ts` | 128 | `ctx_stats` → token savings, search efficiency | **YES** — metrics collected, routes TBD |
| Token-Budgeted Assembly | `context-packet.ts` | ~400 | Token budgets per prompt section | **NO** — `buildContextPacket()` has zero callers |
| Task Output Indexing | via `context-sandbox.ts` | — | Auto-index completed task outputs to FTS | **YES** — `task-engine.ts:L547` |

**Key differences from reference context-mode**:
- PostgreSQL (tsvector + pgvector + pg_trgm) instead of SQLite FTS5
- OpenAI embeddings (1536 dim) for hybrid RAG — reference has no embeddings
- 3 chunking algorithms (Markdown heading-aware, JSON recursive, plain text)
- RRF multi-layer ranking instead of simple FTS match
- Native TypeScript, directly wired into execution-engine — not a CLI plugin

**Updated safety score**: 6/9 enforced (was 5/9), 1/9 advisory, 2/9 cosmetic.

---

## Strategic Principles

1. **Enforcement before autonomy** — No agent gains new capabilities until existing safety claims are real
2. **Default-deny** — Sandbox, policies, constraints default to hard enforcement; relaxation requires explicit project-level override
3. **Incremental wiring** — Each sprint produces a shippable, testable increment
4. **Dead code honesty** — Remove what has no strategic future; integrate what does
5. **Collaborative, not autonomous** — Agents propose, system controls; humans approve medium+ risk

---

## Sprint Overview

```
Phase 1: Hard Enforcement (Sprints 1–3)
  Sprint 1: Sandbox Hard Enforcement
  Sprint 2: Constraints + Prompt Token Budget
  Sprint 3: RLS Hardening + Approval Timeout + Provider State Persistence

Phase 2: Cleanup + Learning Activation (Sprints 4–5)
  Sprint 4: Context-Mode Verification + Module Cleanup
  Sprint 5: Cross-Project Learning Activation + Output Verification Strictness

Phase 3: Collaborative Autonomy (Sprints 6–8)
  Sprint 6: Agent-Initiated Task Injection (Structured Output)
  Sprint 7: Bidirectional Protocol + Agent Graph Mutation Proposals
  Sprint 8: Goal Enforcement + Rich Observation Recording
```

---

## Phase 1: Hard Enforcement

### Sprint 1: Sandbox Hard Enforcement

**Objective**: Make sandbox enforcement real. Denied tools/paths block execution by default. Configurable per project.

**Rationale**: This is the single most dangerous gap — agents execute with unrestricted access while sandbox code creates false confidence.

#### Tasks

| # | Task | File(s) | Details |
|---|------|---------|---------|
| 1.1 | Add `enforcement_mode` to sandbox policy | `sandbox-manager.ts` | New field: `"hard"` (default) / `"soft"` / `"off"`. Hard = block execution on violation. Soft = log + warn + continue. |
| 1.2 | Wire `checkToolAllowed()` into CLI adapter pre-execution | `execution-engine.ts`, `cli-runtime.ts` | Before `adapter.execute()`, validate `allowedTools` against sandbox policy. If hard mode + denied tool → throw `SandboxViolationError`. |
| 1.3 | Wire `checkPathAllowed()` into post-execution verification | `execution-engine.ts` | After CLI returns, check `filesCreated`/`filesModified` paths against policy. Violations in hard mode → fail task. |
| 1.4 | Wire `checkOutputSize()` into output verification | `execution-engine.ts` | After CLI returns, check output size against policy limit. |
| 1.5 | Add project-level sandbox override | `sandbox-manager.ts`, `project-settings` | `project_settings` category `sandbox`, key `enforcement_mode`. Default: `"hard"`. Allows project-level relaxation. |
| 1.6 | Convert sandbox violations from advisory to actionable | `execution-engine.ts` | Hard mode violations: task fails → retry/escalation. Soft mode: warning event + continue. |
| 1.7 | Add sandbox enforcement tests | `__tests__/sandbox-enforcement.test.ts` | Test hard/soft/off modes. Test path blocking. Test tool blocking. Test project override. |

#### Files Changed
- `src/studio/sandbox-manager.ts` — Add enforcement_mode, update check functions to return severity
- `src/studio/execution-engine.ts` — Wire checks before/after CLI execution (~30 lines)
- `src/studio/__tests__/sandbox-enforcement.test.ts` — New test file

#### Risks
- **Breaking existing executions**: Hard enforcement may block legitimate operations if default policy is too strict
- **Mitigation**: Ship with `"soft"` as initial default, flip to `"hard"` after validation period; or provide a one-time migration that sets existing projects to `"soft"` while new projects default to `"hard"`

#### Acceptance Criteria
- [ ] `checkToolAllowed()` called before CLI execution; denied tool in hard mode → task fails
- [ ] `checkPathAllowed()` called after CLI execution; forbidden path in hard mode → task fails
- [ ] `checkOutputSize()` called after CLI execution
- [ ] Project-level `enforcement_mode` setting respected
- [ ] Soft mode: violations logged + event emitted, task continues
- [ ] Hard mode: violations block task, trigger retry/escalation flow
- [ ] All existing tests pass
- [ ] New tests: ≥10 covering hard/soft/off × tool/path/size scenarios

---

### Sprint 2: Agent Constraints Wiring + Prompt Token Budget

**Objective**: Wire `agent-constraints` into execution path. Add prompt token budget to prevent context window overflow.

#### Tasks

| # | Task | File(s) | Details |
|---|------|---------|---------|
| 2.1 | Wire `checkConstraints()` into execution-engine pre-dispatch | `execution-engine.ts` | Before `executeTask()` proceeds past claiming, call `checkConstraints()` for the task's risk level. If constraints violated in hard mode → block. |
| 2.2 | Wire `classifyRisk()` into task metadata | `task-engine.ts` | On task creation, auto-classify risk level and store in task record. Currently only called from HTTP API. |
| 2.3 | Integrate `context-packet.ts` token budgeting into prompt assembly | `execution-engine.ts`, `context-packet.ts` | Wire `buildContextPacket()` into `buildTaskPrompt()` or extract its token budgeting logic into the existing prompt builder. Use per-section token limits (projectDescription: 2K, planSummary: 6K, taskDescription: 5K, acceptanceCriteria: 2K). If total exceeds model context × 0.7, truncate behavioral/protocol sections. This integrates the currently-unwired context-packet module instead of deleting it. |
| 2.4 | Add model context limits map | `model-router.ts` | Map model IDs to context window sizes. Used by token budget enforcement. |
| 2.5 | Add constraint enforcement tests | `__tests__/constraint-enforcement.test.ts` | Test risk classification integration, constraint blocking, prompt budget truncation. |

#### Files Changed
- `src/studio/execution-engine.ts` — Wire constraints check + token budget (~40 lines)
- `src/studio/context-packet.ts` — Integrate into prompt assembly or extract budgeting logic (~30 lines refactor)
- `src/studio/task-engine.ts` — Auto-classify risk on task creation (~10 lines)
- `src/studio/model-router.ts` — Context window limits map (~15 lines)
- `src/studio/agent-runtime/agent-constraints.ts` — No changes (already implemented)
- `src/studio/__tests__/constraint-enforcement.test.ts` — New test file

#### Risks
- **Prompt truncation quality**: Aggressive truncation may remove important behavioral context
- **Mitigation**: Truncation priority order: protocol messages (oldest first) → behavioral memory (oldest episodes) → strategy addendum (never truncated). Leverage existing `context-packet.ts` per-section budgets.

#### Acceptance Criteria
- [ ] `classifyRisk()` called on task creation, risk level stored in task record
- [ ] `checkConstraints()` called before task execution; violations in hard mode → block
- [ ] Prompt token budget enforced: oversized prompts truncated before CLI execution
- [ ] Truncation follows priority order (protocol → memory → never strategy)
- [ ] New tests: ≥8 covering constraint enforcement + token budget scenarios

---

### Sprint 3: RLS Hardening + Approval Timeout + Provider State Persistence

**Objective**: Harden multi-tenant isolation. Add approval timeout. Persist provider state across restarts.

#### Tasks

| # | Task | File(s) | Details |
|---|------|---------|---------|
| 3.1 | Fix RLS backward-compat hole | `scripts/init.sql` | When `OSCORPEX_AUTH_ENABLED=true`: change RLS policies from `tenant_id IS NULL OR ...` to `tenant_id = current_setting(...)` only. Backward-compat (`tenant_id IS NULL`) allowed ONLY when auth is disabled. |
| 3.2 | Verify tenant context set in all DB paths | `src/studio/db/pg.ts`, auth middleware | Audit all query paths. Ensure `SET LOCAL app.current_tenant_id` is called in every transaction when auth is enabled. Add assertion/guard if missing. |
| 3.3 | Add approval timeout with escalation | `task-engine.ts` | New config: `approval_timeout_hours` (default: 24). Cron or event-based check: tasks in `waiting_approval` longer than timeout → auto-escalate (notify + optional auto-reject). |
| 3.4 | Add approval timeout notification | `task-engine.ts`, `event-bus.ts` | Emit `task:approval_timeout` event at 80% of timeout. Emit `task:approval_expired` at 100%. |
| 3.5 | Persist provider state to DB | `provider-state.ts`, `scripts/init.sql` | New table `provider_state` (provider_name, status, rate_limited_until, failure_count, last_success). Load on startup, persist on state change. |
| 3.6 | Add RLS isolation tests | `__tests__/rls-hardening.test.ts` | Test cross-tenant isolation with auth enabled. Test backward-compat when auth disabled. |

#### Files Changed
- `scripts/init.sql` — RLS policy update + `provider_state` table (~30 lines)
- `src/studio/db/pg.ts` — Tenant context guard (~15 lines)
- `src/studio/task-engine.ts` — Approval timeout logic (~40 lines)
- `src/studio/provider-state.ts` — DB persistence (~50 lines)
- Auth middleware — Tenant context verification (~10 lines)

#### Risks
- **RLS policy change breaks existing queries**: Queries without tenant context will fail when auth enabled
- **Mitigation**: Only enforce strict RLS when `OSCORPEX_AUTH_ENABLED=true`. Single-tenant mode unchanged.

#### Acceptance Criteria
- [ ] With auth enabled: `tenant_id IS NULL` rows NOT accessible (strict isolation)
- [ ] With auth disabled: backward-compat maintained
- [ ] Approval timeout: tasks waiting > 24h emit timeout event
- [ ] Approval timeout: configurable via project_settings
- [ ] Provider state persists across process restarts
- [ ] Provider cooldowns restored from DB on startup
- [ ] New tests: ≥8 covering RLS isolation + approval timeout + provider persistence

---

## Phase 2: Cleanup + Learning Activation

### Sprint 4: Context-Mode Verification + Module Cleanup

**Objective**: Verify context-mode native implementation completeness. Clean up remaining dead code. Expose analytics.

#### Decisions

| Module | Decision | Rationale |
|--------|----------|-----------|
| `context-packet.ts` | **INTEGRATE** (Sprint 2) | Not dead code — contains valuable token budgeting logic (per-section limits, mode-based assembly). Will be wired into prompt building in Sprint 2.3. Other context-mode modules (`context-store`, `context-sandbox`, `context-session`, `context-builder`) are already active. |
| Job queue (`job-repo.ts`, `job-queue.ts`) | **KEEP but DEFER integration** | Schema and implementation are solid. May be needed for Phase 3 (async task injection dispatch). Don't remove, don't wire yet. Mark as "reserved for Sprint 6+". |
| `cross-project-learning.ts` | **INTEGRATE** (Sprint 5) | Strategically important for Collaborative Autonomy. Extraction + consumption pipeline needed. |
| VoltAgent agents (assistant, researcher, etc.) | **KEEP** | Not in studio execution path but provide framework scaffolding. Low maintenance burden. |

**Note**: No modules are deleted in this sprint. Context-mode native implementation (6 active modules + 1 to be integrated in Sprint 2) is preserved and strengthened.

#### Tasks

| # | Task | File(s) | Details |
|---|------|---------|---------|
| 4.1 | Verify context-mode integration completeness | All `context-*.ts` files | Audit that all 7 context-mode modules are correctly wired. Verify `context-store.ts` FTS indexes exist in init.sql. Verify `context-sandbox.ts` output classification thresholds are appropriate. |
| 4.2 | Add `@reserved` JSDoc to job-queue module | `src/studio/job-queue.ts`, `src/studio/db/job-repo.ts` | Mark as reserved for future Sprint 6+ integration. Prevents accidental deletion. |
| 4.3 | Audit all `as any` casts remaining | Codebase-wide | Previous sprints eliminated 25+. Find and fix any remaining unsafe casts. |
| 4.4 | Add context-analytics routes | `routes/`, `context-analytics.ts` | Expose token savings and search efficiency metrics via API. Currently metrics collected but no routes. |
| 4.5 | Run full test suite validation | All test files | Ensure no regressions from cleanup. |

#### Acceptance Criteria
- [ ] All 7 context-mode modules verified as wired (6 active + context-packet integrated in Sprint 2)
- [ ] Context-analytics metrics accessible via API endpoint
- [ ] Job queue module preserved with `@reserved` annotation
- [ ] Zero `as any` casts in studio modules (or documented exceptions)
- [ ] Full test suite passes: backend + frontend

---

### Sprint 5: Cross-Project Learning Activation + Output Verification Strictness

**Objective**: Activate cross-project learning pipeline. Strengthen output verification.

#### Tasks

| # | Task | File(s) | Details |
|---|------|---------|---------|
| 5.1 | Auto-extract patterns on episode recording | `agent-session.ts`, `cross-project-learning.ts` | After `recordEpisode()` in `completeSession()`/`failSession()`, trigger `extractPatternsFromEpisodes()` for the agent's role + task type. Non-blocking (.catch). |
| 5.2 | Wire learning patterns into strategy selection | `agent-strategy.ts`, `cross-project-learning.ts` | In `selectStrategy()`, after checking `getBestStrategies()`, also consult `getLearningPatterns()` for cross-project insights. Merge scores with a decay weight (project-local patterns weighted 2x vs cross-project). |
| 5.3 | Add pattern promotion threshold | `cross-project-learning.ts` | Patterns with ≥10 samples and ≥70% success auto-promote to global. Emit `learning:pattern_promoted` event. |
| 5.4 | Strengthen output verification | `output-verifier.ts`, `execution-engine.ts` | New config: `verification_strictness` (default: `"strict"`). Strict mode: file existence failures are hard fails (not just warnings). Lenient mode: current behavior (warnings only). |
| 5.5 | Add verification strictness to project settings | `output-verifier.ts` | Read from `project_settings` category `verification`, key `strictness`. |
| 5.6 | Add learning + verification tests | `__tests__/` | Test auto-extraction trigger, pattern consumption in strategy selection, promotion threshold, strict verification. |

#### Files Changed
- `src/studio/agent-session.ts` — Trigger extraction after episode recording (~10 lines)
- `src/studio/agent-strategy.ts` — Consult learning patterns (~20 lines)
- `src/studio/cross-project-learning.ts` — Add promotion threshold logic (~15 lines)
- `src/studio/output-verifier.ts` — Add strictness config (~15 lines)
- `src/studio/execution-engine.ts` — Respect strictness setting (~5 lines)

#### Acceptance Criteria
- [ ] Episode recording triggers pattern extraction automatically
- [ ] `selectStrategy()` consults cross-project patterns (weighted merge)
- [ ] Patterns with ≥10 samples, ≥70% success auto-promote
- [ ] Strict verification: file existence failures are hard fails
- [ ] Project-level verification strictness configurable
- [ ] New tests: ≥10 covering extraction trigger, pattern consumption, promotion, strict mode

---

## Phase 3: Collaborative Autonomy

### Sprint 6: Agent-Initiated Task Injection

**Objective**: Enable agents to propose new tasks during execution via structured output. Proposals flow through approval pipeline.

**Architecture Decision**: Agents propose tasks via **structured output markers** in CLI response, not via HTTP calls. Execution-engine parses CLI output for task proposals.

#### Tasks

| # | Task | File(s) | Details |
|---|------|---------|---------|
| 6.1 | Define task proposal output format | `cli-runtime.ts` | Agents can emit `<!-- TASK_PROPOSAL: {...json} -->` markers in their output. Parser extracts proposals from CLI response. |
| 6.2 | Add proposal extraction to CLI output parser | `cli-runtime.ts` | After parsing stream-json, scan for `TASK_PROPOSAL` markers. Extract and validate against schema. |
| 6.3 | Wire extracted proposals to task-injection | `execution-engine.ts`, `task-injection.ts` | After CLI execution, for each extracted proposal: call `proposeTask()` → risk classification → auto-approve if low-risk + capability check passes. |
| 6.4 | Add proposal instructions to agent prompts | `execution-engine.ts` | Add system prompt section explaining how agents can propose tasks. Include format, constraints, and examples. |
| 6.5 | Wire capability enforcement gate | `task-injection.ts`, `agent-constraints.ts` | Before proposal approval: `checkConstraints()` + `hasCapability()`. Reject if agent lacks capability for proposed action. |
| 6.6 | Add approved task dispatch | `task-injection.ts`, `task-engine.ts` | Approved proposals → create actual task in DB → add to current/next phase → `dispatchReadyTasks()` picks it up. |
| 6.7 | Add task injection tests | `__tests__/task-injection-e2e.test.ts` | Test proposal extraction, risk classification, auto-approval, capability gate, task creation, dispatch. |

#### Files Changed
- `src/studio/cli-runtime.ts` — Proposal marker parsing (~40 lines)
- `src/studio/execution-engine.ts` — Wire proposal extraction + dispatch (~30 lines)
- `src/studio/task-injection.ts` — Wire to actual task creation (~20 lines)
- `src/studio/__tests__/task-injection-e2e.test.ts` — New test file

#### Risks
- **Proposal spam**: Agents may propose excessive/unnecessary tasks
- **Mitigation**: Rate limit per agent per execution (max 3 proposals). Require `proposalType` matching agent role.
- **Prompt injection via proposals**: Malicious task descriptions could manipulate downstream agents
- **Mitigation**: Sanitize proposal content. Proposals inherit parent task's sandbox policy.

#### Acceptance Criteria
- [ ] Agents can emit `TASK_PROPOSAL` markers in CLI output
- [ ] Execution-engine extracts and validates proposals
- [ ] Low-risk proposals auto-approved if agent has capability
- [ ] Medium+ risk proposals queued for human approval
- [ ] Approved proposals create real tasks in DB
- [ ] Created tasks dispatched on next `dispatchReadyTasks()` cycle
- [ ] Rate limit: max 3 proposals per agent per execution
- [ ] New tests: ≥12 covering extraction, classification, approval, dispatch

---

### Sprint 7: Bidirectional Protocol + Agent Graph Mutation Proposals

**Objective**: Enable agents to send messages during execution and propose graph mutations. All proposals go through approval pipeline.

#### Tasks

| # | Task | File(s) | Details |
|---|------|---------|---------|
| 7.1 | Define protocol message output format | `cli-runtime.ts` | Agents can emit `<!-- AGENT_MESSAGE: {...json} -->` markers. Types: request_info, blocker_alert, handoff_artifact, design_decision. |
| 7.2 | Add message extraction to CLI output parser | `cli-runtime.ts` | Parse `AGENT_MESSAGE` markers alongside `TASK_PROPOSAL` markers. |
| 7.3 | Wire extracted messages to agent-protocol | `execution-engine.ts`, `agent-protocol.ts` | After CLI execution, for each extracted message: call `sendMessage()` → persist to DB → emit event. Target agent sees message in next execution's `loadProtocolContext()`. |
| 7.4 | Add blocking message semantics | `agent-protocol.ts`, `execution-engine.ts` | If agent sends `blocker_alert` targeting another agent's pending task: mark target task as `blocked` status until blocker resolved. |
| 7.5 | Define graph mutation proposal format | `cli-runtime.ts` | Agents can emit `<!-- GRAPH_MUTATION: {...json} -->` markers. Types: insert_node, add_edge, defer_branch. |
| 7.6 | Wire graph mutation proposals to approval pipeline | `execution-engine.ts`, `graph-coordinator.ts` | Extracted mutations → risk classify → low-risk (add_edge) auto-apply → medium+ (insert_node, defer_branch) queue for approval. |
| 7.7 | Add protocol + graph mutation tests | `__tests__/collaborative-autonomy.test.ts` | Test message extraction, blocking semantics, graph mutation proposals, approval routing. |

#### Files Changed
- `src/studio/cli-runtime.ts` — Message + mutation marker parsing (~30 lines)
- `src/studio/execution-engine.ts` — Wire extraction + dispatch (~40 lines)
- `src/studio/agent-protocol.ts` — Blocking semantics for blocker_alert (~25 lines)
- `src/studio/graph-coordinator.ts` — Proposal approval routing (~20 lines)
- `src/studio/__tests__/collaborative-autonomy.test.ts` — New test file

#### Risks
- **Coordination deadlocks**: Agent A blocks Agent B, Agent B blocks Agent A
- **Mitigation**: Deadlock detection: if mutual block detected, auto-escalate both to tech-lead
- **Graph mutation corruption**: Bad mutation proposals could break DAG structure
- **Mitigation**: All mutations validated against DAG constraints before application. Circular dependency check.

#### Acceptance Criteria
- [ ] Agents can send protocol messages during execution
- [ ] Messages persist to DB and appear in target agent's next execution prompt
- [ ] `blocker_alert` blocks target agent's pending tasks until resolved
- [ ] Deadlock detection: mutual blocks → auto-escalation
- [ ] Agents can propose graph mutations during execution
- [ ] Low-risk mutations (add_edge) auto-applied
- [ ] Medium+ mutations queued for human approval
- [ ] DAG constraint validation prevents corrupting mutations
- [ ] New tests: ≥15 covering messages, blocking, deadlocks, mutations, approval

---

### Sprint 8: Goal Enforcement + Rich Observation Recording

**Objective**: Make goals enforcement-grade. Record rich observations for deeper learning.

#### Tasks

| # | Task | File(s) | Details |
|---|------|---------|---------|
| 8.1 | Replace keyword heuristic with LLM-based goal validation | `goal-engine.ts` | After task completion, use a lightweight LLM call (Haiku) to validate output against success criteria. Structured output: `{criteria: [{criterion, met, evidence, confidence}]}`. |
| 8.2 | Make goal failure actionable | `goal-engine.ts`, `execution-engine.ts` | New config: `goal_enforcement` (default: `"enforce"`). Enforce mode: goal failure → task enters `revision` status for re-execution. Advisory mode: current behavior (record only). |
| 8.3 | Wire `recordStep()` into execution | `agent-session.ts`, `execution-engine.ts` | Record meaningful steps during execution: strategy selected, prompt built, CLI started, output received, verification result, test result, goal result. Creates rich observation timeline. |
| 8.4 | Add step-based behavioral context | `agent-memory.ts` | Enhance `loadBehavioralContext()` to include step-level observations from past episodes, not just outcomes. Agents see "what went wrong at which step" for similar past tasks. |
| 8.5 | Add strategy effectiveness tracking | `agent-strategy.ts` | Track not just success/failure but quality score per strategy. Strategies with low quality but high success get deprioritized vs strategies with both high quality and success. |
| 8.6 | Add goal enforcement + observation tests | `__tests__/goal-enforcement.test.ts` | Test LLM-based validation, enforcement mode, step recording, step-based behavioral context. |

#### Files Changed
- `src/studio/goal-engine.ts` — LLM validation + enforcement config (~60 lines)
- `src/studio/execution-engine.ts` — Wire goal enforcement + step recording (~30 lines)
- `src/studio/agent-session.ts` — Add step recording calls (~20 lines)
- `src/studio/agent-memory.ts` — Step-based behavioral context (~25 lines)
- `src/studio/agent-strategy.ts` — Quality-weighted scoring (~15 lines)

#### Risks
- **LLM validation cost**: Extra Haiku call per task adds cost
- **Mitigation**: Only call LLM validation when task has explicit goals. Skip for tasks without goals.
- **Goal enforcement false positives**: LLM may incorrectly assess goal as unmet
- **Mitigation**: Confidence threshold (≥0.7) required for enforcement. Low-confidence results → advisory.

#### Acceptance Criteria
- [ ] Goal validation uses LLM (Haiku) instead of keyword heuristic
- [ ] Enforce mode: goal failure (confidence ≥0.7) → task enters revision
- [ ] Advisory mode: goal failure → record only
- [ ] `recordStep()` called at 6+ meaningful points during execution
- [ ] `loadBehavioralContext()` includes step-level observations from past episodes
- [ ] Strategy effectiveness tracks quality score alongside success rate
- [ ] New tests: ≥10 covering LLM validation, enforcement, step recording, quality tracking

---

## Summary: Sprint Dependency Graph

```
Sprint 1 (Sandbox)       ──┐
Sprint 2 (Constraints)   ──┤── Phase 1 complete
Sprint 3 (RLS/Timeout)   ──┘
                              ↓
Sprint 4 (Dead Code)     ──┐
Sprint 5 (Learning)       ──┤── Phase 2 complete
                              ↓
Sprint 6 (Task Injection) ──┐
Sprint 7 (Protocol/Graph) ──┤── Phase 3 complete
Sprint 8 (Goals/Observe)  ──┘
```

Sprints within a phase can run in parallel where dependencies allow:
- Sprint 1, 2, 3 are independent — can parallelize
- Sprint 4, 5 are independent — can parallelize
- Sprint 6 must complete before Sprint 7 (structured output parsing shared)
- Sprint 8 is independent of 6 and 7

---

## Estimated Scope

| Phase | Sprints | Files Changed | New Lines (est.) | New Tests (est.) |
|-------|---------|---------------|------------------|-----------------|
| Phase 1 | 3 | ~12 files | ~250 lines | ~26 tests |
| Phase 2 | 2 | ~8 files | ~120 lines | ~20 tests |
| Phase 3 | 3 | ~15 files | ~350 lines | ~37 tests |
| **Total** | **8** | **~35 files** | **~720 lines** | **~83 tests** |

---

## Post-v8.0 Backlog (Not in Scope)

These items are identified but intentionally deferred:

| Item | Reason for Deferral |
|------|-------------------|
| Multi-process distributed execution | Requires fundamental architecture change. Current single-process with DB locking is sufficient for v8.0 scope. |
| Real containerization enforcement | Docker isolation is optional and working. Mandatory containerization requires ops infrastructure. |
| Strategy A/B testing framework | Nice-to-have after Sprint 8 learning improvements are validated. |
| Prompt effectiveness tracking | Requires data collection before meaningful analysis. Run Sprint 8 first, measure later. |
| Job queue integration for async dispatch | Reserved for when async task injection (Sprint 6) needs durable queue semantics. |
| Agent self-assessment before completion | Depends on Sprint 8 goal enforcement + rich observations being proven. |
| Formal state machine library | Current application-level state guards work. Formalize only if edge-case bugs emerge. |

---

## Risk Matrix

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Sandbox hard enforcement breaks existing projects | Medium | High | Default to `"soft"` initially, flip to `"hard"` after validation. Migration sets existing projects to `"soft"`. |
| RLS strict mode breaks queries without tenant context | Low | High | Only enforce when `OSCORPEX_AUTH_ENABLED=true`. Comprehensive test coverage. |
| Task injection proposal spam | Medium | Medium | Rate limit (3/agent/execution). Role-matching required. |
| Protocol deadlocks (mutual blocking) | Low | Medium | Auto-detection + escalation. Timeout on blocks. |
| LLM goal validation cost | Low | Low | Only for tasks with explicit goals. Haiku pricing is minimal. |
| Prompt token truncation removes important context | Medium | Medium | Priority-ordered truncation. Never truncate strategy addendum. |

---

## Success Metrics

After v8.0 completion:

| Metric | Target |
|--------|--------|
| Safety controls enforced | 9/9 (from 6/9) |
| Dead code modules | 0 (from 1: dormant cross-project learning) |
| Context-mode modules wired | 7/7 (from 6/7 — context-packet integrated in Sprint 2) |
| Agent capabilities with runtime activation | 9/9 (from 4/9) |
| Agentic maturity score | ≥70/100 (from ~50/100) |
| Test coverage for enforcement paths | 100% of safety gates have blocking tests |
| Collaborative features | Task injection + bidirectional protocol + graph proposals |

---

*End of Refactor Plan*
