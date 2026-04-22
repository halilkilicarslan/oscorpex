# Oscorpex — Project State

## Current Position

**Milestone:** Core Kernel Extraction
**Phase:** 01-prep-inventory (Not started)
**Last Activity:** 2025-04-22 — Initial planning infrastructure setup

## Status

- [x] Project directory structure analyzed
- [x] Core modules inventoried (execution-engine, task-engine, pipeline-engine, cli-adapter, event-bus, budget-guard, execution-gates, context-packet)
- [x] Database schema reviewed
- [x] Type system documented
- [ ] VoltAgent dependency map created
- [ ] Event type inventory created
- [ ] State transition matrix documented
- [ ] Provider capability table created
- [ ] Baseline metrics established

## Key Decisions

1. **TypeScript continues** — Short-term, no language change. Extraction > rewrite.
2. **pnpm workspace** — Monorepo structure for extraction
3. **Contract-first** — Define interfaces before moving implementations
4. **VoltAgent: gradual strangler** — Not immediate removal, progressive decoupling
5. **PostgreSQL stays** — Event store can start as Postgres, migrate later

## Blockers

- None currently

## Technology Stack

| Layer | Current | Target |
|-------|---------|--------|
| Build | tsdown/tsup | pnpm workspace + tsdown |
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

---
*Last updated: 2025-04-22*