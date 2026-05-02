# Refactor Baseline — 2026-05-02

## Validation Status

| Check | Status | Notes |
|-------|--------|-------|
| `pnpm typecheck` | PASS | All workspaces clean |
| `pnpm test` | PASS | 123 files, 1539 passed, 5 skipped |
| `pnpm build` | Not run | Build not part of baseline |

## Known Issues
- 5 skipped tests (pre-existing, not related to refactor)
- No known failing tests

## Package Graph
```
@oscorpex/core → (foundational, no deps)
@oscorpex/event-schema → @oscorpex/core
@oscorpex/provider-sdk → @oscorpex/core
@oscorpex/policy-kit → @oscorpex/core
@oscorpex/task-graph → @oscorpex/core
@oscorpex/memory-kit → @oscorpex/core
@oscorpex/verification-kit → @oscorpex/core
@oscorpex/observability-sdk → @oscorpex/core
@oscorpex/control-plane → @oscorpex/core
@oscorpex/kernel → all packages
console → (standalone, proxies to kernel)
```

## Current Execution Paths
1. **Normal task execution**: ExecutionEngine → task-executor → executeWithCLI (cli-runtime.ts) — Claude-specific
2. **Provider adapter path**: ProviderRegistry → ProviderAdapter.execute() — generic but not wired for normal tasks
3. **PM chat streaming**: Uses cli-runtime.ts directly for interactive Claude sessions

## Current Module Sizes (post-decomposition)
| Module | LOC | Status |
|--------|-----|--------|
| execution-engine.ts | 287 | Facade (decomposed) |
| task-executor.ts | 1065 | Needs further splitting |
| task-dispatcher.ts | 212 | Clean |
| execution-recovery.ts | 232 | Clean |
| task-engine.ts | 204 | Facade (decomposed) |
| task-lifecycle.ts | 582 | Could split further |
| task-review-manager.ts | 370 | Clean |
| task-approval-manager.ts | 289 | Clean |
| phase-progress-tracker.ts | 176 | Clean |
| pipeline-engine.ts | 658 | Core DAG (decomposed) |
| pipeline-branch-manager.ts | 152 | Clean |
| pipeline-state-manager.ts | 252 | Clean |

## Risk List
1. **Duplicate execution paths**: executeWithCLI vs ProviderAdapter — must unify
2. **task-executor.ts still 1065 LOC**: needs provider execution extraction
3. **cli-runtime.ts**: Used by normal execution AND PM chat — must separate concerns
4. **model-router.ts**: Hardcoded catalogs
5. **kernel/index.ts**: `as unknown as` casts for core↔kernel type mapping
