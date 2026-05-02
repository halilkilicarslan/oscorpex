# Legacy Code Inventory — 2026-05-02

## cli-runtime.ts

| Aspect | Detail |
|--------|--------|
| File | `apps/kernel/src/studio/cli-runtime.ts` |
| Current callers | `planner-cli.ts`, `proposal-processor.ts`, `cli-adapter.ts`, `task-executor.ts` (import only, execution via ProviderExecutionService) |
| Category | **KEEP_COMPATIBILITY** |
| Migration target | All normal task execution now goes through ProviderExecutionService → ProviderRegistry → ProviderAdapter |
| Remaining uses | PM chat streaming (`planner-cli.ts`), proposal processing streaming |
| Delete after | PM chat migrated to provider adapter streaming |
| Risk | LOW — normal task execution already migrated |

## cli-adapter.ts (CLIAdapter interface)

| Aspect | Detail |
|--------|--------|
| File | `apps/kernel/src/studio/cli-adapter.ts` |
| Current callers | `provider-resolver.ts`, `provider-execution-service.ts` (via resolver), tests |
| Category | **KEEP_COMPATIBILITY** |
| Migration target | Direct `ProviderAdapter` usage via `ProviderRegistry` |
| Remaining uses | `RegistryBackedCLIAdapter` bridge still used by provider-resolver |
| Delete after | Provider resolver refactored to use ProviderAdapter directly |
| Risk | MEDIUM — bridge layer adds indirection but works correctly |

## CLIExecutionResult type

| Aspect | Detail |
|--------|--------|
| File | `apps/kernel/src/studio/cli-runtime.ts` |
| Current callers | `cli-adapter.ts`, `provider-execution-service.ts`, tests |
| Category | **DEPRECATE** |
| Migration target | `NormalizedProviderResult` from provider-execution-service |
| Delete after | All consumers use NormalizedProviderResult |
| Risk | LOW — type-only change |

## apps/kernel-src/ (legacy source)

| Aspect | Detail |
|--------|--------|
| File | `apps/kernel-src/` directory |
| Current callers | None (grep confirms zero references) |
| Category | **DELETE** (blocked by CLAUDE.md instruction: "Never edit files under apps/kernel-src/") |
| Migration target | N/A — fully migrated to `apps/kernel/` |
| Delete after | When project owner authorizes |
| Risk | NONE — zero callers confirmed |

## Duplicate DB exports

| Aspect | Detail |
|--------|--------|
| Status | **RESOLVED** — Faz 1 eliminated all 17 direct pg.js imports |
| Remaining | Only `db-bootstrap.ts` and `db-pool-metrics.ts` (infrastructure, by design) |
