# Oscorpex — Deep Architectural Analysis

> Generated: 2026-04-20 | Analyst perspective: Senior Staff Engineer (Agentic Systems)
> Based on: Full source code inspection (not README claims)

---

## 1. What This System Actually Is

**Classification: Semi-Agentic DAG-Orchestrated Development Studio with CLI-Delegated Execution**

Oscorpex is a **pipeline orchestration platform** that coordinates AI-powered code generation through external CLI tools (Claude Code, Codex, Cursor). It is **not** a multi-agent system in the academic sense — it is a **role-based task dispatch engine** where "agents" are named execution slots with role metadata, not autonomous entities with goals, planning, or self-direction.

The system's real intelligence lives in three places:
1. **PM Agent** — An LLM call (via Vercel AI SDK `generateObject`) that produces a structured plan from user requirements
2. **Task Decomposer** — An LLM call that breaks L/XL tasks into micro-tasks (with heuristic fallback)
3. **External CLI tools** — The actual code generation happens entirely outside Oscorpex, in spawned Claude Code / Codex / Cursor processes

Everything else — pipeline progression, task lifecycle, review loops, edge hooks — is **deterministic orchestration logic**, well-engineered but not agentic.

**In implementation terms**: This is a **Hono-based backend** (port 3141) with a **React 19 frontend** (port 5173), backed by **PostgreSQL** (66 tables), that manages a DAG pipeline of tasks dispatched to CLI subprocesses. It's closer to a CI/CD pipeline engine with LLM-powered planning than to a true multi-agent framework.

---

## 2. Repository Architecture Map

### Scale
| Metric | Count |
|--------|-------|
| Backend source files (non-test) | ~90 |
| Frontend source files | ~122 |
| Backend test cases | ~921 |
| Frontend test cases | ~514 |
| PostgreSQL tables | 66 |
| Route sub-routers | 28 |
| DB repo modules (barrel) | 28 |
| Runtime dependencies | 20 |

### Core Backend Modules (`src/studio/`)

