# RC1 Release Candidate Report

**Version**: RC1.0
**Date**: 2026-05-14
**Branch**: master
**Prepared by**: Platform Engineering
**Status**: READY FOR SOAK — Not yet cleared for production

---

## Executive Summary

Oscorpex RC1 represents the completion of 13 sequential hardening phases (P0-P13),
delivering a 30+ layer defence-in-depth security architecture around an AI-powered
software development platform. The system runs a 12-agent autonomous Scrum pipeline
backed by PostgreSQL, a Hono HTTP kernel, and a React 19 console.

As of RC1, **523+ tests pass** (up from zero at project start), TypeScript strict
mode is fully enforced across all workspaces, and the five highest-risk attack
vectors (RCE via Docker socket, cross-tenant RLS bypass, prompt injection,
secret leakage, and write-tool misuse) all have multiple independent enforcement
layers.

**RC1 is cleared for 7-14 day staging soak.** Production deployment requires soak
completion with all gate criteria met (see Section 7).

---

## 1. Protection Inventory — P0 through P13

### P0: Core Security Hardening (12 tests)

| Control | Description | Status |
|---------|-------------|--------|
| P0-1 | JWT authentication on all non-public routes | Active |
| P0-2 | RLS enabled on all multi-tenant tables (85 tables) | Active |
| P0-3 | Docker socket not mounted into kernel container | Active |
| P0-4 | `--ignore-scripts` enforced on all package installs | Active |
| P0-5 | Sandbox realpath + symlink hardening | Active |
| P0-6 | UUID from `node:crypto`, not third-party uuid | Active |
| P0-7 | `HOST=127.0.0.1` in dev (no accidental public bind) | Active |
| P0-8 | `NODE_ENV=production` guards for write-tool registry | Active |
| P0-9 | `DATABASE_URL` least-privilege user (not superuser) | Active |
| P0-10 | `.env` in `.gitignore`; no secrets in source control | Active |
| P0-11 | Budget circuit breaker (auto-pause on cost overrun) | Active |
| P0-12 | Graph cycle detection (`validateAddEdge` / DFS) | Active |

### P1: Infrastructure Hardening (57 tests)

| Control | Description | Status |
|---------|-------------|--------|
| P1-1 | Rate limiting: MCP 100/min, Auth 10/min, Hermes 20/min | Active |
| P1-2 | Injection limit quotas (3/task, 10/phase, depth 2) | Active |
| P1-3 | Claim-based dispatch: SELECT FOR UPDATE SKIP LOCKED | Active |
| P1-4 | DB-authoritative pipeline state (no in-memory cache) | Active |
| P1-5 | Approval IDs: single-use, server-generated UUIDs | Active |
| P1-6 | JWT expiry: 1h access, 7d refresh (configurable) | Active |
| P1-7 | Webhook URL: DNS resolution before private IP check | Active |
| P1-8 | Path scope checks: realpath+normalize+sep (not bare startsWith) | Active |

### P2: Runtime Enforcement (76 tests)

| Control | Description | Status |
|---------|-------------|--------|
| P2-1 | Tool policy enforcer on all MCP invocation paths | Active |
| P2-2 | `OSCORPEX_ENABLE_MCP_WRITE_TOOLS` defaults to `false` | Active |
| P2-3 | Adaptive concurrency semaphore (1–10, auto-adjust) | Active |
| P2-4 | Task retry classification with exponential backoff | Active |
| P2-5 | Provider cooldown state (unavailable 30s, spawn_failure 60s, repeated_timeout 90s) | Active |
| P2-6 | Timeout policy: provider × complexity × multiplier | Active |
| P2-7 | Sandbox guard in task executor path | Active |
| P2-8 | Command enforcement policy-kit (checkCommandAllowed) | Active |
| P2-9 | Command audit logging (command_audit_logs table) | Active |

### P3: Checkpoint Policy (14 tests)

| Control | Description | Status |
|---------|-------------|--------|
| P3-1 | Checkpoint creation TTL (no unbounded accumulation) | Active |
| P3-2 | Checkpoint cleanup job (read-only report, no auto-delete) | Active |
| P3-3 | Checkpoint count alert (> 1000 → P3 daily report) | Active |

### P4: MCP Runtime Wiring (34 tests)

