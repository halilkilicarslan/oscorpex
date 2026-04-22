---
phase: 03-core-skeleton
plan: 01
type: execute
wave: 1
depends_on: ["02-workspace-transform"]
files_modified:
  - packages/core/src/domain/run.ts
  - packages/core/src/domain/task.ts
  - packages/core/src/domain/stage.ts
  - packages/core/src/domain/artifact.ts
  - packages/core/src/domain/provider.ts
  - packages/core/src/domain/verification.ts
  - packages/core/src/domain/policy.ts
  - packages/core/src/domain/cost.ts
  - packages/core/src/domain/memory.ts
  - packages/core/src/domain/replay.ts
  - packages/core/src/domain/events.ts
  - packages/core/src/contracts/provider-adapter.ts
  - packages/core/src/contracts/event-publisher.ts
  - packages/core/src/contracts/scheduler.ts
  - packages/core/src/contracts/task-graph.ts
  - packages/core/src/contracts/run-store.ts
  - packages/core/src/contracts/task-store.ts
  - packages/core/src/contracts/workspace-adapter.ts
  - packages/core/src/contracts/verification-runner.ts
  - packages/core/src/contracts/policy-engine.ts
  - packages/core/src/contracts/replay-store.ts
  - packages/core/src/contracts/cost-reporter.ts
  - packages/core/src/contracts/memory-provider.ts
  - packages/core/src/errors/domain-errors.ts
  - packages/core/src/errors/provider-errors.ts
  - packages/core/src/errors/policy-errors.ts
  - packages/core/src/utils/ids.ts
  - packages/core/src/utils/result.ts
  - packages/core/src/utils/time.ts
  - packages/core/src/index.ts
  - packages/core/package.json
  - packages/core/tsconfig.json
autonomous: true
requirements:
  - CORE-01
  - CORE-02
  - CORE-03
  - CORE-06

must_haves:
  truths:
    - "All domain types from oscorpex_core_master_plan.md are defined in TypeScript"
    - "All contract interfaces from the master plan are defined with proper method signatures"
    - "packages/core builds and exports all types successfully"
    - "No runtime behavior — only type definitions and empty function bodies"
  artifacts:
    - path: "packages/core/src/domain/run.ts"
      provides: "RunStatus, Run interface"
      min_lines: 30
    - path: "packages/core/src/domain/task.ts"
      provides: "TaskStatus, Task, TaskType, TaskComplexity, TaskOutput"
      min_lines: 40
    - path: "packages/core/src/domain/provider.ts"
      provides: "ProviderExecutionInput, ProviderExecutionResult, ProviderCapabilities, ProviderHealth, ProviderAdapter contract"
      min_lines: 40
    - path: "packages/core/src/index.ts"
      provides: "Barrel export of all domain types and contracts"
      min_lines: 30
---

<objective>
Define all canonical domain types and contract interfaces for @oscorpex/core. These types are the foundation that all other packages (event-schema, provider-sdk, verification-kit, etc.) will import from. No runtime behavior — pure type definitions and interface contracts matching the master plan.

Purpose: Establish the single source of truth for domain types before any code extraction begins. Every package in the monorepo should be able to import from @oscorpex/core and get the canonical types for Run, Task, Stage, Provider, etc.
</objective>

