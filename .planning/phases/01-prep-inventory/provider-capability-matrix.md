# Phase 01: Provider Capability Matrix & Verification Gate Inventory

**Gathered:** 2025-04-22
**Status:** Complete

---

## Part A: Provider Adapter Capability Matrix

### Current Adapter Interface

```typescript
interface CLIAdapter {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  execute(opts: CLIAdapterOptions): Promise<CLIExecutionResult>;
}

interface CLIAdapterOptions {
  projectId: string;
  agentId: string;
  agentName: string;
  repoPath: string;
  prompt: string;
  systemPrompt: string;
  timeoutMs: number;
  allowedTools?: string[];
  model?: string;
  signal?: AbortSignal;
}

interface CLIExecutionResult {
  text: string;
  filesCreated: string[];
  filesModified: string[];
  logs: string[];
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalCostUsd: number;
  durationMs: number;
  model: string;
}
```

### Adapter Comparison

| Capability | Claude | Codex | Cursor | Target (`ProviderAdapter`) |
|---|---|---|---|---|
| **Tool restriction** | ✓ `allowedTools` | ✗ Throws error | ✗ Throws error | `supportsToolRestriction: boolean` |
| **Availability check** | `isClaudeCliAvailable()` | `execFileSync("codex", ["--version"])` | `execSync("cursor agent --version")` | `isAvailable(): Promise<boolean>` |
| **Streaming support** | ✗ | ✗ | ✗ | `supportsStreaming: boolean` |
| **Resume capability** | ✗ | ✗ | ✗ | `supportsResume: boolean` |
| **Structured output** | ✗ (raw text) | ✗ (JSON parse attempt) | ✗ (JSON parse attempt) | `supportsStructuredOutput: boolean` |
| **Model selection** | Via prompt | `--model` flag | `--model` flag | `supportedModels?: string[]` |
| **Timeout handling** | Signal + timer | Timer + SIGKILL | Timer + SIGKILL | Per-adapter |
| **Cancellation** | `AbortSignal` | `proc.kill("SIGTERM")` | `proc.kill("SIGTERM")` | `cancel(): Promise<void>` |
| **Cost reporting** | Via `executeWithCLI` | Est. ($5/1M in, $15/1M out) | ✗ (returns 0) | `estimatedCostUsd` + `billedCostUsd` |
| **Token counting** | Via `executeWithCLI` | JSON parse `usage` | JSON parse `usage` | Normalized in `ProviderExecutionResult.usage` |
| **System prompt** | Direct param | Via stdin prepend | Via stdin concat | `systemPrompt?` |
| **Governance prompt** | Via `buildToolGovernanceSection` | Via stdin prepend | Via stdin concat | Hook-based |
| **Exit code handling** | Via `executeWithCLI` | code !== 0 → reject | code !== 0 → reject | Provider-specific |
| **Health / cooldown** | ✗ | ✗ | ✗ | `health(): Promise<ProviderHealth>` |

### Gaps vs. Target `ProviderAdapter` Contract

| Gap | Current | Target |
|-----|---------|--------|
| `capabilities()` method | ✗ Missing | ✓ `ProviderCapabilities` with feature flags |
| `health()` method | ✗ Missing | ✓ `ProviderHealth` with `healthy`, `rateLimited`, `cooldownUntil` |
| `cancel()` method | ✗ (uses AbortSignal) | ✓ Explicit `cancel({ runId, taskId })` |
| Cost normalization | Est. per-adapter formulas | ✓ `$5/$15 per 1M tokens` hardcoded → needs pricing table |
| Error categorization | Raw string errors | ✓ Typed `ProviderExecutionError` with categories |
| Fallback chain | `getAdapterChain()` | ✓ Built into adapter selection |
| Provider state | `provider-state.ts` (separate) | ✓ Integrated with adapter |

### Provider State Management

`provider-state.ts` manages CLI provider availability states:
- **Available**: CLI tool detected and healthy
- **Degraded**: CLI tool detected but recently failed; cooldown period active
- **Unavailable**: CLI tool not detected or permanently failed

Emits transient event `provider:degraded` when cooldown activates.

### Model Router

`model-router.ts` maps task complexity to provider/model:
- **S** → Haiku (fast, cheap)
- **M** → Sonnet (balanced)
- **L** → Sonnet (capable)
- **XL** → Opus (most capable)

---

## Part B: Verification Gate Inventory

### Gate Flow (Post-Execution Pipeline)

