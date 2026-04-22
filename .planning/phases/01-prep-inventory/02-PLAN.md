---
phase: 01-prep-inventory
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/phases/01-prep-inventory/provider-capability-matrix.md
  - .planning/phases/01-prep-inventory/verification-gate-inventory.md
  - .planning/phases/01-prep-inventory/baseline-metrics.md
  - .planning/phases/01-prep-inventory/contract-preservation-checklist.md
autonomous: true
requirements:
  - INVT-03
  - INVT-04
  - INVT-05
  - INVT-07

must_haves:
  truths:
    - "All CLI adapters are documented with their capabilities, limitations, and cost reporting"
    - "Every verification and test gate is catalogued with its inputs, outputs, and integration points"
    - "Baseline metrics are captured (build time, test status, module sizes) before refactoring"
    - "Contract preservation checklist defines what must not break during extraction"
  artifacts:
    - path: ".planning/phases/01-prep-inventory/provider-capability-matrix.md"
      provides: "Provider adapter comparison with capabilities, limitations, cost reporting"
      min_lines: 60
    - path: ".planning/phases/01-prep-inventory/verification-gate-inventory.md"
      provides: "All verification and test gates with their flow and integration points"
      min_lines: 40
    - path: ".planning/phases/01-prep-inventory/baseline-metrics.md"
      provides: "Build time, test results, module line counts before refactoring"
      min_lines: 30
    - path: ".planning/phases/01-prep-inventory/contract-preservation-checklist.md"
      provides: "Behavioral contracts that must not break during extraction"
      min_lines: 40
  key_links:
    - from: "provider-capability-matrix.md"
      to: "src/studio/cli-adapter.ts"
      via: "AdapterFactory pattern with getAdapter/getAdapterChain"
      pattern: "CLIAdapter|getAdapter|ProviderCliTool"
    - from: "verification-gate-inventory.md"
      to: "src/studio/execution-gates.ts"
      via: "runVerificationGate, runTestGateCheck, runGoalEvaluation"
      pattern: "GateResult|verifyTaskOutput|runTestGate"
---

<objective>
Document provider adapter capabilities, verification gates, baseline metrics, and the contract preservation checklist. This completes the pre-refactoring inventory and establishes the "do not break" boundaries for all subsequent phases.

Purpose: Provider differences, verification logic, and behavioral contracts must be fully understood before extraction begins. Without this, the kernel extraction risk of regression is unacceptably high.

Output: Four inventory documents that, together with Plan 01 outputs, form the complete baseline reference for the entire extraction project.
</objective>

<execution_context>
@/Users/iamhk/.config/opencode/get-shit-done/workflows/execute-plan.md
@/Users/iamhk/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@src/studio/cli-adapter.ts
@src/studio/cli-runtime.ts
@src/studio/execution-gates.ts
@src/studio/output-verifier.ts
@src/studio/test-gate.ts
@src/studio/budget-guard.ts
@src/studio/provider-state.ts
@src/studio/context-packet.ts
@src/studio/policy-engine.ts
@src/studio/sandbox-manager.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Document provider adapter capabilities and verification gates</name>
  <files>
    .planning/phases/01-prep-inventory/provider-capability-matrix.md
    .planning/phases/01-prep-inventory/verification-gate-inventory.md
  </files>
  <action>
    **Part A: Provider Capability Matrix**

    Read and analyze these files to build a complete adapter matrix:
    - `src/studio/cli-adapter.ts` — Adapter interface and 3 implementations
    - `src/studio/cli-runtime.ts` — CLI execution runtime
    - `src/studio/provider-state.ts` — Provider state management
    - `src/studio/ai-provider-factory.ts` — AI provider factory
    - `src/studio/model-router.ts` — Model routing logic

    Document each adapter (Claude, Codex, Cursor) in a comparison table:

    | Capability | Claude | Codex | Cursor |
    |---|---|---|---|
    | Tool restriction support | Yes (allowedTools) | No (throws) | No (throws) |
    | Streaming support | ? | ? | ? |
    | Resume capability | ? | ? | ? |
    | Structured output | ? | ? | ? |
    | Cost reporting | Partial | Partial | Partial |
    | Availability check | isClaudeCliAvailable() | execFileSync version | execSync version |
    | Timeout handling | AbortSignal + timer | timer + SIGKILL | timer + SIGKILL |
    | Model selection | --model flag | --model flag | --model flag |
    | Exit code handling | ? | code !== 0 → reject | code !== 0 → reject |
    | System prompt injection | Via system prompt param | Via stdin | Via stdin |

    Also document:
    - `CLIAdapter` interface contract (what the kernel expects from an adapter)
    - `CLIAdapterOptions` and `CLIExecutionResult` types
    - `getAdapter()` and `getAdapterChain()` factory functions
    - Provider state management (provider-state.ts)
    - Model routing (model-router.ts) — how S/M/L/XL maps to providers
    - Cost reporting format (inputTokens, outputTokens, totalCostUsd, etc.)
    - Gaps compared to master plan's `ProviderAdapter` contract (capabilities(), health(), cancel())

    **Part B: Verification Gate Inventory**

    Read and analyze these files:
    - `src/studio/execution-gates.ts` — Gate orchestration
    - `src/studio/output-verifier.ts` — Output verification
    - `src/studio/test-gate.ts` — Test gate checks
    - `src/studio/goal-engine.ts` — Goal evaluation
    - `src/studio/sandbox-manager.ts` — Sandbox policy enforcement

    Document each gate as:

    1. **Verification Gate** (`runVerificationGate`)
       - Input: projectId, task, repoPath, output, agentId, sessionId
       - Process: resolveStrictness → verifyTaskOutput → emit events
       - Output: GateResult { passed, failedChecks }
       - Integration: Called from execution-engine after task execution
       - Side effects: Emits `verification:passed` or `verification:failed` events

    2. **Test Gate** (`runTestGateCheck`)
       - Input: projectId, task, repoPath
       - Process: Run lint → run typecheck → run tests
       - Output: GateResult { passed, failedChecks }
       - Integration: Called conditionally based on task type

    3. **Goal Evaluation** (`runGoalEvaluation`)
       - Input: projectId, task, repoPath, agentId
       - Process: Validate criteria from output, then LLM-based evaluation
       - Output: GateResult { passed, failedChecks }

    4. **Budget Guard** (`enforceBudgetGuard`)
       - Input: projectId
       - Process: Check total spend against budget cap
       - Output: BudgetCheck { totalSpentUsd, budgetMaxUsd, exceeded }
       - Integration: Called before task dispatch
       - Side effects: Emits `budget:warning` or `budget:exceeded` events

    5. **Policy Enforcement** (`sandbox-manager.ts`)
       - Input: projectId, task, repoPath
       - Process: resolveTaskPolicy → checkToolAllowed / checkPathAllowed
       - Output: Policy decisions (allow/deny)
       - Integration: Called before task execution

    Document the flow: task assigned → policy check → budget guard → execute → verify output → test gate → goal evaluation → mark done/revision/failed.
  </action>
  <verify>
    <automated>test -f .planning/phases/01-prep-inventory/provider-capability-matrix.md && test -f .planning/phases/01-prep-inventory/verification-gate-inventory.md && echo "PASS: Both files exist"</automated>
  </verify>
  <done>Provider adapter matrix documents all 3 adapters with capabilities, limitations, and cost reporting. All 5 verification/gate systems catalogued with inputs, outputs, integration points, and side effects.</done>
