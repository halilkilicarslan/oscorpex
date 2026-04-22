# Oscorpex — Roadmap

## Vision

Transform Oscorpex from a VoltAgent-dependent prototype into a provider-agnostic AI execution control plane with canonical domain model, hook-based extensibility, and first-class replayability.

---

### Phase 1: Preparation & Inventory (prep-inventory)

**Goal:** Document the current system's behavior before any refactoring begins. Create state transition matrices, event inventories, provider capability tables, and baseline metrics.

**Status:** ○ Pending
**Plans:** 2 plans

Requirements:
- [INVT-01] Task lifecycle state transitions fully documented
- [INVT-02] All event types catalogued with producers/consumers
- [INVT-03] Provider adapter capability matrix created
- [INVT-04] Verification gate inventory documented
- [INVT-05] Baseline performance metrics captured (build time, test pass rate, key module line counts)
- [INVT-06] VoltAgent dependency touchpoints mapped
- [INVT-07] Contract preservation checklist established

Plans:
- [ ] 01-prep-inventory-01-PLAN.md — State machine & event inventory
- [ ] 01-prep-inventory-02-PLAN.md — Provider, verification & baseline inventory

---

### Phase 2: Workspace Transformation (workspace-transform)

**Goal:** Convert the single-package repo into a pnpm monorepo with apps/, packages/, and adapters/ directories. No behavior change — purely structural.

**Status:** ○ Pending  
**Plans:** 2 plans

Requirements:
- [WS-01] pnpm-workspace.yaml created and configured
- [WS-02] apps/, packages/, adapters/ directory structure established
- [WS-03] Shared tsconfig and build configs extracted
- [WS-04] Current backend temporarily moved to apps/kernel
- [WS-05] Current console stays in apps/console
- [WS-06] Project builds and runs identically after restructure

Plans:
- [ ] 02-workspace-transform-01-PLAN.md — Monorepo scaffolding
- [ ] 02-workspace-transform-02-PLAN.md — Migrate existing code & verify parity

---

### Phase 3: Core Skeleton (core-skeleton)

**Goal:** Create `@oscorpex/core` package with canonical domain types, contracts, state machines, hook registry, and kernel façade — empty but correct structure.

**Status:** ○ Pending  
**Plans:** 2 plans

Requirements:
- [CORE-01] packages/core created with proper package.json and exports
- [CORE-02] Domain types (Run, Task, Stage, Artifact, etc.) defined
- [CORE-03] Contract interfaces (ProviderAdapter, EventPublisher, Scheduler, etc.) defined
- [CORE-04] State machine skeletons for Run, Task, Stage
- [CORE-05] Hook registry types and kernel façade interface
- [CORE-06] @oscorpex/core builds and exports types successfully

Plans:
- [ ] 03-core-skeleton-01-PLAN.md — Domain types & contracts
- [ ] 03-core-skeleton-02-PLAN.md — State machines, hooks & kernel façade

---

### Phase 4: Event Schema Extraction (event-schema)

**Goal:** Extract event system from runtime coupling into `@oscorpex/event-schema` package with BaseEvent model and correlation/causation IDs.

**Status:** ○ Pending  
**Plans:** 2 plans

Requirements:
- [EVT-01] packages/event-schema created
- [EVT-02] BaseEvent model with correlation/causation IDs defined
- [EVT-03] All 30+ EventType values mapped to typed payloads
- [EVT-04] event-bus.ts becomes thin delivery mechanism only
- [EVT-05] Event producers import from @oscorpex/event-schema
- [EVT-06] Backward compatibility maintained

Plans:
- [ ] 04-event-schema-01-PLAN.md — Event type definitions & BaseEvent model
- [ ] 04-event-schema-02-PLAN.md — Migrate producers & decouple event-bus

---

### Phase 5: Provider SDK & Adapters (provider-sdk)

**Goal:** Create `@oscorpex/provider-sdk` and separate provider adapters (Claude, Codex, Cursor) that conform to the ProviderAdapter contract.

**Status:** ○ Pending  
**Plans:** 2 plans

Requirements:
- [PROV-01] packages/provider-sdk created with ProviderAdapter contract
- [PROV-02] ProviderCapabilities and ProviderHealth types defined
- [PROV-03] adapters/provider-claude extracted from cli-adapter.ts
- [PROV-04] adapters/provider-codex extracted from cli-adapter.ts
- [PROV-05] adapters/provider-cursor extracted from cli-adapter.ts
- [PROV-06] Cost normalization and usage reporting unified
- [PROV-07] Kernel doesn't know provider implementation details

Plans:
- [ ] 05-provider-sdk-01-PLAN.md — Provider SDK contract & health/capability types
- [ ] 05-provider-sdk-02-PLAN.md — Extract adapters & unify cost reporting

---

### Phase 6: Verification Kit Extraction (verification-kit)

