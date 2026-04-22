# Phase 01: Baseline Metrics

**Captured:** 2025-04-22
**Status:** Complete

---

## Build Metrics

| Metric | Value | Command |
|--------|-------|---------|
| Build result | ✓ Success (52 files, 3303.88 kB) | `pnpm build` |
| Build time | 244ms | `pnpm build` |
| Typecheck | ✓ Pass (0 errors) | `pnpm typecheck` |
| Lint | ✗ 651 errors (computed expression simplification) | `pnpm lint` |
| Test result | 1056 passed, 47 skipped, 2 failed (PG connection) | `pnpm test` |
| Test duration | 40.52s | `pnpm test` |

**Note**: 2 test failures are due to PostgreSQL connection errors (DB not running locally). Tests requiring PG are expected to fail in this environment.

---

## Module Sizes (Top 30, lines of code)

| Module | Lines |
|--------|------:|
| cli-usage.ts | 1659 |
| execution-engine.ts | 1306 |
| task-engine.ts | 1296 |
| pipeline-engine.ts | 1100 |
| pm-agent.ts | 1050 |
| app-runner.ts | 971 |
| types.ts | 888 |
| runtime-analyzer.ts | 858 |
| cli-runtime.ts | 764 |
| docs-generator.ts | 627 |
| agent-runtime.ts | 570 |
| graph-coordinator.ts | 567 |
| container-pool.ts | 550 |
| project-templates.ts | 540 |
| cost-optimizer.ts | 498 |
| adaptive-replanner.ts | 495 |
| document-indexer.ts | 474 |
| api-discovery.ts | 468 |
| webhook-sender.ts | 462 |
| git-manager.ts | 438 |
| db-provisioner.ts | 437 |
| task-decomposer.ts | 429 |
| context-store.ts | 426 |
| context-packet.ts | 421 |
| ws-manager.ts | 377 |
| agent-messaging.ts | 376 |
| cli-language-model.ts | 368 |
| planner-cli.ts | 364 |
| container-manager.ts | 364 |
| sandbox-manager.ts | 354 |
| **Total (all .ts in studio/)** | **30498** |

---

## Database

| Metric | Value | Command |
|--------|-------|---------|
| Table count | 83 | `grep -c "CREATE TABLE" scripts/init.sql` |
| Schema style | Idempotent (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`) | Manual review |

---

## Frontend

| Metric | Value |
|--------|-------|
| Studio pages | 52 files in `console/src/pages/studio/` |
| API modules | 25 files in `console/src/lib/studio-api/` |
| Route modules | 32 files in `src/studio/routes/` |

---

## Dependency Counts

| Metric | Value |
|--------|-------|
| VoltAgent import sites | 14 direct imports, 2 indirect DB dependencies |
| Event types defined | 52 ( EventType union) |
| Event types emitted | ~48 (4 unused: git:commit, budget:warning, budget:exceeded, sprint:* — some bridged) |
| Event types transient | 3 (agent:output, prompt:size, provider:degraded) |
| State machines | 6 (TaskStatus, PipelineStatus, PipelineStageStatus, PhaseStatus, AgentProcessStatus, ProjectStatus) |
| Provider adapters | 3 (Claude, Codex, Cursor) |
| Verification gates | 6 (policy, sandbox, budget, verification, test, goal) |

---

*Phase: 01-prep-inventory*
*Metrics captured: 2025-04-22*