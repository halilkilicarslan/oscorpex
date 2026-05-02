# Dead Code Audit Result

## Baseline

- Branch: `master`
- Commit: `bf6d6f6 docs(readme): reflect post-refactor execution architecture`
- Date: `2026-05-02 14:15:14 +03`
- Worktree: clean before audit; report file added by this audit

## Validation

- `pnpm typecheck`: PASS
- `pnpm --filter @oscorpex/kernel test`: PASS (`123` test files, `1539` tests passed, `5` skipped)
- `pnpm --filter @oscorpex/task-graph test`: PASS (`1` test file, `4` tests passed)
- `pnpm --filter @oscorpex/provider-sdk test`: PASS (`3` test files, `49` tests passed)
- `pnpm dlx knip --include files,exports,dependencies --reporter compact`: COMPLETED WITH FINDINGS (exit `1`; expected for reported unused files/exports/dependencies)

## Summary Decision

- Ready for feature planning: YES
- Blocking cleanup required before feature work: NO

The audit did not find evidence that the normal execution boundary depends on `executeWithCLI`. Focused search across `apps/kernel/src/studio/execution`, `execution-engine.ts`, `provider-resolver.ts`, and `task-engine.ts` returned no `executeWithCLI`, `isClaudeCliAvailable`, or `cli-runtime` imports. The current normal path remains:

```txt
ExecutionEngine -> TaskDispatcher -> TaskExecutor -> ProviderExecutionService -> ProviderRegistry -> ProviderAdapter
```

## Delete Candidates

| Path | Reason | Evidence | Risk | Recommendation |
|---|---|---|---|---|
| `apps/kernel/src/studio/task-executor.ts` | Old root-level executor left behind after `execution/task-executor.ts` extraction | `rg` found no imports of root `./task-executor.js`; `knip` reports it as unused; active import is `execution-engine.ts -> ./execution/task-executor.js` | Medium: file contains old `cli-runtime` import and may be used by out-of-tree/manual imports | Delete in cleanup-only PR after one more import audit and full validation |
| `apps/kernel/src/studio/task-lifecycle.ts` | Old root-level lifecycle code left behind after `task/task-lifecycle-service.ts` extraction | `knip` reports unused file; task-engine imports extracted service | Medium: may be referenced by docs or external imports | Delete in cleanup-only PR after compatibility decision |
| `apps/kernel/src/studio/pipeline-branch-manager.ts` | Root-level implementation appears replaced by `pipeline/vcs-phase-hooks.ts` | `rg` found no imports of `pipeline-branch-manager`; `knip` reports unused | Medium: VCS side effects are sensitive | Prefer migrate/delete in cleanup-only PR with focused pipeline tests |
| `apps/kernel/src/studio/pipeline-state-manager.ts` | Root-level implementation appears replaced by `pipeline/pipeline-state-service.ts` | `rg` found no imports of `pipeline-state-manager`; `knip` reports unused | Medium: pipeline persistence is sensitive | Prefer migrate/delete in cleanup-only PR with focused pipeline tests |
| `apps/kernel/src/studio/execution/index.ts`, `apps/kernel/src/studio/task/index.ts`, `apps/kernel/src/studio/pipeline/index.ts`, `apps/kernel/src/studio/providers/index.ts` | Barrel files currently reported unused by knip | `knip` reports each as unused | Low to medium: may be intended public module barrels | Keep unless package API policy says internal barrels are unnecessary |
| `apps/kernel/src/cli/*` command files | Kernel CLI command surface reported unused | `knip` reports `apps/kernel/src/cli/index.ts` and command files unused | Medium: may be manual CLI entrypoints | Do not delete without checking package bin/export plans |
| `apps/kernel/src/studio/context-packet.ts`, `routes/test-routes.ts`, `services/project-service.ts`, `utils/run-non-blocking.ts`, `events/*` | Reported unused by knip | `knip` compact output lists these files | Medium: may be future/public/internal route utilities | Review one by one, not batch delete |

## Archive Candidates