```
task dispatch
  │
  ├── policy-engine.ts (PRE-EXECUTION)
  │     └── evaluatePolicies() → { allowed, violations }
  │
  ├── sandbox-manager.ts (DURING-EXECUTION)
  │     ├── resolveTaskPolicy() → SandboxPolicy
  │     ├── enforceToolCheck() / enforcePathChecks() / enforceOutputSizeCheck()
  │     └── SandboxViolationError (hard mode)
  │
  ├── budget-guard.ts (COST CIRCUIT BREAKER)
  │     └── enforceBudgetGuard() → pauses pipeline if exceeded
  │
  └── execution-gates.ts (POST-EXECUTION)
        ├── runVerificationGate() → output-verifier.ts
        │     └── verifyTaskOutput() → [files_exist, files_modified, output_non_empty]
        ├── runTestGateCheck() → test-gate.ts
        │     └── runTestGate() → detect runner → execute → parse results
        └── runGoalEvaluation() → goal-engine.ts
              ├── validateCriteriaWithLLM() (primary)
              ├── validateCriteriaFromOutput() (fallback keyword heuristic)
              └── shouldEnforceGoalFailure() → throws if enforce + unmet criteria
```

### Gate 1: Policy Engine (`policy-engine.ts`)

| Aspect | Detail |
|---|---|
| **Called by** | `task-engine.ts:startTask()` — runs before task execution |
| **Input** | `projectId, task` |
| **Output** | `{ allowed: boolean, violations: string[] }` |
| **Built-in rules** | `max_cost_per_task` (block), `require_approval_for_large` (require_approval), `multi_reviewer` (warn) |
| **Custom conditions** | `complexity ==`, `complexity >=`, `title contains`, `branch ==`, `description contains`, `assigned_agent ==`, `target_files contains`, `retry_count >=` |
| **Blocking** | Only `"block"` action sets `allowed: false` |
| **Events emitted** | `policy:violation` |
| **DB reads** | `getProjectSettingsMap()` |

### Gate 2: Sandbox Manager (`sandbox-manager.ts`)

| Aspect | Detail |
|---|---|
| **Called by** | `execution-engine.ts` — runs during task execution |
| **Input** | `projectId, task, agentRole, repoPath, files, output size` |
| **Output** | Throw `SandboxViolationError` (hard) or log violation (soft) |
| **Enforcement modes** | `"hard"` (throws), `"soft"` (logs), `"off"` (disabled) |
| **Tool checks** | `checkToolAllowed()` — denied vs. allowed list |
| **Path checks** | `checkPathAllowed()` — scope-limited filesystem |
| **Output size** | `checkOutputSize()` — max bytes enforcement |
| **Security boost** | Security-titled tasks → `networkPolicy: "no_network"`, adds `shell_exec` and `process_spawn` to denied |
| **Events** | None direct — violations recorded via `recordViolation()` |
| **DB** | `createSandboxPolicy`, `getSandboxPolicy`, `startSandboxSession`, `endSandboxSession` |

### Gate 3: Budget Guard (`budget-guard.ts`)

| Aspect | Detail |
|---|---|
| **Called by** | `execution-engine.ts` — runs after token usage recorded |
| **Input** | `projectId` |
| **Output** | `BudgetCheck { totalSpentUsd, budgetMaxUsd, exceeded }` |
| **Enforcement** | `enforceBudgetGuard()` → pauses pipeline if exceeded (`pipelineEngine.pausePipeline()`) |
| **Events emitted** | `budget:halted` |
| **DB queries** | `SUM(cost_usd) FROM token_usage`, `getProjectSetting(budget, max_usd)` |

### Gate 4: Verification Gate (`execution-gates.ts`)

| Aspect | Detail |
|---|---|
| **Called by** | `execution-engine.ts` — runs after task execution completes |
| **Input** | `projectId, task, repoPath, output, agentId, sessionId?` |
| **Output** | `GateResult { passed, failedChecks? }` |
| **Checks** | 1. Output non-empty, 2. Files exist on disk, 3. Files modified exist with content |
| **Strictness** | `"strict"` (default) vs `"lenient"` — from `project_settings` |
| **Events** | `agent:output` transient on failure |
| **DB** | `recordStep()` for AI session |

### Gate 5: Test Gate (`test-gate.ts` via `execution-gates.ts`)

| Aspect | Detail |
|---|---|
| **Called by** | `execution-gates.ts:runTestGateCheck()` |
| **Input** | `projectId, task, repoPath, output, agentRole, agentId` |
| **Output** | `GateResult { passed, failedChecks? }` |
| **Policy** | `"required"` (block on fail), `"optional"` (warn only), `"skip"` (no tests) |
| **Detection** | `vitest.config` → `npx vitest run`, `jest.config` → `npx jest --ci`, else `package.json test` script |
| **Timeout** | 2 minutes |
| **Blocking** | Only when `policy === "required"` and tests fail |

### Gate 6: Goal Evaluation (`goal-engine.ts` via `execution-gates.ts`)

| Aspect | Detail |
|---|---|
| **Called by** | `execution-gates.ts:runGoalEvaluation()` |
| **Input** | `goalId, taskTitle, output, projectId` |
| **Output** | Throws error (enforce mode) or passes |
| **Validation** | LLM-based (primary) → keyword heuristic (fallback) |
| **Enforcement** | `"enforce"` → throws on unmet criteria; `"advisory"` → log only |
| **Events** | `goal:evaluated` |
| **DB** | CRUD on `execution_goals` table |

---

*Phase: 01-prep-inventory*
*Inventory gathered: 2025-04-22*