</task>

<task type="auto">
  <name>Task 2: Capture baseline metrics and establish contract preservation checklist</name>
  <files>
    .planning/phases/01-prep-inventory/baseline-metrics.md
    .planning/phases/01-prep-inventory/contract-preservation-checklist.md
  </files>
  <action>
    **Part A: Baseline Metrics**

    Capture the current state of the codebase BEFORE any refactoring:

    1. **Build time**: Run `pnpm build` and record the time
    2. **Type check**: Run `pnpm typecheck` and record pass/fail + time
    3. **Lint**: Run `pnpm lint` and record results
    4. **Test suite**: Run `pnpm test` and record count, pass/fail, time
    5. **Module sizes**: Run `wc -l src/studio/*.ts | sort -rn | head -30` for line counts of all key modules
    6. **Database schema**: Record table count from `scripts/init.sql` (grep for `CREATE TABLE`)
    7. **Route count**: Count routes in `src/studio/routes/` files
    8. **Import graph stats**: Count total imports, VoltAgent imports, cross-module imports
    9. **Frontend page count**: Count pages in `console/src/pages/studio/`
    10. **API endpoint module count**: Count files in `console/src/lib/studio-api/`

    Format as a structured markdown document with tables for each metric. Include the command used to capture each metric so it can be re-run after each phase to verify no regression.

    **Part B: Contract Preservation Checklist**

    Define the behavioral contracts that MUST NOT break during the kernel extraction:

    1. **API Contract** — Every route in `src/studio/routes/` must maintain its request/response shape
    2. **WebSocket Contract** — Event types and payload shapes must remain backward compatible
    3. **Task Lifecycle Contract** — The state machine transitions documented in Plan 01 must remain legal
    4. **Provider Adapter Contract** — The `CLIAdapter` interface must continue to work for all 3 providers
    5. **Database Contract** — Schema migrations must be additive only (no DROP COLUMN, no table removal)
    6. **Event Contract** — Existing EventType values must not be removed (only additions allowed)
    7. **Pipeline Contract** — DAG execution and stage progression must produce same results
    8. **Verification Contract** — Task completion decisions must remain correct
    9. **Frontend Contract** — Console API client must continue to work without changes

    For each contract, specify:
    - What it covers
    - How to verify it (command or test)
    - What constitutes a break
    - Whether temporary breaks are acceptable during a phase (and how to restore)

    Add a section on **Phased Extraction Rules**:
    - Every extracted package must have its own tests before anything depends on it
    - When moving code, leave a re-export shim in the original location
    - Remove shims only after all consumers are updated
    - Type-only packages can be published before implementation
    - Behavioral parity is verified by running the same test suite before and after extraction
  </action>
  <verify>
    <automated>test -f .planning/phases/01-prep-inventory/baseline-metrics.md && test -f .planning/phases/01-prep-inventory/contract-preservation-checklist.md && echo "PASS: Both files exist"</automated>
  </verify>
  <done>Baseline metrics captured for build time, typecheck, lint, tests, module sizes, DB schema, routes. Contract preservation checklist defines 9 behavioral contracts with verification methods and phased extraction rules.</done>
</task>

</tasks>

<verification>
1. All four inventory documents exist in .planning/phases/01-prep-inventory/
2. Provider matrix covers Claude, Codex, Cursor adapters with capability comparison
3. Verification gate inventory documents all 5 gate systems
4. Baseline metrics include actual measured values (not placeholders)
5. Contract preservation checklist covers all 9 contracts
6. Phased extraction rules are documented
</verification>

<success_criteria>
- Provider adapter matrix completed with capability comparison table
- All verification gates documented with integration points
- Baseline metrics captured (build, typecheck, lint, test, module sizes)
- 9 behavioral contracts defined with verification methods
- Phased extraction rules established
</success_criteria>

<output>
After completion, create `.planning/phases/01-prep-inventory/02-SUMMARY.md`
</output>