| Path | Reason | Evidence | Risk | Recommendation |
|---|---|---|---|---|
| `archive/legacy/kernel-src/` | README and CLAUDE.md describe it as legacy/migration artifact; creates repeated search and knip noise | `find archive/legacy/kernel-src -type f | wc -l` = `288`; `rg "kernel-src" .` only found documentation references; no `package.json` under `archive/legacy/kernel-src`; `knip` reports many files as unused | Low runtime risk, high repository-noise reduction; medium historical-reference risk | Archived for explicit legacy ownership; delete only after explicit confirmation |

## Keep Compatibility

| Path | Reason | Evidence | Delete After |
|---|---|---|---|
| `apps/kernel/src/studio/legacy/cli-runtime.ts` | Compatibility path for streaming/proposal/test/legacy callers | Contains `executeWithCLI`, `isClaudeCliAvailable`, `streamWithCLI`, `CLIExecutionResult`; root `cli-runtime.ts` is now a shim | Delete after streaming/proposal paths and compatibility callers migrate |
| `apps/kernel/src/studio/legacy/cli-adapter.ts` | Explicit legacy compatibility adapter; fallback disabled by default | References `executeWithCLI`; exposes `getAdapter`/`getAdapterChain`; root `cli-adapter.ts` is now a shim | Delete after tests and explicit compatibility entry points are removed |
| `apps/kernel/src/studio/review-dispatcher.ts` -> `getAdapter(...)` | Review dispatch still uses legacy adapter access through the root compatibility shim | `rg` finds `const reviewAdapter = await getAdapter(...)`; shim preserves existing test mocks while implementation lives in `legacy/cli-adapter.ts` | Migrate review dispatch to ProviderRegistry before removing cli-adapter |
| `apps/kernel/src/studio/provider-resolver.ts` Vitest branch -> `getAdapterChain(...)` | Test-only compatibility route to avoid real CLI spawning | `rg` finds `let testChain = await getAdapterChain(...)` with type boundary moved under `legacy/` | Remove after tests use ProviderRegistry test adapters directly |

## Public API Shims

| Path | Reason | Evidence | Recommendation |
|---|---|---|---|
| `apps/kernel/src/studio/model-router.ts` | Heavy catalog/routing logic moved to `providers/`; callers still import public shim | Imports from `providers/provider-model-catalog.ts` and `providers/provider-routing-service.ts`; callers still use `resolveModel`, `getDefaultRoutingConfig`, `getModelContextLimit` | Keep shim; do not delete unless public imports are intentionally migrated |
| `apps/kernel/src/studio/execution/index.ts` | Barrel for extracted execution module | Exports `TaskExecutor`, timeout/queue helpers, dispatcher/recovery/watchdog | Keep if extracted module API is intentional; otherwise mark as low-risk cleanup |
| `apps/kernel/src/studio/task/index.ts` | Barrel for extracted task module | Exports approval/review/progress/lifecycle/guard/effects/rollup services | Keep if extracted module API is intentional; otherwise mark as low-risk cleanup |
| `apps/kernel/src/studio/pipeline/index.ts` | Barrel for extracted pipeline module | Exports pipeline state, stage advance, replan, VCS hooks | Keep if extracted module API is intentional; otherwise mark as low-risk cleanup |
| `apps/kernel/src/studio/providers/index.ts` | Barrel for provider catalog/routing modules | Reported unused by knip, but may be an intended module API | Keep until provider module API policy is decided |

## Wrapper Migration Candidates

| Path | Current Target | Evidence | Recommendation |
|---|---|---|---|
| `apps/kernel/src/studio/execution/dispatch-coordinator.ts` | `../task-dispatcher.js` | File is re-export-only wrapper | Move implementation into extracted folder in cleanup PR; leave root compatibility shim if needed |
| `apps/kernel/src/studio/execution/execution-recovery.ts` | `../execution-recovery.js` | File is re-export-only wrapper | Move implementation into extracted folder in cleanup PR; leave root compatibility shim if needed |
| `apps/kernel/src/studio/task/approval-service.ts` | `../task-approval-manager.js` | File is re-export-only wrapper | Move implementation into extracted folder in cleanup PR; leave root compatibility shim if needed |
| `apps/kernel/src/studio/task/review-loop-service.ts` | `../task-review-manager.js` | Similar extracted service wrapper pattern | Move implementation into extracted folder in cleanup PR |
| `apps/kernel/src/studio/task/task-progress-service.ts` | `../phase-progress-tracker.js` | Similar extracted service wrapper pattern | Move implementation into extracted folder in cleanup PR |