| Control | Description | Status |
|---------|-------------|--------|
| P4-1 | MCP audit log on every invocation (allow + deny) | Active |
| P4-2 | `recordMcpAudit()` wired to all invocation paths | Active |
| P4-3 | `invokeMcpTool()` routes through policy enforcer | Active |
| P4-4 | Write-tool approval flow: non-replayable approval IDs | Active |

### P5: Read-Only MCP Protocol (23 tests)

| Control | Description | Status |
|---------|-------------|--------|
| P5-1 | Read-only tool allowlist (8 tools) | Active |
| P5-2 | Write tools require explicit approval ID | Active |
| P5-3 | Tool capability resolver (metadata vs full body) | Active |

### P6: Selective Write MCP (64 tests)

| Control | Description | Status |
|---------|-------------|--------|
| P6-1 | `OSCORPEX_ALLOW_MCP_WRITE_IN_PROD` explicit opt-in | Active |
| P6-2 | Write tool approval TTL (recommended 10 min) | Active |
| P6-3 | Secret guard on all write payloads | Active |
| P6-4 | Risk classifier: 6-signal weighted scorer | Active |
| P6-5 | Learning governance: 23 injection regex + scoring | Active |
| P6-6 | Prompt sanitization before learning storage | Active |

### P7: Write Approval Production (9 tests)

| Control | Description | Status |
|---------|-------------|--------|
| P7-1 | POST /mcp/write/apply validates approvalId persistence | Active |
| P7-2 | Approval single-use enforcement | Active |
| P7-3 | Approval expiry enforcement | Active |

### P8: Approval UX Staging (9 tests)

| Control | Description | Status |
|---------|-------------|--------|
| P8-1 | Approval flow UI with explicit user confirmation | Active |
| P8-2 | Approval request surfaced in console notification | Active |

### P9: Controlled Git Commit (52 tests)

| Control | Description | Status |
|---------|-------------|--------|
| P9-1 | Git operations require approval (not auto-committed) | Active |
| P9-2 | VCS hooks in pipeline (pre-commit, post-commit) | Active |
| P9-3 | Commit content audited before execution | Active |
| P9-4 | Force push to main/master blocked | Active |

### P10: Read-Only Scheduler (66 tests)

| Control | Description | Status |
|---------|-------------|--------|
| P10-1 | Scheduler policy: denies write, git.commit, shell, deploy, credential | Active |
| P10-2 | 7 read-only report jobs (no mutations) | Active |
| P10-3 | Memory pruning: proposals only, no auto-delete | Active |
| P10-4 | Secret guard expanded to 25+ patterns | Active |
| P10-5 | Scheduler disabled by default (`OSCORPEX_ENABLE_SCHEDULER`) | Active |

### P11: Gateway Scheduler Soak (read from P11 report)

| Control | Description | Status |
|---------|-------------|--------|
| P11-1 | Gateway rate limiting (60 req/min) | Active |
| P11-2 | Gateway payload size limit (50 KB) | Active |
| P11-3 | Gateway write-tool denial | Active |
| P11-4 | Gateway audit events | Active |
| P11-5 | Staging preflight for Gateway + Scheduler | Active |

### P12: Hermes Read-Only Prototype (41 tests)

| Control | Description | Status |
|---------|-------------|--------|
| P12-A | Hermes DB schema (hermes_api_keys, hermes_sessions) with RLS | Active |
| P12-B | API key auth on all Hermes endpoints | Active |
| P12-C | POST /hermes/invoke + /hermes/session + /hermes/tools | Active |
| P12-D | Prompt injection guard (14 patterns) | Active |
| P12-E | Session tool call budget (default 50, configurable) | Active |
| P12-F | Rate limiting (20 req/min for Hermes) | Active |
| P12-G | Read-only tool allowlist (8 tools) | Active |
| P12-H | MCP bridge invocation via invokeMcpTool | Active |
| P12-I | Outbound secret redaction on all responses | Active |
| P12-J | Audit events via recordMcpAudit | Active |
| P12-K | GET /hermes/metrics endpoint | Active |
| P12-L | Gateway payload size limit (50 KB) | Active |
| P12-M | Staging/preflight updated | Active |
| P12-N | Coverage threshold ratcheted to 75% | Active |

### P13: Coverage + Hardening Closure