**Goal:** Separate verification logic from execution-engine into `@oscorpex/verification-kit`.

**Status:** ○ Pending  
**Plans:** 1 plan

Requirements:
- [VER-01] packages/verification-kit created
- [VER-02] Output verifier logic extracted from output-verifier.ts
- [VER-003] Execution gates logic extracted from execution-gates.ts
- [VER-04] VerificationReport canonical model defined
- [VER-05] Verification connected to kernel via hooks
- [VER-06] Task completion decision only from verification result

Plans:
- [ ] 06-verification-kit-01-PLAN.md — Extract verification kit & connect via hooks

---

### Phase 7: Policy Kit Extraction (policy-kit)

**Goal:** Centralize governance and approval logic into `@oscorpex/policy-kit`.

**Status:** ○ Pending  
**Plans:** 1 plan

Requirements:
- [POL-01] packages/policy-kit created
- [POL-02] Approval policy extracted from sandbox-manager.ts
- [POL-03] Risk classification contract defined
- [POL-04] PolicyDecision model established
- [POL-05] Policy hook runs before task start
- [POL-06] Block and approval behavior deterministic

Plans:
- [ ] 07-policy-kit-01-PLAN.md — Extract policy kit & connect via hooks

---

### Phase 8: Memory Kit Extraction (memory-kit)

**Goal:** Make context packet approach first-class with `@oscorpex/memory-kit`.

**Status:** ○ Pending  
**Plans:** 1 plan

Requirements:
- [MEM-01] packages/memory-kit created
- [MEM-02] Context compiler interface defined
- [MEM-03] context-packet.ts logic extracted
- [MEM-04] Working memory and episodic reference types
- [MEM-05] Every task execution produces a ContextPacket before provider dispatch
- [MEM-06] No ad-hoc string concatenation for prompts

Plans:
- [ ] 08-memory-kit-01-PLAN.md — Extract memory kit & context compiler

---

### Phase 9: Task Graph Extraction (task-graph)

**Goal:** Separate DAG and stage management into `@oscorpex/task-graph`.

**Status:** ○ Pending  
**Plans:** 1 plan

Requirements:
- [TG-01] packages/task-graph created
- [TG-02] Kahn wave generation logic extracted from pipeline-engine.ts
- [TG-03] Stage resolution API defined
- [TG-04] Scheduler contract connection established
- [TG-05] Kernel uses task-graph for stage progression

Plans:
- [ ] 09-task-graph-01-PLAN.md — Extract task graph package from pipeline-engine

---

### Phase 10: Kernel Unify (kernel-unify)

**Goal:** Merge execution-engine, task-engine, pipeline-engine behavior under single OscorpexKernel façade.

**Status:** ○ Pending  
**Plans:** 2 plans

Requirements:
- [KRN-01] OscorpexKernel implementation written
- [KRN-02] Run/Task/Stage state machines used in real flow
- [KRN-03] Current dispatch logic moved to kernel
- [KRN-04] Hook registry connects verification, policy, cost, memory
- [KRN-05] External code only talks to kernel façade

Plans:
- [ ] 10-kernel-unify-01-PLAN.md — Kernel façade implementation
- [ ] 10-kernel-unify-02-PLAN.md — Migrate dispatch logic & wire hooks

---

### Phase 11: VoltAgent Decoupling (voltagent-decouple)

**Goal:** Remove VoltAgent from the core boot path. System boots from @oscorpex/core, not VoltAgent.

**Status:** ○ Pending  
**Plans:** 2 plans

Requirements:
- [VA-01] apps/kernel boot entrypoint created (not VoltAgent)
- [VA-02] VoltAgent memory/observability made optional integration
- [VA-03] Agent/workflow bootstrap no longer core dependency
- [VA-04] System boots without VoltAgent
- [VA-05] Main execution flow works without VoltAgent

Plans:
- [ ] 11-voltagent-decouple-01-PLAN.md — Create kernel boot entrypoint
- [ ] 11-voltagent-decouple-02-PLAN.md — Make VoltAgent optional & verify decoupled boot

---

### Phase 12: Replay & Observability (replay-observe)

**Goal:** Implement checkpoint-level replay and harden observability to control-plane level.

**Status:** ○ Pending  
**Plans:** 2 plans

Requirements:
- [RPL-01] ReplaySnapshot model defined
- [RPL-02] Checkpoint creation works
- [RPL-03] Provider execution journal functional
- [RPL-04] Context packet hash stored
- [RPL-05] Checkpoint-level replay possible
- [OBS-01] observability-sdk created
- [OBS-02] Run timeline events standardized
- [OBS-03] Cost/verification/policy correlation views available
- [OBS-04] Operator causal chain visible for any run

Plans:
- [ ] 12-replay-observe-01-PLAN.md — Replay kit & checkpoint infrastructure
- [ ] 12-replay-observe-02-PLAN.md — Observability SDK & operator views

---