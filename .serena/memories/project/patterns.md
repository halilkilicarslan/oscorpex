# Oscorpex Critical Patterns (v8.1)

## Logging (NEW — 2026-04-22)
- `import { createLogger } from "./logger.js"` then `const log = createLogger("module-name")`
- Pino: `log.info("msg")`, `log.warn({ err }, "msg")` — NEVER `log.warn("msg", err)` (type error)
- JSON output: `{"level":"warn","time":...,"service":"oscorpex","module":"...","msg":"..."}`
- 4 files keep console.* for test compatibility: telemetry, shared-state, plugin-registry, job-queue

## Graph Safety (NEW — 2026-04-22)
- `validateAddEdge()` before every `applyAddEdge()` — cycle DFS, self-edge, duplicate check
- `GraphInvariantError` with typed violations
- `registerSplitCompletionListener()` on splitTask — child done→parent done, failed→parent failed

## Sandbox (UPDATED — 2026-04-22)
- `checkPathAllowed()` uses `resolve() + normalize() + sep` — NEVER bare `startsWith()`
- `writeBack()` uses `realpath()` + `lstat()` symlink rejection
- Pre-execution gate: hard mode checks denied tools BEFORE CLI spawn

## Injection (NEW — 2026-04-22)
- `checkInjectionLimits()` before `proposeTask()` — InjectionLimitError
- Limits: per-task 3, per-phase 10, recursion depth 2, duplicate title check

## Replanner (UPDATED — 2026-04-22)
- Pipeline gate: `advanceStage()` checks pending replan_events, blocks if any
- 6 triggers, 5 patch actions (add/remove/modify/reorder/defer)
- Event payload includes `replanEventId` + `patchSummary`

## Unchanged Patterns
- Import: `.js` extension, DB from `./db.js` barrel, UUID from `node:crypto`
- Dispatch: `claimTask()` SELECT FOR UPDATE SKIP LOCKED
- Pipeline: DB-authoritative via `mutatePipelineState()`
- Budget: `enforceBudgetGuard()`, canonical key `maxCostUsd`
- Provider: fallback chain, `isAllExhausted()` → defer + retry timer
- Session: `initSession()` → `recordStep()` x4 → `completeSession()`/`failSession()`
- Auth: opt-in `OSCORPEX_AUTH_ENABLED`, RLS 14+ tables
