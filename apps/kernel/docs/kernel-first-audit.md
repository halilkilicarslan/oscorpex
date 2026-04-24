# Kernel-First Audit Report

## Date
2026-04-24

## Scope
All route files and kernel facade surface.

## Methodology
1. Grepped all direct `execution-engine`, `task-engine`, `pipeline-engine` imports in routes
2. Verified all route calls proxy through `kernel.*` methods
3. Catalogued remaining direct engine imports (acceptable internal usage)

## Results

### Route Layer — 100% Kernel-First

All 19 route modules import engines **only** through `kernel/index.ts`:

| Route Module | Direct Engine Import | Status |
|--------------|---------------------|--------|
| agentic-routes.ts | ❌ No | ✅ Kernel-first |
| ceremony-routes.ts | ❌ No | ✅ Kernel-first |
| graph-routes.ts | ❌ No | ✅ Kernel-first |
| pipeline-routes.ts | ❌ No | ✅ Kernel-first |
| project-routes.ts | ❌ No | ✅ Kernel-first |
| task-routes.ts | ❌ No | ✅ Kernel-first |
| ... (all others) | ❌ No | ✅ Kernel-first |

### Kernel Facade — All Subsystems Exposed

`OscorpexKernelImpl` provides proxy methods for:

| Subsystem | Methods | Internal Import |
|-----------|---------|-----------------|
| Task lifecycle | assignTask, startTask, completeTask, failTask, retryTask | `taskEngine` |
| Review loop | submitReview, restartRevision, approveTask, rejectTask | `taskEngine` |
| Pipeline | startPipeline, advancePipeline, pausePipeline, resumePipeline, retryPipeline | `pipelineEngine` |
| Execution | executeTask, startProjectExecution | `executionEngine` |
| Progress | getProjectProgress, getPipelineStatus, getExecutionStatus | `taskEngine`, `pipelineEngine`, `executionEngine` |
| Ceremony | runStandup, runRetrospective | `ceremony-engine` (lazy) |
| Goals | listGoals, getGoal, createGoal, activateGoal, evaluateGoal, failGoal | `goal-engine` (lazy) |
| Ready tasks | getReadyTasks | `taskEngine` |
| Provider | executeWithProvider | `providerRegistry` |

### Remaining Direct Engine Imports (Acceptable)

The following files import engines directly and this is **by design**:

| File | Reason |
|------|--------|
| `kernel/index.ts` | Facade implementation — owns the engines |
| `task-engine.ts` | Core engine — no facade above itself |
| `pipeline-engine.ts` | Core engine — no facade above itself |
| `execution-engine.ts` | Core engine — no facade above itself |
| `boot.ts` | Boot orchestration — initializes all systems |

### Legacy Call Surface (Conscious)

| Pattern | Location | Status |
|---------|----------|--------|
| `initializeFromLegacy()` | `provider-registry.ts` | `@deprecated` |
| `getAdapter()` | `cli-adapter.ts` | Internal kernel |
| Direct db repo imports | Various | Internal kernel |

## Conclusion

The kernel-first migration is **complete**. All external-facing route code proxies through the kernel facade. Remaining direct engine imports are internal implementation details.

## Sign-off

- [x] Route audit completed
- [x] Facade surface verified
- [x] Legacy surface catalogued
- [x] No unintended bypass found

## Next Review

When adding new route modules, verify:
1. No direct `../execution-engine.js` imports
2. All subsystem calls go through `kernel.*`
3. New engines are exposed in `OscorpexKernelImpl` if needed