<execution_context>
@/Users/iamhk/.config/opencode/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-prep-inventory/state-transitions.md
@.planning/phases/01-prep-inventory/event-inventory.md
@.planning/phases/01-prep-inventory/provider-capability-matrix.md
@oscorpex_core_master_plan.md
@packages/core/package.json
@packages/core/tsconfig.json
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create domain type definitions</name>
  <files>
    packages/core/src/domain/run.ts
    packages/core/src/domain/task.ts
    packages/core/src/domain/stage.ts
    packages/core/src/domain/artifact.ts
    packages/core/src/domain/provider.ts
    packages/core/src/domain/verification.ts
    packages/core/src/domain/policy.ts
    packages/core/src/domain/cost.ts
    packages/core/src/domain/memory.ts
    packages/core/src/domain/replay.ts
    packages/core/src/domain/events.ts
    packages/core/src/errors/domain-errors.ts
    packages/core/src/errors/provider-errors.ts
    packages/core/src/errors/policy-errors.ts
    packages/core/src/utils/ids.ts
    packages/core/src/utils/result.ts
    packages/core/src/utils/time.ts
  </files>
  <action>
    Create all domain type files based on the master plan (oscorpex_core_master_plan.md) and the inventory documents gathered in Phase 1.

    **Domain types must match exactly what the master plan specifies**, but also incorporate findings from the inventory:

    1. **packages/core/src/domain/run.ts** — RunStatus union type and Run interface (from master plan section "Run")
    2. **packages/core/src/domain/task.ts** — TaskStatus (11 values from inventory), Task interface, TaskType, TaskComplexity, TaskOutput, ApprovalStatus, RiskLevel. Add the **canonical** types from master plan but also include fields found in inventory that master plan missed (like `assignedAgent`, `branch`, `retryCount`, `revisionCount`, `requiresApproval`, etc.)
    3. **packages/core/src/domain/stage.ts** — StageStatus, Stage, PipelineStage, PipelineStatus, PipelineStageStatus (from inventory)
    4. **packages/core/src/domain/artifact.ts** — ArtifactManifest (from master plan)
    5. **packages/core/src/domain/verification.ts** — VerificationReport, VerificationType, VerificationDetail, VerificationStrictness, GateResult (from inventory execution-gates.ts)
    6. **packages/core/src/domain/policy.ts** — PolicyDecision, PolicyRule, SandboxPolicy, SandboxViolation, CapabilityScopeType, CapabilityPermission, DependencyType (from inventory)
    7. **packages/core/src/domain/cost.ts** — CostRecord, BudgetCheck, TokenUsage, ProjectCostSummary (from inventory)
    8. **packages/core/src/domain/memory.ts** — ContextPacket, ContextPacketMode, ContextPacketOptions, ProjectContextSnapshot, MemoryFact (from inventory)
    9. **packages/core/src/domain/replay.ts** — ReplaySnapshot (from master plan)
    10. **packages/core/src/domain/events.ts** — BaseEvent type with correlationId, causationId, stageId, provider fields (the GAP identified in event inventory). Also define the EventType union from inventory (52 types) but as a starting point — the full migration happens in Phase 4.
    11. **packages/core/src/errors/domain-errors.ts** — OscorpexError base class, TaskTransitionError, PipelineError, ProviderError subclasses
    12. **packages/core/src/errors/provider-errors.ts** — ProviderUnavailableError, ProviderTimeoutError, ProviderExecutionError
    13. **packages/core/src/errors/policy-errors.ts** — PolicyViolationError, SandboxViolationError
    14. **packages/core/src/utils/ids.ts** — generateId() using crypto.randomUUID(), parseId(), isId()
    15. **packages/core/src/utils/result.ts** — Result<T, E> type, ok(), err() helpers
    16. **packages/core/src/utils/time.ts** — now() returning ISO string, TimeWindow interface

    **Critical rules:**
    - Use `export type` for type aliases and unions
    - Use `export interface` for object shapes
    - Use tabs for indentation (biome.json)
    - All types must be exported from their files and re-exported from index.ts
    - No runtime behavior beyond id generation and time utilities
    - TaskStatus MUST include all 11 values from inventory: "queued" | "assigned" | "running" | "review" | "revision" | "waiting_approval" | "blocked" | "deferred" | "cancelled" | "done" | "failed"
    - BaseType (BaseEvent) MUST include correlationId and causationId (the identified gaps)
  </action>
  <verify>
    <automated>cd packages/core && pnpm build && echo "BUILD_PASS"</automated>
  </verify>
  <done>All 16 domain/utility files created. @oscorpex/core builds successfully. All types exported from index.ts.</done>
</task>

