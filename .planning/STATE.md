# Oscorpex — Project State

## Current Position

**Milestone:** Core Kernel Extraction
**Phase:** 04-event-schema (Complete)
**Last Activity:** 2025-04-22 — Event schema package created with typed payloads

## Status

- [x] Project directory structure analyzed
- [x] Core modules inventoried (execution-engine, task-engine, pipeline-engine, cli-adapter, event-bus, budget-guard, execution-gates, context-packet)
- [x] Database schema reviewed (83 tables)
- [x] Type system documented (888 lines, 30k LoC in studio/)
- [x] VoltAgent dependency map created (16 import sites: 5 critical, 2 bridge, 8 removable)
- [x] Event type inventory created (52 types, 135+ producer/consumer rows)
- [x] State transition matrix documented (6 machines, 67+ transitions)
- [x] Provider capability matrix created (3 adapters, 6 verification gates)
- [x] Baseline metrics captured (build 244ms, 1098 tests, 30k LoC)
- [x] Contract preservation checklist established (9 contracts + 6 extraction rules)
- [x] pnpm workspace created (apps/, packages/, adapters/)
- [x] @oscorpex/core, event-schema, provider-sdk packages scaffolded
- [x] src/ migrated to apps/kernel/src/ (git mv — history preserved)
- [x] console/ migrated to apps/console/ (git mv — history preserved)
- [x] Root package.json → workspace orchestrator
- [x] pnpm -r build passes (kernel + console + 3 packages)
- [x] Kernel tests pass (74 files, 1098 tests)
- [x] @oscorpex/core domain types and contract interfaces defined (Phase 3)
- [x] @oscorpex/event-schema created with 52 typed event payloads (Phase 4)
- [x] kernel types.ts re-exports EventType & StudioEvent from event-schema (Phase 4)
- [x] All 1098 tests pass with event-schema migration

## Key Decisions

1. **TypeScript continues** — Short-term, no language change. Extraction > rewrite.
2. **pnpm workspace** — Monorepo structure active (apps/, packages/, adapters/)
3. **Contract-first** — Define interfaces before moving implementations
4. **VoltAgent: gradual strangler** — Not immediate removal, progressive decoupling
5. **PostgreSQL stays** — Event store can start as Postgres, migrate later
6. **apps/kernel/** — Backend code moved from src/ (history preserved via git mv)
7. **apps/console/** — Frontend code moved from console/ (history preserved via git mv)
8. **EventType/StudioEvent origin** — Canonical types now in @oscorpex/event-schema, re-exported from kernel types.ts for backward compatibility

## Known Issues

- VoltAgent typecheck error in workflows/index.ts (pre-existing, Phase 11 target)
- 651 biome lint warnings (all "computed expression" — non-blocking)

## Blockers

- None currently

## Repository Structure (Current)

```
/oscorpex
  /apps
    /kernel          ← Backend (ex-src/)
      /src           ← 102 studio files + agents + tools + workflows
      /scripts       ← init.sql
    /console         ← Frontend (ex-console/)
      /src           ← 52 studio pages + 25 API modules
  /packages
    /core            ← @oscorpex/core (domain types, contracts, errors, utils)
      /src           ← 29 source files: domain/, contracts/, errors/, utils/
    /event-schema    ← @oscorpex/event-schema (52 typed payloads, EventPayloadMap)
      /src           ← index.ts + 6 payload files
    /provider-sdk    ← @oscorpex/provider-sdk (empty placeholder)
  /adapters           ← Future home for provider adapters (.gitkeep)
  .planning/          ← GSD planning infrastructure
```

## Technology Stack

| Layer | Current | Target |
|-------|---------|--------|
| Build | pnpm workspace + tsdown | pnpm workspace + tsdown |
| Runtime | Node.js 20+ | Node.js 20+ |
| Framework | VoltAgent + Hono | @oscorpex/core + Hono |
| Database | PostgreSQL | PostgreSQL |
| Linting | Biome | Biome |
| Testing | Vitest | Vitest |

## Patterns Established

- Import convention: `.js` extension for ESM (enforced)
- DB access: barrel import from `./db.js`
- UUID: `randomUUID()` from `node:crypto`
- Event sourcing: Event table + PG LISTEN/NOTIFY
- CLI adapters: Factory pattern with `getAdapter()` / `getAdapterChain()`
- Monorepo: pnpm workspace with apps/, packages/, adapters/
- Event types: Canonical in @oscorpex/event-schema, re-exported from kernel for backward compat
- Event payloads: Typed per EventType via EventPayloadMap interface

---
*Last updated: 2025-04-22*