## Active Refactor Candidates

| Module | Reason | Priority | Suggested Next Step |
|---|---|---|---|
| `apps/kernel/src/studio/execution/task-executor.ts` | Active executor is still large and contains prompt/context, sandbox, provider call, gates, output handling, retry, and completion logic | P2 | Split into `task-start-service`, `prompt-execution-context`, `sandbox-execution-guard`, `provider-task-runner`, `task-output-handler`, `execution-gates-runner` |
| `apps/kernel/src/studio/pipeline-engine.ts` | Active facade still coordinates build/start/advance/pause/resume/retry/review/task hooks | P2 | Split into `pipeline-build-service`, `pipeline-control-service`, `pipeline-task-hook`, `pipeline-review-helpers` |
| `apps/kernel/src/studio/legacy/cli-runtime.ts` | Compatibility code remains for explicit legacy paths | P2 | Keep until streaming/proposal callers migrate off legacy runtime |
| `apps/kernel/src/studio/legacy/cli-adapter.ts` | Compatibility adapter remains for tests and review compatibility | P2 | Keep until review/test compatibility callers migrate |
| Unsafe casts across kernel/routes/db/adapters | Many `as any` and `as unknown as` remain | P3 | Group cleanup by boundary rather than one large PR |

## Unsafe Cast Groups

| Area | Count / Examples | Recommendation |
|---|---|---|
| `apps/kernel/src/studio/kernel` | `15` occurrences; examples include replay fixtures/tests and adapter/mappers | Start with kernel boundary mappers and test fixtures |
| `apps/kernel/src/studio/routes` | `25` occurrences; examples include route context and request parameter casts | Add typed route context helpers |
| `apps/kernel/src/studio/db` | `8` occurrences | Add DB row mappers / typed repository return shapes |
| `apps/kernel/src/studio` total | `258` occurrences | Do not fix all at once; classify by boundary |
| `adapters` | `20` occurrences | Handle provider adapter payload normalization separately |
| `packages` | `1` occurrence | Low priority |

## Knip Findings

`knip` completed and returned findings. Summary:

- Unused files: `115`
- Unused dependencies: `2`
  - `adapters/provider-ollama/package.json`: `@oscorpex/provider-sdk`
  - `apps/kernel/package.json`: `@ai-sdk/provider-utils`, `commander`
- Unused devDependencies: `1`
  - root `package.json`: `@biomejs/biome`
- Unused exports: `166`

Important groups from compact output:

- `archive/legacy/kernel-src/**`: many unused files and exports; consistent with legacy archive classification.
- `apps/kernel/src/studio/task-executor.ts` and `apps/kernel/src/studio/task-lifecycle.ts`: root-level legacy duplicates reported unused.
- `apps/kernel/src/studio/pipeline-branch-manager.ts` and `apps/kernel/src/studio/pipeline-state-manager.ts`: root-level pipeline leftovers reported unused.
- `apps/kernel/src/studio/execution/index.ts`, `task/index.ts`, `pipeline/index.ts`, `providers/index.ts`: barrels reported unused; likely API policy decision, not immediate delete.
- `apps/console/**`: multiple unused components/hooks/pages/exports; out of execution-refactor scope and should be reviewed separately.
- `apps/kernel/src/cli/**`: command files reported unused; requires package/bin intent check before action.

## Final Recommendation

Proceed to feature planning.

The cleanup-only batch archived `archive/legacy/kernel-src` and removed confirmed unused root-level duplicate modules. No feature-blocking issue was found.

Recommended cleanup backlog:

1. P1: Delete `archive/legacy/kernel-src` only after explicit confirmation.
2. P1: Remove or migrate confirmed unused root-level duplicates: `task-executor.ts`, `task-lifecycle.ts`, `pipeline-branch-manager.ts`, `pipeline-state-manager.ts`.
3. P1: Wrapper implementations moved into extracted folders.
4. P2: Migrate review/test compatibility callers off `legacy/cli-adapter.ts`.
5. P2: Migrate streaming/proposal callers off `legacy/cli-runtime.ts`.
6. P2: Split active `execution/task-executor.ts` and slim `pipeline-engine.ts`.
7. P3: Cleanup unsafe casts by boundary.
