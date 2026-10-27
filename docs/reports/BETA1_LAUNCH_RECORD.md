# Oscorpex Internal Beta-1 Launch Record

## Status: LAUNCHED
## Date: 2026-05-18
## Owner: Internal operator
## Scope: internal-beta tenant only

---

## Pre-Launch Summary

### Hardening Sprints Completed
- P0 through P13: 14 hardening sprints
- RC1: Stabilization + security review
- Beta-0: Agentic dogfooding (10 personas, 59 tests)
- Beta-0.5: Playwright UI testing (14 pages, 30 tests)
- Beta-0.5C: Full-system E2E (15 agents, 14 pages)
- Beta-0.5D: Seeded workflow E2E (16 agents)

### Test Coverage
- Total regression tests: 648+
- Playwright UI pages tested: 14
- Security layers: 30+
- Production docs: 25+

### WeatherAPI Proof of Concept
- Project: COMPLETED (17/17 tasks)
- Code: TypeScript compiles, 13/13 tests pass
- API: 5 endpoints functional
- Cost: $0.748
- Time: ~2 hours
- Zero manual intervention on generated code

### Bugs Found & Fixed (Playwright Testing)
11 bugs discovered and fixed during live testing:
1. jwt.ts ESM require → import
2. DB schema missing tables → init.sql
3. Route permissions → 25 added
4. Missing API endpoints → 3 stubs
5. Sidebar missing → MCP section added
6. FK violation tenant → UUID created
7. FK violation user → UUID created
8. Auth middleware IDs → real UUIDs
9. tasks.tenant_id missing → ALTER TABLE
10. Tool policy source → "system"
11. Approval race condition → constraint bypass

### Security Posture
- RCE vectors: Closed (P0)
- Auth: Explicit bypass only (P0)
- RLS: FORCE on all tables (P0)
- Docker socket: Removed from default (P1)
- Env sanitization: 20 spreads cleaned (P1+P2)
- Tool policy: 8+ paths enforced (P2)
- Checkpoint: Operational (P3+P4)
- MCP: Read-only + write with approval (P4-P6)
- Git commit: Full chain (P9)
- Scheduler: Read-only (P10)
- Gateway: Read-only (P11)
- Hermes: Read-only with session budget (P12)
- Red-team: 14 attack scenarios tested (P13)

### Open Limitations
- Frontend a11y: ~115 focus:outline-none remaining
- Coverage threshold: Set at 80% (not verified with DB)
- Shared Docker volume: Not yet per-project
- Soak: Simulated, not 14-day real traffic

---

## Launch Configuration

### Feature Flags
| Flag | Value |
|------|-------|
| OSCORPEX_DEV_NO_AUTH | true (dev only) |
| OSCORPEX_ENABLE_HERMES | true |
| OSCORPEX_ENABLE_GATEWAY | true |
| OSCORPEX_ENABLE_SCHEDULER | false |
| OSCORPEX_ENABLE_MCP_WRITE_TOOLS | false |
| OSCORPEX_ENABLE_TERMINAL_EXEC | false |
| OSCORPEX_ENABLE_CONTAINER_RUNTIME | false |

### Closed Capabilities
- Hermes write: DENIED
- Gateway write: DENIED
- git.push/reset/rebase/merge: DENIED
- shell.run/deploy.run: DENIED
- container.run/db.mutate: DENIED
- credential.read: DENIED

---

## Day 1 Result: GO
