# Technical Debt Closure

## Completed

- Legacy kernel source archived under `archive/legacy/kernel-src`.
- Duplicate root modules removed:
  - `apps/kernel/src/studio/task-executor.ts`
  - `apps/kernel/src/studio/task-lifecycle.ts`
  - `apps/kernel/src/studio/pipeline-branch-manager.ts`
  - `apps/kernel/src/studio/pipeline-state-manager.ts`
- Wrapper implementations moved into extracted folders:
  - `execution/dispatch-coordinator.ts`
  - `execution/execution-recovery.ts`
  - `task/approval-service.ts`
  - `task/review-loop-service.ts`
  - `task/task-progress-service.ts`
- Legacy CLI runtime isolated under `apps/kernel/src/studio/legacy/`.
- `execution/task-executor.ts` split into focused execution services.
- `pipeline-engine.ts` slimmed into focused pipeline services.
- Production kernel boundary casts reduced in policy and verification adapters.

## Remaining Accepted Debt

- `apps/kernel/src/studio/legacy/cli-runtime.ts` remains for compatibility, streaming, proposal processing, and tests.
- `apps/kernel/src/studio/legacy/cli-adapter.ts` remains for explicit compatibility and legacy test paths; fallback remains disabled by default.
- Root `cli-runtime.ts` and `cli-adapter.ts` shims remain to preserve compatibility and current test mocks.
- Unsafe casts remain in tests, routes, DB row mappers, and provider adapters; continue cleanup by boundary.
- `archive/legacy/kernel-src` remains as a historical archive until explicit deletion approval.

## Validation

- `pnpm typecheck`: PASS
- `pnpm --filter @oscorpex/kernel test`: PASS
- `pnpm --filter @oscorpex/task-graph test`: PASS
- `pnpm --filter @oscorpex/provider-sdk test`: PASS

## Feature Planning Readiness

- YES
