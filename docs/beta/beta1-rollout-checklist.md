# Beta-1: Rollout Checklist

**Version**: Beta-1.0
**Date**: 2026-05-14
**Owner**: Platform Engineering

Execute this checklist in order. Do not proceed to the next section until all
items in the current section are checked. Items marked with [BLOCKER] will halt
the rollout if not resolved.

---

## Phase 1: Pre-Deployment Verification

### 1.1 Code and Build

- [ ] [BLOCKER] `pnpm typecheck` passes with zero errors across all workspaces
- [ ] [BLOCKER] `pnpm lint` passes with zero errors (biome check)
- [ ] [BLOCKER] `pnpm build` completes successfully for all packages and apps
- [ ] [BLOCKER] `pnpm test` passes — all 539+ tests green, no skipped tests
- [ ] Coverage thresholds met: lines >= 80%, functions >= 80%, branches >= 75%
- [ ] No `as any` in source files without documented justification
- [ ] Source maps generated and verified for kernel and console bundles

### 1.2 Staging Soak Completed (RC1)

- [ ] [BLOCKER] 7-14 day staging soak completed on RC1 branch
- [ ] [BLOCKER] All RC1 gate criteria met (see `docs/reports/RC1_SOAK_FINAL_REPORT.md`)
- [ ] Soak test results archived and accessible to the incident response team
- [ ] No P0 or P1 incidents occurred during the soak period
- [ ] Error rate during soak: < 1% over the final 48 hours
- [ ] No anomalous memory growth or connection pool exhaustion observed

---

## Phase 2: Infrastructure Readiness

### 2.1 Production Preflight

- [ ] [BLOCKER] Production PostgreSQL connection verified with least-privilege user
- [ ] [BLOCKER] Database schema migration (`scripts/init.sql`) applied and verified
- [ ] All 85 tables created; `pg_tables` shows expected row count
- [ ] `FORCE ROW LEVEL SECURITY` confirmed active on all multi-tenant tables
- [ ] Connection pool configured: `DB_POOL_MIN=2`, `DB_POOL_MAX=10`
- [ ] DB user is not `postgres` or a superuser
- [ ] `DATABASE_URL` not present in any committed file or environment printout
- [ ] Backup scheduled and first backup taken before rollout begins

### 2.2 Kernel Deployment

- [ ] [BLOCKER] Kernel container starts without error logs in the first 30 seconds
- [ ] [BLOCKER] `GET /healthz` returns HTTP 200 within 5 seconds of startup
- [ ] `HOST=127.0.0.1` confirmed (not `0.0.0.0`) or reverse proxy handling TLS termination
- [ ] `NODE_ENV=production` set in environment
- [ ] `JWT_SECRET` is a minimum 32-character random string from the secure vault
- [ ] `JWT_SECRET` is NOT a default, placeholder, or commit-visible value
- [ ] Ports confirmed: 3141 (kernel), 5161 (console), 3142 (WebSocket)
- [ ] Docker socket NOT mounted into the kernel container (P0 RCE prevention)
- [ ] preflight warmup completes: `OSCORPEX_PREFLIGHT_ENABLED=true`

### 2.3 Tenant Isolation Verified

*Verify tenant isolation at the DB and API layers before any tenant connects.*

- [ ] [BLOCKER] Tenant isolation test suite passes: `pnpm test -- --testPathPattern=tenant-isolation`
- [ ] [BLOCKER] Manual cross-tenant probe: Tenant A cannot read Tenant B's projects
- [ ] RLS policies verified via direct DB query (see `beta1-access-model.md` Section 7.3)
- [ ] Per-tenant workspace directories are isolated with correct ownership
- [ ] Sandbox path scope checks verified: symlink traversal outside workspace is blocked

---

## Phase 3: Feature Flag Configuration

### 3.1 Security Flags

- [ ] [BLOCKER] `OSCORPEX_DEV_NO_AUTH=false` — auth bypass disabled
- [ ] [BLOCKER] `OSCORPEX_ENABLE_TERMINAL_EXEC=false` — terminal RCE surface closed
- [ ] [BLOCKER] `OSCORPEX_ENABLE_MCP_WRITE_TOOLS=false` — write tools disabled
- [ ] [BLOCKER] `OSCORPEX_ALLOW_MCP_WRITE_IN_PROD=false` — write tools double-gated
- [ ] [BLOCKER] `OSCORPEX_ALLOW_DOCKER_SOCKET_IN_PROD=false` — Docker RCE surface closed
- [ ] `OSCORPEX_ENABLE_CONTAINER_RUNTIME=false` — container pool not provisioned

### 3.2 Feature Flags

- [ ] `OSCORPEX_ENABLE_GATEWAY=true` — Gateway enabled for beta validation
- [ ] `OSCORPEX_ENABLE_HERMES=true` — Hermes enabled for beta validation
- [ ] `OSCORPEX_ENABLE_SCHEDULER=true` — Scheduler enabled for pipeline testing
- [ ] `OSCORPEX_PREFLIGHT_ENABLED=true` — Preflight warmup active

### 3.3 Flag Verification