| Control | Description | Status |
|---------|-------------|--------|
| P13-1 | Auto-detect and suggest skills for project agents | Active |
| P13-2 | Concurrent task dispatch via Promise.allSettled | Active |
| P13-3 | Smart context selection (task-aware file filtering) | Active |
| P13-4 | Skill provider/model hints in model-router | Active |
| P13-5 | Route permissions for skills + agent/project skill endpoints | Active |

---

## 2. Test Coverage Summary

### Test Count by Phase

| Phase | Tests | Cumulative |
|-------|-------|-----------|
| P0 | 12 | 12 |
| P1 | 57 | 69 |
| P2 | 76 | 145 |
| P3 | 14 | 159 |
| P4 | 34 | 193 |
| P5 | 23 | 216 |
| P6 | 64 | 280 |
| P7 | 9 | 289 |
| P8 | 9 | 298 |
| P9 | 52 | 350 |
| P10 | 66 | 416 |
| P10 (policy-kit) | 23 | 439 |
| P11 (scheduler soak) | 6 | 445 |
| P12 | 41 | 486 |
| RC1 (soak + observability) | 7 | **493+** |
| Session 2026-05-05 sprint | 30 | **523+** |

### Coverage Threshold History

| Phase | Coverage Threshold |
|-------|------------------|
| P0-P9 | 50% |
| P10 | 65% |
| P11 | 70% |
| P12 | 75% |
| RC1 target | 80% |

### Test Quality Notes

- All tests run serialized (`fileParallelism: false`) due to shared DB state.
- Engine access patterns updated to factory function calls (`taskEngine()`,
  `pipelineEngine()`, `executionEngine()`).
- `e2e-pipeline.test.ts`: 13/13 pass (was 13/13 failing before engine factory
  migration).
- `incremental-planner.test.ts`: mock updated for function accessor pattern.
- No `as any` in test code.

---

## 3. Soak Test Readiness

### Systems Pending Soak

| System | Feature Flag | Status |
|--------|-------------|--------|
| Hermes | `OSCORPEX_ENABLE_HERMES=true` | Ready for soak |
| Gateway | `OSCORPEX_ENABLE_GATEWAY=true` | Ready for soak |
| Scheduler | `OSCORPEX_ENABLE_SCHEDULER=true` | Ready for soak |

All three are **disabled by default** in production. Soak is conducted in staging
with production-equivalent traffic replay.

### Soak Duration

7–14 days per system, run concurrently. See `docs/production/soak-test-configurations.md`
for detailed metric targets and success criteria.

### Mid-Soak Checkpoint (Day 7)

A mandatory Go/No-Go assessment at Day 7 evaluates:
- Zero write-tool executions via Hermes/Gateway
- Zero cross-tenant access events
- < 1% API error rate for all three systems
- 100% audit event coverage
- Zero unredacted secrets

Failure of any criterion halts the soak and triggers P0/P1 incident response.

---

## 4. Security Review Status

### Completed Reviews

| Review | Date | Status |
|--------|------|--------|
| RLS policy audit (`pg_policies` gap analysis) | 2026-05-14 | Pass |
| Docker socket isolation | 2026-05-14 | Pass |
| MCP write-tool policy enforcer | 2026-05-14 | Pass |
| Prompt injection pattern review (14 Hermes + 23 Gov) | 2026-05-14 | Pass |
| Secret guard coverage (25+ patterns) | 2026-05-14 | Pass |
| Approval ID single-use enforcement | 2026-05-14 | Pass |
| Sandbox path check (realpath + symlink) | 2026-05-14 | Pass |
| Budget circuit breaker | 2026-05-14 | Pass |
| Rate limiting per endpoint | 2026-05-14 | Pass |

### Open Items (Pre-Production)

| Item | Priority | Target |
|------|----------|--------|
| `GET /hermes/health` endpoint missing | P1 | Before production |
| `GET /gateway/health` endpoint missing | P1 | Before production |
| `GET /gateway/metrics` endpoint missing | P1 | Before production |
| Scheduler audit events not persisted to DB | P1 | Before production |
| Hermes metrics ephemeral (in-memory only) | P1 | Before production |
| Redis-backed rate limit counters (multi-instance) | P1 | Before multi-instance |
| Unicode/homoglyph injection patterns | P2 | RC2 |
| LLM secondary injection classifier | P3 | RC2 (advisory only) |
| Canary secret redaction audit mode | P2 | First 30 days |

---

## 5. Go/No-Go Criteria Evaluation