<task type="auto">
  <name>Task 2: Create contract interfaces</name>
  <files>
    packages/core/src/contracts/provider-adapter.ts
    packages/core/src/contracts/event-publisher.ts
    packages/core/src/contracts/scheduler.ts
    packages/core/src/contracts/task-graph.ts
    packages/core/src/contracts/run-store.ts
    packages/core/src/contracts/task-store.ts
    packages/core/src/contracts/workspace-adapter.ts
    packages/core/src/contracts/verification-runner.ts
    packages/core/src/contracts/policy-engine.ts
    packages/core/src/contracts/replay-store.ts
    packages/core/src/contracts/cost-reporter.ts
    packages/core/src/contracts/memory-provider.ts
  </files>
  <action>
    Create all contract interface files based on the master plan. These are pure TypeScript interfaces — no implementation, no imports from the existing codebase.

    1. **packages/core/src/contracts/provider-adapter.ts** — ProviderAdapter interface with: id, capabilities(), isAvailable(), execute(), cancel(), health(). Also ProviderExecutionInput and ProviderExecutionResult from master plan, with usage tracking (inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, estimatedCostUsd, billedCostUsd).
    2. **packages/core/src/contracts/event-publisher.ts** — EventPublisher interface with: publish<T>(event: T), publishTransient<T>(event: T). Import BaseEvent from domain/events.
    3. **packages/core/src/contracts/scheduler.ts** — Scheduler interface with: getReadyTasks(runId), claim(taskId, workerId), release(taskId, workerId).
    4. **packages/core/src/contracts/task-graph.ts** — TaskGraph interface with: buildWaves(phases), resolveDependencies(taskId), getExecutionOrder().
    5. **packages/core/src/contracts/run-store.ts** — RunStore interface with: create(run), get(id), update(id, partial), list(filter).
    6. **packages/core/src/contracts/task-store.ts** — TaskStore interface with: create(task), get(id), update(id, partial), list(filter), claim(id, workerId).
    7. **packages/core/src/contracts/workspace-adapter.ts** — WorkspaceAdapter interface with: prepare(repoPath, config), cleanup(repoPath), getStatus(repoPath).
    8. **packages/core/src/contracts/verification-runner.ts** — VerificationRunner interface with: verify(input: VerificationInput). Import types from domain/verification.
    9. **packages/core/src/contracts/policy-engine.ts** — PolicyEngine interface with: evaluate(input: PolicyEvaluationInput). Import types from domain/policy.
    10. **packages/core/src/contracts/replay-store.ts** — ReplayStore interface with: saveSnapshot(snapshot), getSnapshot(runId, checkpointId).
    11. **packages/core/src/contracts/cost-reporter.ts** — CostReporter interface with: recordCost(record), getProjectSpend(projectId), checkBudget(projectId). Import types from domain/cost.
    12. **packages/core/src/contracts/memory-provider.ts** — MemoryProvider interface with: buildContextPacket(input). Import types from domain/memory.

    All contracts use domain types from `../domain/` imports. They define the interface that kernel implementations must satisfy, but contain no implementation themselves.

    **Critical rules:**
    - Use `export interface` only — no classes, no implementations
    - Import domain types using relative paths (e.g., `import type { Task } from "../domain/task.js"`)
    - Use `.js` extensions in imports (ESM resolution convention from CLAUDE.md)
    - Tabs for indentation, 120 char line width
  </action>
  <verify>
    <automated>cd packages/core && pnpm build && echo "BUILD_PASS"</automated>
  </verify>
  <done>All 12 contract interfaces created. @oscorpex/core builds with both domain types and contracts exported.</done>
</task>

</tasks>

<verification>
1. `pnpm --filter @oscorpex/core build` succeeds
2. All domain types (Run, Task, Stage, etc.) are importable from `@oscorpex/core`
3. All contract interfaces (ProviderAdapter, EventPublisher, etc.) are importable
4. BaseEvent includes correlationId and causationId (gap identified in inventory)
5. TaskStatus includes all 11 values from inventory (not just master plan's 6)
6. No runtime dependencies — only type definitions and utility functions
7. Existing apps/kernel code still builds unchanged (no breaking imports)
</verification>

<success_criteria>
- @oscorpex/core builds and exports all types
- BaseEvent has correlationId and causationId
- TaskStatus has all 11 values from inventory
- ProviderAdapter contract matches master plan specification
- No import from existing studio/ code — pure new package
</success_criteria>

<output>
After completion, create `.planning/phases/03-core-skeleton/01-SUMMARY.md`
</output>