- [ ] Unauthenticated request to `/api/studio/projects` returns 401 (not 200)
- [ ] `POST /api/studio/terminal/exec` returns 404 or "feature disabled"
- [ ] MCP capabilities endpoint reports `write_tools_enabled: false`
- [ ] All flags logged to structured output at startup (visible in kernel logs)

---

## Phase 4: Monitoring and Alerting

### 4.1 Monitoring Dashboards Active

- [ ] [BLOCKER] Grafana kernel overview dashboard loading with live data
- [ ] [BLOCKER] Error rate panel showing data (not "No data")
- [ ] Request latency (p50, p95, p99) panels showing data
- [ ] Rate limit hit counter panel configured and showing data
- [ ] Tenant activity breakdown panel configured
- [ ] DB connection pool utilization panel showing data
- [ ] Agent session duration and budget consumption panels showing data

### 4.2 Alert Channels Configured

- [ ] [BLOCKER] PagerDuty (or equivalent) integration active for P0 and P1 alerts
- [ ] Slack `#oscorpex-incidents` channel receiving alert messages (test alert sent)
- [ ] Email escalation list configured for P2 and above
- [ ] On-call engineer rotation active for the beta period (see `beta1-monitoring-ownership.md`)
- [ ] Runbook URLs embedded in each alert rule
- [ ] Alert deduplication configured (suppress repeat alerts within 5-minute window)

### 4.3 Log Aggregation

- [ ] Kernel structured JSON logs flowing to Loki or equivalent
- [ ] Log retention policy set: 90 days minimum
- [ ] Pino log format verified: all entries have `level`, `module`, `timestamp`, `msg`
- [ ] `tenant_id` present on all request-scoped log entries
- [ ] Audit event stream writing to `audit_events` table (spot check 5 events)

---

## Phase 5: Incident Response Readiness

### 5.1 Incident Response Team Assigned

- [ ] [BLOCKER] On-call lead identified and confirmed available for the first 48 hours
- [ ] Backup on-call identified and confirmed available
- [ ] Escalation contacts confirmed: security lead, infrastructure lead, product lead
- [ ] Incident response runbook (`beta1-alert-escalation.md`) reviewed by all on-call team
- [ ] War room channel (`#oscorpex-beta-incidents`) created and team added

### 5.2 Backup and Restore Procedure Verified

- [ ] [BLOCKER] PostgreSQL backup taken and restore tested to a separate instance
- [ ] Restore time measured and documented (target: < 4 hours for full restore)
- [ ] Backup schedule confirmed: daily full backup, hourly WAL archiving
- [ ] Backup integrity check (checksums) verified
- [ ] Tenant data isolation preserved after restore (RLS policies survive pg_dump/restore)

### 5.3 Rollback Procedure Verified

- [ ] [BLOCKER] Container image tagged with Git SHA before deployment
- [ ] Previous container image accessible and can be deployed within 15 minutes
- [ ] Rollback script tested in staging: `scripts/rollback.sh <previous-sha>`
- [ ] Database rollback strategy documented (migration reversibility assessed)
- [ ] Rollback triggers documented: P0 incident, RLS bypass, uncontrolled write execution
- [ ] All team members know the rollback command and have permissions to execute it

---

## Phase 6: Beta Tenant Onboarding

### 6.1 Beta Tenant Onboarded

- [ ] Tenant selection criteria verified (see `beta1-tenant-selection.md`)
- [ ] Beta consent form signed by each tenant
- [ ] API key created per tenant with correct scope and 30-day expiry
- [ ] Rate limit profile applied to each tenant's API key
- [ ] Monitoring alert configured for each tenant ID
- [ ] Each tenant has completed the smoke test (see `beta1-tenant-selection.md` Step 4)
- [ ] Tenant registered in the tenant registry table in `beta1-tenant-selection.md`

### 6.2 Feedback Channel Established

- [ ] [BLOCKER] Beta tenant added to `#oscorpex-beta-1` Slack channel
- [ ] Bug report template shared with each tenant (see `beta1-feedback-loop.md`)
- [ ] Feature request template shared with each tenant
- [ ] GitHub private beta tracking issue created and tenants invited as collaborators
- [ ] First weekly sync scheduled and calendar invite accepted by tenant

### 6.3 Weekly Review Scheduled

- [ ] Weekly review calendar event created (every Monday, 60 minutes)
- [ ] `beta1-weekly-review-template.md` shared with all review participants
- [ ] First weekly review date confirmed: _______________
- [ ] Review owner assigned: _______________
- [ ] Action item tracking method confirmed (GitHub issue, spreadsheet, etc.)

---

## Phase 7: Go / No-Go Decision

Complete all items above, then obtain formal sign-off from the following roles:

| Role | Name | Decision | Date |
|------|------|----------|------|
| Engineering Lead | | GO / NO-GO | |
| Security Lead | | GO / NO-GO | |
| Infrastructure Lead | | GO / NO-GO | |
| Product Lead | | GO / NO-GO | |

**A single NO-GO from any role halts the rollout.**

Document the decision, all open items, and the next review date in the weekly
review log before communicating status to beta tenants.