### Hard Gates (All must be YES)

| Criterion | Current Status | Go? |
|-----------|---------------|-----|
| 0 write tool executions via Hermes (staging) | Soak pending | TBD |
| 0 write tool executions via Gateway (staging) | Soak pending | TBD |
| 0 data mutations from Scheduler (staging) | Soak pending | TBD |
| 0 cross-tenant access events in soak | Soak pending | TBD |
| 0 unredacted secrets in soak | Soak pending | TBD |
| < 1% API error rate across all systems (soak) | Soak pending | TBD |
| 100% MCP audit coverage (soak) | Soak pending | TBD |
| All P1 observability gaps resolved | In progress | TBD |
| TypeScript strict mode: 0 errors | YES | GO |
| 523+ tests passing | YES | GO |
| Coverage threshold 75% met | YES | GO |
| RLS on all 85 tables verified | YES | GO |
| JWT auth on all non-public routes | YES | GO |

### Soft Gates (Should be YES — documented exception if No)

| Criterion | Current Status | Go? |
|-----------|---------------|-----|
| Coverage threshold 80% (RC1 target) | 75% (P12 threshold) | PARTIAL — target 80% in RC2 |
| Redis-backed rate limit counters | In-memory (single instance) | PARTIAL — acceptable for RC1 single-instance |
| `GET /hermes/health` + `/gateway/health` | Missing | NO — must fix before production |
| Grafana dashboards provisioned | Planned | NO — required before launch day |
| Alert rules live in production | Planned | NO — required before launch day |

---

## 6. Known Risks and Mitigations

### Risk 1: Novel Prompt Injection Patterns

**Risk**: Attacker uses Unicode homoglyphs or encoding variants to bypass the 14
Hermes injection patterns.

**Likelihood**: Medium (known attack class).
**Impact**: High if bypass leads to write tool invocation attempt.
**Mitigation**: Write tools have a second independent block (tool policy enforcer).
Even a successful injection bypass cannot execute a write tool. Secondary mitigation:
add Unicode normalization to injection scanner (RC2).

### Risk 2: Secret Guard Pattern Gap

**Risk**: A new provider introduces an API key format not in the 25-pattern list.

**Likelihood**: Low (known providers catalogued).
**Impact**: Medium (secret in response, not in persistent storage).
**Mitigation**: Canary secret audit mode (planned); quarterly pattern review
schedule defined in `secret-redaction-review-rc1.md`.

### Risk 3: Rate Limit Counter Split (Multi-Instance)

**Risk**: In a horizontally scaled deployment, each kernel instance has an independent
in-memory rate limit counter. Attacker can exceed rate limits by spreading requests
across instances.

**Likelihood**: Low (RC1 is single-instance staging soak).
**Impact**: Medium (DoS or budget abuse vector).
**Mitigation**: Redis-backed counter required before multi-instance production
deploy. Documented as P1 gap in `observability-review-rc1.md`.

### Risk 4: Soak Discovers Unexpected Behaviour

**Risk**: 7-14 day soak reveals edge cases in Hermes session management or Gateway
payload handling not covered by unit tests.

**Likelihood**: Low-Medium (unit tests are thorough but cannot cover all production
traffic patterns).
**Impact**: Low-Medium (systems disabled by default; disable flag is the containment).
**Mitigation**: Soak success criteria are conservative. Any anomaly triggers a halt
and RCA before production.

### Risk 5: Observability Gap During Incident

**Risk**: Missing `/gateway/health`, `/hermes/health`, and gateway metrics endpoint
could delay incident detection.

**Likelihood**: Medium (these gaps are known and unresolved).
**Impact**: Medium (detection delay, not data loss).
**Mitigation**: These are P1 items blocked for production. They must be implemented
before production launch.

---

## 7. Recommended Monitoring — First 48 Hours Post-Deploy

### Hour 0–4: Baseline Verification

- [ ] Confirm all three feature flags (`HERMES`, `GATEWAY`, `SCHEDULER`) are set
  to `false` in production.
- [ ] Verify `GET /health`, `GET /health/db`, `GET /health/providers` all return
  healthy.
- [ ] Confirm Grafana dashboards are receiving data.
- [ ] Confirm PagerDuty alert rules are active.
- [ ] Run a single pilot pipeline to verify end-to-end flow.

### Hour 4–24: Soft Launch

