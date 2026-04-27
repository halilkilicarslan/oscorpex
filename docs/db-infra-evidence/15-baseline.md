# DB / Pool / Runtime Infra — Baseline (EPIC 15.1)

**Date**: 2026-04-27
**Scope**: DB / Pool / Runtime Infra Optimization

---

## Baseline Metrics

### DB Round-Trips Per Task

| Flow | Round-Trips |
|------|-------------|
| Successful task | ~19 |
| Failed task (no retry) | ~19 |
| Failed task (with retry) | ~33 |
| Failed task (with fallback) | ~20 |
| Recovery per stuck task | ~7 |

### Pool Configuration

| Setting | Current | Notes |
|---------|---------|-------|
| max | 20 | Hardcoded in pg.ts |
| idleTimeoutMillis | 30,000 | Hardcoded |
| connectionTimeoutMillis | 5,000 | Hardcoded |
| min | 0 | pg default |

### Query Patterns

| Pattern | Frequency | Risk |
|---------|-----------|------|
| `getTask()` repeated | 6+ times per task | Redundant |
| `getProject()` repeated | 3-4 times per task | Redundant |
| `getLatestPlan()` + `listPhases()` paired | 2-3 times per task | Could JOIN |
| Raw `pgExecute()` | 1 site | Inconsistent |

---

## Baseline State

| Area | Baseline |
|------|----------|
| Pool visibility | None (no metrics endpoint) |
| Pool tuning | Hardcoded values |
| Query batching | None |
| Task state transitions | Documented but not enforced |
| Claim metrics | None |
| Recovery metrics | None |
| Spawn latency | Not measured |
| IO buffering | Unbounded string accumulation |
| Read caching | None |
| Debug surface | Minimal |