| Module | Role | LOC (approx) |
|--------|------|---------------|
| `execution-engine.ts` | Task dispatch → CLI spawn, concurrency control (Semaphore), timeout, abort | ~500 |
| `task-engine.ts` | Task lifecycle state machine, review loops, fallback/escalation edges | ~600 |
| `pipeline-engine.ts` | DAG orchestrator (Kahn's algo), phase progression, pause/resume/retry | ~700 |
| `pm-agent.ts` | LLM-powered requirements analysis + plan generation (VoltAgent tool) | ~400 |
| `event-bus.ts` | In-process pub/sub + PG LISTEN/NOTIFY bridge with dedup | ~150 |
| `model-router.ts` | Complexity-based model selection (S/M/L/XL → Haiku/Sonnet/Opus), provider-aware | ~200 |
| `context-packet.ts` | Token-efficient prompt assembly with mode-based context | ~300 |
| `context-store.ts` | FTS content indexing (tsvector + pg_trgm), chunking algorithms | ~350 |
| `context-builder.ts` | RAG + FTS hybrid search for prompt context | ~200 |
| `cli-adapter.ts` | Multi-CLI adapter pattern (Claude/Codex/Cursor), fallback chain | ~250 |
| `cli-runtime.ts` | Raw CLI subprocess spawn, output parsing, rate-limit detection | ~300 |
| `task-decomposer.ts` | AI Scrum Master (generateObject + Zod) + heuristic fallback | ~350 |
| `policy-engine.ts` | Built-in + custom policy rules, block/warn/require_approval | ~200 |
| `edge-hooks.ts` | Notification/mentoring/handoff/approval runtime side-effects | ~200 |
| `team-architect.ts` | AI-powered team composition from templates | ~300 |
| `lifecycle-manager.ts` | Project state machine (planning→approved→running→completed) | ~150 |
| `ceremony-engine.ts` | Standup/retrospective generation from event data | ~250 |
| `sprint-manager.ts` | Sprint CRUD + burndown + velocity | ~200 |
| `job-queue.ts` | pg-boss style durable queue (SELECT FOR UPDATE SKIP LOCKED) | ~250 |
| `plugin-registry.ts` | Manifest-based plugin system with hook filtering + timeout | ~200 |
| `shared-state.ts` | InMemory state provider (Redis stub for future) | ~200 |
| `telemetry.ts` | Lightweight OTel-compatible tracing (CircularBuffer, W3C traceparent) | ~300 |
| `cost-optimizer.ts` | Efficiency scoring (successRate*0.6 + costScore*0.4) | ~200 |
| `provider-state.ts` | Per-provider rate limit/cooldown/failure tracking | ~150 |
| `app-runner.ts` | Runs generated apps, port management (5173/4242/3142) | ~300 |
| `collaboration.ts` | In-memory presence tracking, auto-cleanup | ~200 |

### Persistence Layer (`src/studio/db/`)
- 28 repo modules re-exported through `db/index.ts` barrel
- Raw SQL queries via `pg.ts` helpers (`query`, `queryOne`, `execute`, `withTransaction`)
- No ORM — direct parameterized SQL throughout
- Schema: `scripts/init.sql` (idempotent with `IF NOT EXISTS`)

### Auth Layer (`src/studio/auth/`)
- JWT (HMAC-SHA256, `node:crypto`), scrypt password hashing
- Tri-mode auth middleware (env key / JWT / DB `osx_` key)
- RBAC: 5 roles (owner, admin, developer, viewer, billing), wildcard permissions
- Tenant isolation via `tenant_id` columns + RLS policies (defined, not enabled)

### Frontend (`console/`)
- React 19 + Vite + Tailwind 4 + React Router
- ~36 studio pages, modular API client (17 files)
- WebSocket event refresh (`useWsEventRefresh`), pagination (`useInfiniteList`)
- 4 Recharts chart components (lazy-loaded)

### Integration Boundaries
- **VoltAgent**: Entry point wrapper only — Oscorpex runs independently as Hono server
- **Vercel AI SDK**: Used for `generateObject` in PM agent + task decomposer only
- **PostgreSQL**: All state, no Redis/queue in production (SharedState Redis is a stub)
- **CLI subprocesses**: The actual AI execution boundary — Oscorpex never calls LLM APIs directly for code generation

---

## 3. Agent Model Assessment

### What "Agents" Actually Are

In Oscorpex, an "agent" is a **row in the `project_agents` table** with:
- `role` (pm, tech_lead, frontend_dev, backend_dev, qa, security, devops, etc.)
- `cli_tool` (claude-code, codex, cursor)
- `config` (JSON blob with capabilities, model preferences)

**Agents do NOT have:**
- Persistent memory that influences decisions (memory_facts exists but is project-scoped, not agent-scoped decision memory)
- Goals or objectives beyond assigned tasks
- Ability to self-assign work or decide what to do next
- Inter-agent communication that affects behavior (messages exist but are informational)
- Tool selection capability (tools are predetermined by the system)
- Learning or adaptation across tasks

### Assessment Per Module

| Module | Truly Agentic? | Reality |
|--------|----------------|---------|
| PM Agent (`pm-agent.ts`) | **Partial** | The closest to a real agent — has tools (`pmToolkit`), makes decisions via LLM, produces structured output. But it's a single LLM call wrapped in VoltAgent, not a persistent agent with goals. |
| Task Decomposer (`task-decomposer.ts`) | **No** | A function that calls `generateObject` once. Not an agent — it's a transformer. |
| Execution Engine agents | **No** | Named slots that receive tasks. The "agent" doesn't decide anything — the pipeline engine decides what runs when, the model router decides which model, the context builder decides what context. The agent is just a label on a CLI subprocess. |
| Review agents | **No** | A task is created with type "review" and assigned to a designated reviewer role. The reviewer doesn't autonomously decide to review — the system creates the review task. |

### Verdict
**Oscorpex contains pseudo-agents: role-based wrappers around task execution.** The PM Agent is the only module that approaches real agency (LLM-driven planning with tools), but even it operates in a request-response pattern, not as a persistent autonomous entity.

---

## 4. Orchestration Model

### Architecture: Static DAG Pipeline with Phase Progression

The orchestration is built on a **predefined DAG** generated at plan time, not a dynamic coordination graph:

1. **Plan Creation** (`pm-agent.ts` → `buildPlan()`): PM generates phases with tasks. Phase dependencies are defined at plan creation time (`dependsOnPhaseOrders`).

2. **DAG Construction** (`pipeline-engine.ts` → `buildDAGWaves()`):
   - Uses **Kahn's algorithm** for topological sort
   - Agent dependencies create edges (12 edge types: workflow, review, gate, conditional, handoff, approval, hierarchy, notification, mentoring, escalation, fallback, pair)
   - Non-blocking types (hierarchy, notification, mentoring, escalation, fallback) don't affect DAG ordering
   - Produces **waves** — groups of agents that can execute in parallel

3. **Phase Progression** (`advanceStage()`):
   - Phases execute sequentially (current phase must complete before next starts)
   - Within a phase, tasks execute in wave order
   - `refreshPipeline()` rebuilds DAG without resetting completed stages

4. **Task Dispatch** (`dispatchReadyTasks()`):
   - Finds tasks in current phase where all dependencies are satisfied
   - Respects concurrency limit (Semaphore, default 3, configurable via `OSCORPEX_MAX_CONCURRENT_TASKS`)
   - Race condition guard: re-reads DB status + try/catch on `assignTask`

### Where Decision-Making Happens

| Decision | Where | Dynamic? |
|----------|-------|----------|
| What tasks to create | PM Agent (LLM call at plan time) | Static after plan |
| Task ordering | DAG (Kahn's algorithm at pipeline start) | Static |
| Which model to use | Model Router (complexity + retry count) | Semi-dynamic (escalates on retry) |
| Which CLI tool | Agent config + provider state | Semi-dynamic (fallback chain) |
| Review accept/reject | External CLI process (LLM decides) | Dynamic |
| Task decomposition | Decomposer (LLM at dispatch time) | One-shot |
| Fallback on failure | Edge hooks (deterministic) | Conditional but static |

### Verdict
**The system is graph-driven with static topology and deterministic progression.** The DAG is built once from the plan and doesn't adapt at runtime (except for review loops and retry escalation). There is no replanning, no dynamic task creation based on intermediate results, no agent-initiated coordination.

---

## 5. Task Lifecycle

```
                    ┌──────────────────────────────────────────┐
                    │                                          │
  createTask() → [queued] → startTask() → [running] → completeTask() → [done]
                    │              │              │                        │
                    │              │              │                  (review loop)
                    │              │              │                        │
                    │         [waiting_         [timeout]         [review] → accept → [done]
                    │          approval]          │                   │
                    │              │          failTask()          reject → [revision] → re-execute
                    │         approve → startTask()  │                        │
                    │              │              │                    (max 3 → fail)
                    │              │              ▼
                    │              │          [failed]
                    │              │              │
                    │              │       (fallback edge?)
                    │              │         re-assign → [queued]
                    │              │              │
                    │              │       (escalation edge?)
                    │              │         escalate → [queued] (different agent)
                    │              │              │
                    │              │       (auto-retry?)
                    │              │         retry → [queued]
                    │              │              │
                    │              │       (work-item creation)
                    │              │         createWorkItem(bug)
                    │              │
                    └──────────────┘
```

### Lifecycle Details

1. **Creation**: Tasks created by `buildPlan()` from PM agent output, or by `decomposeTask()` for L/XL tasks
2. **Policy check**: `evaluatePolicies()` in `startTask()` — can block, warn, or force approval
3. **Approval gate**: Human-in-the-loop for L/XL tasks or tasks with approval edges
4. **Execution**: CLI adapter chain (primary → fallback) with timeout + abort signal
5. **Review loop**: Reviewer agent task created on completion, can approve (→done) or reject (→revision, max 3)
6. **Failure handling**: Fallback edge → reassign, escalation edge → different agent, auto-retry, work-item creation
7. **Memory update**: `updateWorkingMemory()` on task completion (project-level key-value facts)
8. **Context indexing**: Task output indexed for FTS cross-agent search

### Weak Points
- **Revision stuck bug** (fixed): fire-and-forget `.catch()` on `executeTask` must call `failTask()` to prevent stuck running state
- **Orphaned running recovery**: `recoverStuckTasks()` is a best-effort polling mechanism, not guaranteed
- **Review loop ceiling**: Hardcoded at 3 rejections → fail. No intelligent escalation (e.g., try different approach)
- **No partial completion**: A task either fully succeeds or fully fails. No checkpoint/resume within a task

---

## 6. State, Memory, and Persistence

### What Is Persisted (66 tables)

| Category | Tables | Persistence Model |
|----------|--------|-------------------|
| Core workflow | projects, project_plans, phases, tasks, events, pipeline_runs | CRUD + event log |
| Agent config | project_agents, agent_configs, agent_capabilities, agent_dependencies, agent_runs | CRUD |
| Communication | chat_messages, agent_messages, notifications | CRUD |
| Memory | memory_facts, project_context_snapshots | Key-value with scope |
| Context/FTS | context_sources, context_chunks, context_events, context_search_log, context_search_stats | FTS index |
| Analytics | token_usage, agent_daily_stats, task_diffs, test_results | Append-only metrics |
| Auth/Tenant | tenants, users, user_roles, api_keys | CRUD |
| Governance | work_items, sprints, feedbacks | CRUD |
| Infrastructure | jobs, registered_plugins, plugin_executions, ci_trackings, marketplace_items | CRUD |
| VoltAgent (unused) | voltagent_memory_* (4 tables) | VoltAgent internal |

### Memory Analysis

**`memory_facts` table**: Key-value pairs scoped by `(project_id, scope, key)` with confidence score and source.
- Updated on task completion via `updateWorkingMemory()`
- Used in `context-packet.ts` to include in agent prompts
- **Verdict**: This is **stored metadata**, not agent memory. Facts are system-generated summaries (e.g., "tech_stack: React"), not learned behaviors or decisions. No agent reads its own history to change its approach.

**`context_sources` + `context_chunks`**: FTS-indexed task outputs for cross-agent context.
- Actually useful — provides relevant context from completed tasks to in-progress tasks
- **Verdict**: This is **RAG-style retrieval**, not memory. It provides information, not learned patterns.

**`events` table**: Full event log of all state transitions.
- Used for analytics, ceremony engine (standup/retro), and failure counting
- **Verdict**: **Event sourcing for metrics**, not for state reconstruction or replay.

### Overall Memory Verdict
**The system has stored metadata and RAG retrieval, not real memory.** No agent learns from past behavior, adapts its approach based on history, or maintains a model of the world that evolves. Memory is informational (what happened) not behavioral (how to act differently).

---

## 7. Control, Safety, and Governance

### Implemented Controls

| Control | Module | Status |
|---------|--------|--------|
| Policy engine | `policy-engine.ts` | **Working** — 3 built-in rules (max cost, large approval, multi-reviewer) + custom rules from project_settings |
| Approval gates | `task-engine.ts` | **Working** — human-in-the-loop for L/XL tasks, approval edges, `waiting_approval` status |
| Retry limits | `task-engine.ts` | **Working** — configurable via edge metadata, default 3 |
| Concurrency limit | `execution-engine.ts` | **Working** — Semaphore(3), env configurable |
| Rate limit detection | `execution-engine.ts` + `cli-runtime.ts` | **Working** — regex patterns on CLI output, pipeline auto-pause |
| Budget tracking | `token_usage` table | **Working** — per-task/agent/project cost tracking with budget warning events |
| Timeout with abort | `execution-engine.ts` | **Working** — per-complexity timeout, AbortController, configurable multiplier |
| Auth + RBAC | `auth/` | **Working** — JWT + API keys + 5-role RBAC, but opt-in (not enforced by default) |
| Tenant isolation | `tenant-context.ts` | **Partial** — RLS policies defined in SQL but NOT enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is not called) |
| Command injection protection | `diff-capture.ts`, `app-runner.ts` | **Fixed** — `execFileSync` with array args instead of `execSync` with string interpolation |

### Missing Controls

- **No output validation**: CLI output is trusted as-is. No sandboxing of generated code before it touches the filesystem
- **No cost circuit breaker**: Budget events are emitted but there's no automatic pipeline halt on budget exceeded (only rate-limit causes pause)
- **No secrets scanning**: Generated code could contain hardcoded secrets — no scan before commit
- **No audit trail for approvals**: Approval status is a flag on the task, not a separate auditable record
- **RLS not enabled**: Tenant isolation is aspirational — the SQL policies exist but `ENABLE ROW LEVEL SECURITY` is never called
- **No sandboxed execution**: CLI tools run in the host's filesystem with full access. A malicious or hallucinated command could damage the system

---

## 8. Failure Modes

### 1. Looping Review Cycles
**Why**: Review task → reject → revision → re-execute → review → reject... Ceiling is 3 rejections, but each cycle costs full LLM execution. No mechanism to detect "this task is fundamentally unfixable" earlier.

### 2. Dead DAG Branches
**Why**: If a task's dependency (via `dependsOn` array) is on a task that was deleted or moved to a different phase, the dependent task will never become "ready". `dispatchReadyTasks()` silently skips it.

### 3. Orphaned Running Tasks
**Why**: If the Node.js process crashes between CLI spawn and completion callback, tasks stay in "running" forever. `recoverStuckTasks()` runs on startup but relies on `_dispatchingTasks` and `_activeControllers` being empty — only true if the process restarted cleanly.

### 4. Concurrent Dispatch Race Condition
**Why**: `onTaskCompleted` callback and `dispatchReadyTasks()` can both try to dispatch the same task simultaneously. Mitigated by re-reading DB status + try/catch, but not eliminated (no distributed lock).

### 5. Cost Blowups
**Why**: Model escalation on retry (S→M→L→XL) combined with review rejection loops means a simple task can escalate to Opus-level costs after 3 failures + 3 review cycles = 6+ LLM calls at increasing cost tiers. No aggregate cost circuit breaker.

### 6. Partial State Corruption
**Why**: Pipeline state is dual-stored: in-memory `_states` Map AND database `pipeline_runs` table. If `persistState()` fails, the in-memory state diverges from DB. On process restart, `hydrateState()` reads from DB (stale), not memory.

### 7. Provider Chain Exhaustion
**Why**: If all three providers (Claude, Codex, Cursor) are rate-limited simultaneously, every task fails with "All CLI adapters exhausted." The pipeline pauses on rate-limit for the primary but doesn't handle total provider exhaustion gracefully.

### 8. Context Window Overflow
**Why**: `context-packet.ts` assembles prompts with memory facts, cross-agent context, and task description. No hard token limit enforcement — relies on `DEFAULT_MAX_TOKENS` (3000) in context-store search, but the final prompt can exceed model limits if task description + system prompt + memory + FTS results are all large.

### 9. False Success
**Why**: CLI output parsing (`cli-runtime.ts`) extracts `filesCreated`, `filesModified` from text output. If the CLI tool says "created file X" but didn't actually create it (hallucination), the task is marked as "done" with false metadata. No filesystem verification.

### 10. Event Ordering
**Why**: PG LISTEN/NOTIFY does not guarantee ordering. If two events for the same project arrive out of order (e.g., `task:completed` before `task:started`), handlers may behave unexpectedly. The dedup mechanism prevents duplicates but not reordering.

---

## 9. Strongest Architectural Decisions

1. **CLI Adapter Pattern with Fallback Chain** (`cli-adapter.ts`): Clean abstraction that allows swapping between Claude Code, Codex, and Cursor without changing execution logic. The fallback chain with provider state tracking is well-designed.

2. **Kahn's Algorithm DAG with Edge Type Classification** (`pipeline-engine.ts`): 12 edge types classified into blocking vs non-blocking, with pair edges for co-scheduling. Graceful cycle handling. This is production-quality graph orchestration.

3. **Event Bus + PG LISTEN/NOTIFY Bridge** (`event-bus.ts`): Elegant dual-layer event system — in-process for speed, PG notifications for cross-process durability, with dedup to prevent double-firing. Simple and effective.

4. **FTS Content Store with RRF** (`context-store.ts`): Reciprocal Rank Fusion combining tsvector full-text and pg_trgm trigram similarity — gives cross-agent context retrieval without external vector DB dependencies.

5. **Policy Engine with Wired Enforcement** (`policy-engine.ts` → `task-engine.ts`): Policies aren't just defined — they're actually evaluated in `startTask()` and can block execution. The wire-up from definition to enforcement is complete.

6. **Concurrency Semaphore + Rate Limit Detection**: The execution engine handles the real-world constraints of LLM API rate limits with automatic pause/resume and per-provider cooldown tracking.

7. **Task Decomposer with Dual Strategy**: AI decomposition (Zod-typed) with heuristic fallback ensures L/XL tasks are always broken down, even when LLM is unavailable. Pragmatic engineering.

8. **Idempotent Schema** (`init.sql`): All `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` — safe to re-run on every startup. No migration framework needed.

9. **Barrel DB Module Pattern** (`db/index.ts`): 28 repo modules with single import point. Clean separation without import path management overhead.

10. **Review Loop as First-Class Lifecycle**: Review tasks are real tasks (visible in pipeline, assigned to reviewer agents), not just a flag. This makes the review process observable and auditable.

---

## 10. Biggest Architectural Gaps

### 1. No Agent Autonomy
Agents cannot self-assign work, negotiate tasks, request help, or change their approach based on results. They are passive recipients of dispatched tasks. For a system claiming 12-agent Scrum teams, this is the fundamental gap.

### 2. No Dynamic Replanning
The plan is static after PM generates it. If Phase 2 reveals that Phase 3's tasks are wrong, there's no mechanism for the system to adapt the plan. `appendPhaseToPlan`/`replanUnfinishedTasks` exist but require external trigger (human or API call).

### 3. No Inter-Agent Communication That Affects Behavior
Agent messages (`agent_messages` table) are informational logs. No agent reads another agent's messages and changes its approach. The edge hooks send notifications but the receiving agent doesn't process them.

### 4. Memory Is Metadata, Not Behavioral
`memory_facts` stores what happened, not learned patterns. No agent says "last time I used approach X and it failed, so I'll try approach Y." This is the difference between a log and a memory.

### 5. No Output Verification
Tasks are marked "done" based on CLI output parsing, not filesystem verification. No test execution is required for completion (test runner exists but is not wired into the task lifecycle as a gate).

### 6. Pipeline State Split-Brain
In-memory `_states` Map + DB `pipeline_runs` creates a dual-write problem. No transactional guarantee that both are consistent. Process crash = potential state divergence.

### 7. No Distributed Lock for Task Dispatch
Concurrent dispatch protection uses re-read + try/catch, not a proper distributed lock (e.g., `SELECT FOR UPDATE`). The job queue has SKIP LOCKED but it's not used for task dispatch.

### 8. RLS Not Enabled
Tenant isolation is designed but not activated. Multi-tenant deployments would leak data across tenants through any query that doesn't explicitly filter by `tenant_id`.

### 9. No Graceful Degradation on Total Provider Failure
If all CLI providers are unavailable, the system fails loudly but doesn't queue tasks for later or switch to a degraded mode.

### 10. VoltAgent Is Dead Weight
The entry point imports VoltAgent, creates agents (code assistant, summarizer, translator), configures memory and observability — but the actual Oscorpex studio runs independently through Hono. The VoltAgent framework adds dependencies and startup time without contributing to the core workflow.

---

## 11. Agentic Maturity Score

| Dimension | Score | Justification |
|-----------|-------|---------------|
| **Orchestration Maturity** | 72/100 | Strong DAG pipeline with wave scheduling, phase progression, pause/resume, retry. Missing: dynamic replanning, runtime graph modification. |
| **Agent Maturity** | 18/100 | Agents are named execution slots, not autonomous entities. No goals, no planning, no self-direction, no learning. PM agent is the sole exception (partial agency). |
| **Memory Maturity** | 25/100 | FTS context store is useful. memory_facts are metadata. No behavioral memory, no agent-specific learning, no episodic recall that changes behavior. |
| **Autonomy Maturity** | 15/100 | System executes a predefined plan. No self-correction, no dynamic task creation, no goal-seeking behavior. Human must intervene for any plan change. |
| **Control/Safety Maturity** | 55/100 | Policy engine, approval gates, rate limits, RBAC all exist and work. Missing: output sandboxing, cost circuit breaker, enabled RLS, secrets scanning. |
| **Production Readiness** | 45/100 | Comprehensive test suite (1435 tests), auth system, telemetry, monitoring. Missing: enabled multi-tenancy, distributed locks, state consistency guarantees, output verification. |
| **Overall** | **38/100** | A well-engineered orchestration platform with strong pipeline mechanics but fundamentally not agentic. The "12-agent Scrum team" is a metaphor for 12 role-based execution slots. |

---

## 12. Brutally Honest Verdict

### Is this a true agentic system today?
**No.** It is a DAG-based task orchestration engine with LLM-powered planning and CLI-delegated execution. "Agents" are metadata labels on execution slots, not autonomous entities.

### If not, what is it actually?
It is a **semi-automated development pipeline manager** — think GitHub Actions meets AI-powered project planning. The planning phase is genuinely intelligent (PM agent with structured output). The execution phase is a well-designed dispatch system. The review phase provides quality gates. But there is no autonomy between these stages.

### What is the single biggest illusion?
**The 12-agent Scrum team metaphor.** The system presents 12 named roles (PM, Tech Lead, Frontend Dev, Backend Dev, QA, etc.) as a "team" that collaborates. In reality, they are execution slots that process tasks sequentially/in-parallel according to a static DAG. There is no collaboration, no negotiation, no shared understanding, no emergent behavior. Calling them "agents" sets expectations the system cannot meet.

### What is the single most promising part?
**The pipeline engine + edge type system.** The 12-edge-type DAG with Kahn's algorithm, wave scheduling, fallback/escalation edges, and review loops is genuinely sophisticated orchestration. This is the foundation on which real agency could be built — if agents could modify the graph at runtime, create new edges, or inject tasks dynamically.

---

## 13. Evolution Plan

### Stage 1: Near-Term Stabilization (4-6 weeks)

**Goal**: Fix safety gaps and state consistency before adding agency.

1. **Enable RLS**: Add `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` for all tenant-scoped tables. Test with multi-tenant scenarios.
2. **Eliminate pipeline split-brain**: Move pipeline state entirely to DB with `SELECT FOR UPDATE`. Remove in-memory `_states` Map or make it a read-through cache with DB as source of truth.
3. **Wire test runner as completion gate**: `test-runner.ts` exists but is disconnected. Make test execution a required step before `markTaskDone()` for tasks that modify code.
4. **Add output verification**: After CLI execution, verify `filesCreated`/`filesModified` actually exist on disk. Flag false positives.
5. **Cost circuit breaker**: When `budget:exceeded` event fires, auto-pause the pipeline (like rate-limit does).
6. **Use job queue for task dispatch**: Route task dispatch through `job-queue.ts` (SKIP LOCKED) instead of direct concurrent dispatch. Eliminates race conditions.
7. **Remove VoltAgent dead weight**: The VoltAgent framework adds complexity without value. Extract the Hono server setup and remove VoltAgent dependencies.

### Stage 2: Medium-Term Agentic Restructuring (8-12 weeks)

**Goal**: Give agents actual capabilities that make them more than execution slots.

1. **Agent Memory**: Per-agent episodic memory — "I attempted X on task Y and it failed because Z." Stored in a dedicated table, retrieved at prompt time, influences approach selection. Not just facts, but **decisions and outcomes**.

2. **Dynamic Task Injection**: Allow running agents to create sub-tasks or modify upcoming tasks. The execution engine should accept new tasks from CLI output (structured output format) and inject them into the current phase.

3. **Inter-Agent Protocol**: Structured message passing where agents can request information from other agents. Frontend Dev asks Backend Dev "what's the API contract for endpoint X?" and gets a structured response that influences code generation.

4. **Adaptive Replanning**: After each phase completion, run a lightweight LLM evaluation: "Given what Phase N produced, does Phase N+1's plan still make sense?" Allow automatic plan adjustments.

5. **Agent Profiles with Strategy Selection**: Each agent role gets multiple execution strategies. Based on task characteristics and past performance (from episodic memory), the system selects the best strategy. E.g., Backend Dev has strategies: "test-first", "prototype-then-refine", "spec-driven".

6. **Observation-Action Loop**: Instead of fire-and-forget CLI execution, implement a step-by-step execution model where the agent observes intermediate output and decides next actions. Requires streaming CLI output processing.

### Stage 3: Long-Term Platform Architecture (16-24 weeks)

**Goal**: Transform from orchestration engine to agentic development platform.

1. **Agent Runtime Isolation**: Each agent runs in its own container/sandbox with defined tool access, filesystem scope, and network restrictions. Use the existing `container-pool.ts` for real isolation.

2. **Goal-Directed Agents**: Agents receive goals, not tasks. "Ensure the user authentication module handles OAuth2 with Google" instead of "Create file src/auth/google-oauth.ts with functions X, Y, Z." The agent plans its own approach.

3. **Emergent Coordination**: Replace the static DAG with a goal-oriented coordination protocol. Agents publish capabilities and needs; a coordination layer matches them dynamically. The DAG emerges from agent interactions, not from a predefined plan.

4. **Learning System**: Cross-project learning where successful patterns (task sequences, agent configurations, prompt strategies) are extracted and reused. Not just metrics — actual transferable knowledge.

5. **Human-AI Pair Programming Mode**: Beyond approval gates, allow human developers to work alongside agents in real-time. Agents observe human changes and adapt. Humans can redirect agents mid-task.

6. **Plugin Ecosystem**: The plugin registry exists — build a real marketplace where community plugins extend agent capabilities, add new CLI tools, provide domain-specific knowledge, or introduce new edge types.

---

*This analysis is based on inspection of ~90 backend source files, ~122 frontend files, 66 database tables, and 1435 test cases across the Oscorpex codebase as of commit `eac1403` (V6 complete).*
