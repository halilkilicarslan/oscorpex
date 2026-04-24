# Oscorpex — Stub Tracker (OSC-026)

This document tracks all remaining "Phase 10 stub" implementations in the
kernel facade and related subsystems. Each stub must be resolved before
the kernel can be considered the true owner of execution.

## Legend

- 🟥 **P0** — Blocks kernel ownership, must resolve immediately
- 🟨 **P1** — Required for platform reliability
- 🟩 **P2** — Quality / operational maturity
- ✅ **DONE** — Already implemented

---

## Kernel Facade Stubs

### RunStore (OSC-001)
| Method | File | Priority | Status |
|--------|------|----------|--------|
| `create(run)` | `db/run-repo.ts` | 🟥 P0 | ✅ DONE — `createRun()` wired |
| `get(id)` | `db/run-repo.ts` | 🟥 P0 | ✅ DONE — `getRun()` wired |
| `update(id, partial)` | `db/run-repo.ts` | 🟥 P0 | ✅ DONE — `updateRun()` wired |
| `list(filter)` | `db/run-repo.ts` | 🟥 P0 | ✅ DONE — `listRuns()` wired |

### Run Lifecycle (OSC-002)
| Method | File | Priority | Status |
|--------|------|----------|--------|
| `createRun(input)` | `kernel/index.ts` | 🟥 P0 | ✅ DONE — delegates to `RunStore` |
| `getRun(runId)` | `kernel/index.ts` | 🟥 P0 | ✅ DONE — delegates to `RunStore` |
| `startRun(runId)` | `kernel/index.ts` | 🟥 P0 | ✅ DONE — `RUN_TRANSITIONS` enforced |
| `pauseRun(runId)` | `kernel/index.ts` | 🟥 P0 | ✅ DONE — `RUN_TRANSITIONS` enforced |
| `resumeRun(runId)` | `kernel/index.ts` | 🟥 P0 | ✅ DONE — `RUN_TRANSITIONS` enforced |
| `failRun(runId, reason)` | `kernel/index.ts` | 🟥 P0 | ✅ DONE — `RUN_TRANSITIONS` enforced |
| `completeRun(runId)` | `kernel/index.ts` | 🟥 P0 | ✅ DONE — `RUN_TRANSITIONS` enforced |

### Subsystem Getters (OSC-005, 006, 007, 008)
| Getter | File | Priority | Status | Kit Package |
|--------|------|----------|--------|-------------|
| `verification` | `kernel/verification-adapter.ts` | 🟥 P0 | ✅ DONE | `@oscorpex/verification-kit` |
| `policy` | `kernel/policy-adapter.ts` | 🟥 P0 | ✅ DONE | `@oscorpex/policy-kit` |
| `cost` | `kernel/cost-adapter.ts` | 🟥 P0 | ✅ DONE | `@oscorpex/provider-sdk` |
| `memory` | `kernel/memory-adapter.ts` | 🟨 P1 | ✅ DONE | `@oscorpex/memory-kit` |
| `replay` | `replay-store.ts` | ✅ DONE | ✅ DONE | `@oscorpex/observability-sdk` |

**Resolution pattern:** Create adapter class implementing the contract,
importing pure functions from the kit package, keeping DB/event emission
in the kernel layer.

### TaskGraph (OSC-003)
| Method | File | Priority | Status |
|--------|------|----------|--------|
| `buildWaves(projectId)` | `kernel/index.ts` | 🟥 P0 | ✅ DONE — delegates to `buildDAGWaves` |
| `resolveDependencies(taskId)` | `kernel/index.ts` | 🟥 P0 | ✅ DONE — fetches from DB |
| `getExecutionOrder(projectId)` | `kernel/index.ts` | 🟥 P0 | ✅ DONE — delegates to `buildWaves` |

### Provider Execution (OSC-009)
| Method | File | Priority | Status |
|--------|------|----------|--------|
| `executeWithProvider(id, input)` | `kernel/index.ts` | 🟥 P0 | ✅ DONE — delegates to provider adapter |

---

## Current Stub Count

| Category | Count | P0 | P1 | Done |
|----------|-------|----|----|------|
| RunStore | 4 | 0 | 0 | 4 |
| Run Lifecycle | 7 | 0 | 0 | 7 |
| Subsystem Getters | 5 | 0 | 0 | 5 |
| TaskGraph | 3 | 0 | 0 | 3 |
| Provider Execution | 1 | 0 | 0 | 1 |
| **Total** | **20** | **0** | **0** | **20** |

**All 20 stubs resolved. Kernel facade is the true owner of execution.**

---

## Legacy Owner Matrix (S4-01)

| Legacy Module | Kernel Subsystem | Adapter File | Contract |
|---------------|------------------|--------------|----------|
| `output-verifier.ts` | `verification` | `kernel/verification-adapter.ts` | `VerificationRunner` |
| `policy-engine.ts` | `policy` | `kernel/policy-adapter.ts` | `PolicyEngine` |
| `token_usage` table | `cost` | `kernel/cost-adapter.ts` | `CostReporter` |
| `context-packet.ts` | `memory` | `kernel/memory-adapter.ts` | `MemoryProvider` |
| `replay-store.ts` | `replay` | `replay-store.ts` (direct) | `ReplayStore` |
| `pipeline-engine.ts` | `graph` | `kernel/index.ts` (inline) | `TaskGraph` |
| `cli-adapter.ts` | `providers` | `kernel/provider-registry.ts` | `ProviderAdapter` |
| `event-bus.ts` | `events` | `event-bus.ts` (direct) | `EventPublisher` |
| `hook-registry.ts` | `hooks` | `kernel/hook-registry.ts` | `HookRegistry` |
| `task-engine.ts` | `tasks` | `kernel/index.ts` (inline) | `TaskStore` |
| `run-repo.ts` | `runs` | `kernel/index.ts` (inline) | `RunStore` |

---

*Last updated: 2026-04-24*
*Tracked by: `oscorpex_issue_backlog.md` + this file*