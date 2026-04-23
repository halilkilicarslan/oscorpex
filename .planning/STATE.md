# Oscorpex — Project State

## Current Position

**Milestone:** Core Kernel Extraction — COMPLETE (12/12 phases)
**Active Track:** Refactor Backlog (28 items, 7 EPICs)
**Last Activity:** 2026-04-24 — Phase 12 completed, backlog pushed to origin/master

## Phase Completion Status

| Phase | Package / Deliverable | Status | Commit |
|-------|----------------------|--------|--------|
| 1 | Inventory docs (6 documents) | ✅ Complete | — |
| 2 | Monorepo scaffolding | ✅ Complete | `2da6d46`, `8bbe820` |
| 3 | `@oscorpex/core` domain types, contracts, state machines | ✅ Complete | `76e082a` |
| 4 | `@oscorpex/event-schema` (52 typed payloads) | ✅ Complete | `e6a1ccb` |
| 5 | `@oscorpex/provider-sdk` (CLIAdapter, cost) | ✅ Complete | `26b0191` |
| 6 | `@oscorpex/verification-kit` | ✅ Complete | `b0cc4ea` |
| 7 | `@oscorpex/policy-kit` | ✅ Complete | `0ad09dd` |
| 8 | `@oscorpex/memory-kit` | ✅ Complete | `f127f58` |
| 9 | `@oscorpex/task-graph` | ✅ Complete | `76a08a1` |
| 10 | `OscorpexKernel` facade + hook registry | ✅ Complete | `6f2253a` |
| 11 | VoltAgent decoupling (`boot.ts`, `OSCORPEX_MODE`) | ✅ Complete | `160d88b` |
| 12 | `@oscorpex/observability-sdk` + replay store | ✅ Complete | `de12ad1` |

## Active Backlog

See `oscorpex_issue_backlog.md` for full 28-item backlog organized into 7 EPICs.

### Current Sprint: Sprint 1 (P0 Critical)
- OSC-001: RunStore implementation
- OSC-002: Run lifecycle methods
- OSC-003: TaskGraph contract wiring
- OSC-005: VerificationRunner wiring
- OSC-026: Stub tracker

## Repository Structure

```
/oscorpex
  /apps
    /kernel          ← Backend (102 studio files + kernel/ facade + boot.ts)
      /src
        /studio      ← 102 studio modules
        /kernel      ← OscorpexKernel facade + hook registry
        boot.ts      ← VoltAgent-free entry point
        entry-voltagent.ts ← VoltAgent integration entry
        index.ts     ← OSCORPEX_MODE dispatcher
      /scripts       ← init.sql (includes replay_snapshots table)
    /console         ← Frontend (52 pages + 25 API modules)
  /packages
    /core            ← @oscorpex/core (domain, contracts, errors, utils)
    /event-schema    ← @oscorpex/event-schema (52 typed payloads)
    /provider-sdk    ← @oscorpex/provider-sdk (CLIAdapter, cost)
    /verification-kit← @oscorpex/verification-kit (pure verification)
    /policy-kit      ← @oscorpex/policy-kit (policy evaluation, sandbox)
    /memory-kit      ← @oscorpex/memory-kit (context packet utilities)
    /task-graph      ← @oscorpex/task-graph (DAG waves, stage building)
    /observability-sdk← @oscorpex/observability-sdk (checkpoint, journal, causal chain)
  /adapters          ← Future provider adapter packages (empty)
  .planning/         ← GSD planning infrastructure + backlog
```

## Technology Stack

| Layer | Current |
|-------|---------|
| Build | pnpm workspace + tsdown |
| Runtime | Node.js 20+ |
| Framework | @oscorpex/core + Hono (kernel mode) / VoltAgent + Hono (voltagent mode) |
| Database | PostgreSQL |
| Linting | Biome |
| Testing | Vitest |

## Test Results

```
Test Files  74 passed (74)
Tests       1098 passed | 5 skipped (1103)
```

## Known Issues

- 12 pre-existing TypeScript errors in `cli-adapter.ts`, `ai-provider-factory.ts`, `policy-engine.ts`, `sandbox-manager.ts` (not introduced by phases)
- 651 biome lint warnings (all "computed expression" — non-blocking)
- 5 kernel facade stubs still throw errors: `verification`, `policy`, `cost`, `memory`, `run lifecycle`

## Patterns Established

- Import convention: `.js` extension for ESM
- DB access: barrel import from `./db.js`
- UUID: `randomUUID()` from `node:crypto`
- Event sourcing: Event table + PG LISTEN/NOTIFY
- Monorepo: pnpm workspace with apps/, packages/, adapters/
- Kernel facade: thin delegation layer over existing singletons
- Hook registry: InMemoryHookRegistry with sync/async hook support
- VoltAgent mode: `OSCORPEX_MODE=voltagent` for full integration, default is kernel-only

---
*Last updated: 2026-04-24*