- [ ] Monitor HTTP error rate (target: < 1%).
- [ ] Monitor DB connection pool utilisation (target: < 50%).
- [ ] Monitor task completion rate (target: > 90%).
- [ ] Confirm no budget circuit breaker trips.
- [ ] Confirm no `tenant_mismatch` audit events.
- [ ] Confirm no injection detection events (no Hermes/Gateway enabled yet).

### Hour 24–48: Stability Confirmation

- [ ] Review all P2/P3 alert events; triage any anomalies.
- [ ] Confirm adaptive concurrency is stabilising (semaphore not hitting max).
- [ ] Review DB slow query log; no regressions.
- [ ] Confirm scheduler is NOT yet enabled in production (soak must complete first).
- [ ] All-hands status: Go/No-Go for first tenant onboarding.

### Escalation During First 48 Hours

Any P0 alert during first 48 hours triggers **immediate halt** and full team
mobilisation regardless of time of day. On-call engineer has authority to roll back
to previous kernel version without seeking approval.

---

## 8. Sign-Off Section

### Technical Sign-Off

| Role | Name | Decision | Date |
|------|------|----------|------|
| Platform Engineering Lead | | GO for staging soak / NO-GO for production | |
| Security Reviewer | | GO for staging soak / NO-GO for production | |
| Infrastructure Lead | | GO for staging soak / NO-GO for production | |

**Note**: Production sign-off requires a separate review after soak completion,
all P1 observability gaps resolved, and Grafana + alert rules deployed.

### Soak Sign-Off (Post-Soak — Fill After Day 14)

| System | Soak Duration | All Criteria Met? | Sign-Off |
|--------|--------------|------------------|---------|
| Hermes | | | |
| Gateway | | | |
| Scheduler | | | |

### Production Go/No-Go (Post-Soak)

| Criterion | Status | Decision |
|-----------|--------|---------|
| All hard gates passed | | |
| All P1 observability gaps resolved | | |
| Grafana dashboards live | | |
| Alert rules active | | |
| Tabletop exercises completed | | |
| First 48hr monitoring plan reviewed by on-call | | |
| **FINAL DECISION** | | **GO / NO-GO** |

---

## Appendix A: Environment Variable Quick Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `OSCORPEX_ENABLE_HERMES` | `false` | Enable Hermes read-only prototype |
| `OSCORPEX_ENABLE_GATEWAY` | `false` | Enable Gateway subsystem |
| `OSCORPEX_ENABLE_SCHEDULER` | `false` | Enable read-only scheduler |
| `OSCORPEX_ENABLE_MCP_WRITE_TOOLS` | `false` | Enable write-tool pipeline |
| `OSCORPEX_ALLOW_MCP_WRITE_IN_PROD` | `false` | Explicit production write opt-in |
| `JWT_SECRET` | — | Must be set; min 32 bytes |
| `DATABASE_URL` | — | Least-privilege app user (not superuser) |
| `NODE_ENV` | — | Must be `production` in prod |
| `HOST` | `127.0.0.1` | Bind address; override for cluster |

## Appendix B: Key File Locations

| Component | Path |
|-----------|------|
| Secret guard | `apps/kernel/src/studio/secret-guard.ts` |
| Prompt injection guard (Hermes) | `apps/kernel/src/studio/hermes-routes.ts` |
| Prompt injection guard (Gov) | `apps/kernel/src/studio/learning-governance.ts` |
| Tool policy enforcer | `apps/kernel/src/studio/tool-policy-enforcer.ts` |
| Scheduler policy | `apps/kernel/src/studio/scheduler-policy.ts` |
| Budget guard | `apps/kernel/src/studio/budget-guard.ts` |
| Sandbox manager | `apps/kernel/src/studio/sandbox-manager.ts` |
| Performance config | `apps/kernel/src/studio/performance-config.ts` |
| DB schema | `apps/kernel/scripts/init.sql` |
| Alert thresholds | `docs/production/alert-thresholds-rc1.md` |
| Soak configurations | `docs/production/soak-test-configurations.md` |
| Observability review | `docs/production/observability-review-rc1.md` |
| Incident response | `docs/production/incident-response-tabletop-rc1.md` |

---

*RC1 Release Candidate Report — Oscorpex Platform Engineering — 2026-05-14*
*Next review: Post-soak (Day 14) for production Go/No-Go.*
