# Oscorpex — Status

## Current: v2.6 — Modular Decomposition & CI Stabilization

### Session 2026-04-13 — Backend Decomposition + CI Fixes

**Faz 1 — CI Stabilization:**
- Frontend build fix: ProvidersPage fallbackOrder, tsconfig @types/node, AgentConfig.gender
- Backend TS fix: task-engine.ts `output.summary` → `output.logs?.[0]`
- Runtime-analyzer tests: `vi.mock('node:child_process')` so `isPortInUse` (lsof) always returns false
- DB tests: `describe.skipIf(!dbReady)` gate (CI without migrations)
- ProjectSettings tests: added missing `fetchProjectCosts` mock

**Faz 2 — Lint:** biome.json config + `biome check --write` cleanup

**Faz 3 — Frontend Unused Code:** removed unused imports/fns/props in LivePreview, MessageCenter, RuntimePanel, StudioHomePage, TriggersPage, ProvidersPage, TerminalSheet

**Faz 4 — Backend Decomposition (major):**
- `src/studio/routes.ts` (3200 lines) → 11 modules under `src/studio/routes/`
- `src/studio/db.ts` (2280 lines) → 15 modules under `src/studio/db/`
- Original files kept as backward-compat shims (re-export from new index)
- URL routes & external imports unchanged — zero behavior change

**Faz 5 — Documentation:** README alignment (PostgreSQL, port 3141, React 19)

**Commit:** `65de0c9` — 36 files changed, +7094 / -5506

**Final state:**
- Backend TS: 0 errors
- Frontend TS: 0 errors
- Backend tests: 213 passed, 3 skipped (DB), 0 failed
- Frontend tests: 213 passed, 0 failed

## Previous Versions
- **v2.0**: 12-agent Scrum, DAG pipeline, review loop, drag-drop builder
- **v2.1**: Runtime system, preview proxy, crash detection, port auto-detect
- **v2.2**: API Explorer, auto-migration, monorepo workspaces, 42 new tests
- **v2.3**: Review loop fixes — await race conditions, review task stage placement, revision auto-restart
- **v2.4**: Preview system — direct URL iframe, port conflict resolution, API_TARGET env injection
- **v2.5**: Security layer, GitHub PR workflow, token analytics (cache tokens), per-agent budget, policy middleware
- **v2.6**: Modular decomposition (routes/ + db/), CI stabilization
