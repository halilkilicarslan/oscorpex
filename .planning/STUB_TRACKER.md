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
| `create(run)` | `kernel/index.ts:103-105` | 🟥 P0 | STUB — throws "not yet wired" |
| `get(id)` | `kernel/index.ts:106-108` | 🟥 P0 | STUB — throws "not yet wired" |
| `update(id, partial)` | `kernel/index.ts:109-111` | 🟥 P0 | STUB — throws "not yet wired" |
| `list(filter)` | `kernel/index.ts:112-114` | 🟥 P0 | STUB — throws "not yet wired" |

**Blocked by:** No `runs` table or repository in DB layer.
**Resolution:** Create `runs` repo in `db/`, wire to `KernelRunStore`.

### Run Lifecycle (OSC-002)
| Method | File | Priority | Status |
|--------|------|----------|--------|
| `createRun(input)` | `kernel/index.ts:176-178` | 🟥 P0 | STUB — throws "not yet wired" |
| `getRun(runId)` | `kernel/index.ts:179-181` | 🟥 P0 | STUB — throws "not yet wired" |
| `startRun(runId)` | `kernel/index.ts:182-184` | 🟥 P0 | STUB — throws "not yet wired" |
| `pauseRun(runId)` | `kernel/index.ts:185-187` | 🟥 P0 | STUB — throws "not yet wired" |
| `resumeRun(runId)` | `kernel/index.ts:188-190` | 🟥 P0 | STUB — throws "not yet wired" |
| `failRun(runId, reason)` | `kernel/index.ts:191-193` | 🟥 P0 | STUB — throws "not yet wired" |
| `completeRun(runId)` | `kernel/index.ts:194-196` | 🟥 P0 | STUB — throws "not yet wired" |

**Blocked by:** RunStore not implemented, no Run concept in DB.
**Resolution:** Implement RunStore, then map lifecycle to pipeline/task engine.

### Subsystem Getters (OSC-005, 006, 007, 008)
| Getter | File | Priority | Status | Kit Package |
|--------|------|----------|--------|-------------|
| `verification` | `kernel/index.ts:158-160` | 🟥 P0 | STUB — throws | `@oscorpex/verification-kit` |
| `policy` | `kernel/index.ts:161-163` | 🟥 P0 | STUB — throws | `@oscorpex/policy-kit` |
| `cost` | `kernel/index.ts:164-166` | 🟥 P0 | STUB — throws | `@oscorpex/provider-sdk` |
| `memory` | `kernel/index.ts:167-169` | 🟨 P1 | STUB — throws | `@oscorpex/memory-kit` |
| `replay` | `kernel/index.ts:170-172` | ✅ DONE | Wired to `DbReplayStore` | `@oscorpex/observability-sdk` |

**Resolution pattern:** Create adapter class implementing the contract,
importing pure functions from the kit package, keeping DB/event emission
in the kernel layer.

### TaskGraph (OSC-003)
| Method | File | Priority | Status |
|--------|------|----------|--------|
| `buildWaves(phases)` | `kernel/index.ts:136-140` | 🟥 P0 | STUB — throws |
| `resolveDependencies(taskId)` | `kernel/index.ts:141-143` | 🟥 P0 | STUB — throws |
| `getExecutionOrder()` | `kernel/index.ts:144-146` | 🟥 P0 | STUB — throws |

**Blocked by:** Need to expose `@oscorpex/task-graph` functions through the contract.
**Resolution:** Delegate to `buildDAGWaves` and related functions from task-graph.

### Provider Execution (OSC-009)
| Method | File | Priority | Status |
|--------|------|----------|--------|
| `executeWithProvider(id, input)` | `kernel/index.ts:218-220` | 🟥 P0 | STUB — throws |

**Blocked by:** No provider registry wiring in facade.
**Resolution:** Wire `executionEngine.executeTask` or create provider dispatcher.

---

## Current Stub Count

| Category | Count | P0 | P1 | Done |
|----------|-------|----|----|------|
| RunStore | 4 | 4 | 0 | 0 |
| Run Lifecycle | 7 | 7 | 0 | 0 |
| Subsystem Getters | 5 | 3 | 1 | 1 |
| TaskGraph | 3 | 3 | 0 | 0 |
| Provider Execution | 1 | 1 | 0 | 0 |
| **Total** | **20** | **18** | **1** | **1** |

---

## Sprint Plan

### Sprint 1 (Current)
- OSC-001 → RunStore (4 stubs)
- OSC-002 → Run lifecycle (7 stubs)
- OSC-003 → TaskGraph (3 stubs)
- OSC-005 → VerificationRunner (1 stub)
- OSC-026 → This tracker (done)

**Expected after Sprint 1:** 5 stubs remain (policy, cost, memory, provider execution)

### Sprint 2
- OSC-006 → PolicyEngine (1 stub)
- OSC-007 → CostReporter (1 stub)
- OSC-009 → executeWithProvider (1 stub)
- OSC-010 → Provider registry (enhancement, not a stub)

**Expected after Sprint 2:** 2 stubs remain (memory)

### Sprint 3
- OSC-008 → MemoryProvider (1 stub)
- Remaining: 1 stub (complete)

---

*Last updated: 2026-04-24*
*Tracked by: `oscorpex_issue_backlog.md` + this file*