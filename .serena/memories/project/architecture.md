# Oscorpex Architecture (post v8.1 refactor)

## Core Engine (refactored 2026-04-22)
- `execution-engine.ts` (1303 LOC, 7 responsibilities) — orchestration, dispatch, claim, session, sandbox, adapter chain, retry
- `execution-gates.ts` (144) — verification + test + goal gates
- `proposal-processor.ts` (123) — structured output marker routing
- `prompt-builder.ts` (144) — task prompt assembly + default system prompt
- `review-dispatcher.ts` (314) — review task lifecycle + agent resolution
- `logger.ts` — pino structured logging factory (JSON output, child loggers per module)
- `execution-workspace.ts` — unified workspace contract (local/isolated/container)

## Safety & Correctness
- `graph-coordinator.ts` — DAG mutations + GraphInvariantError (cycle DFS, self-edge, duplicate)
- `sandbox-manager.ts` — realpath + symlink + sep hardened path checks
- `task-injection.ts` — InjectionLimitError (quota 3/phase 10/depth 2/dedup)
- `budget-guard.ts` — cost circuit breaker
- `roles.ts` — canonical hyphen-case normalization

## Metrics (89K LOC total)
- Backend: 178 TS files, 47K LOC, 1098 tests
- Frontend: 147 files, 42K LOC, 541 tests  
- Routes: 32 files (5 YAGNI-deferred)
- DB repos: 38 files, 82 tables
- Event types: 67
- Exported types: 94
- as any: 63 remaining
- console.*: 17 remaining (test-verified only)
