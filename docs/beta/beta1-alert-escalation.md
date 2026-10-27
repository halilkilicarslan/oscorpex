# Beta-1: Alert Escalation Runbook

**Version**: Beta-1.0
**Date**: 2026-05-14
**Status**: Operational

---

## 1. Severity Definitions

| Severity | Response Time | Definition |
|----------|--------------|------------|
| P0 | Immediate — all hands | Security breach, data leak, RCE execution, RLS bypass confirmed |
| P1 | 15 minutes | Service outage, write tool bypass, cross-tenant data access attempt |
| P2 | 1 hour | Elevated error rate (> 5%), rate limit spike, provider unavailability > 10 min |
| P3 | Next business day | Minor UX regression, performance degradation within SLO, non-critical bug |

---

## 2. P0 — Immediate Response (All Hands)

### 2.1 Triggers

- Confirmed security breach (unauthorized data access, exfiltrated credentials)
- Data leak: tenant data visible to another tenant or external system
- Remote code execution (RCE) achieved via any vector
- PostgreSQL RLS bypass confirmed (cross-tenant row visible in query results)
- Secret (JWT secret, API key, DB password) leaked to logs, external system, or response body
- Uncontrolled write execution (file mutation without approval gate)

### 2.2 Immediate Actions (within 5 minutes)

1. **STOP** — Halt the kernel process immediately:
   ```bash
   # Docker deployment
   docker stop oscorpex-kernel

   # Direct process
   kill -SIGTERM <kernel-pid>
   ```

2. **ISOLATE** — Revoke all active API keys:
   ```bash
   pnpm --filter @oscorpex/kernel tsx src/scripts/revoke-all-keys.ts --reason "P0-incident"
   ```

3. **PRESERVE** — Snapshot logs before any system changes:
   ```bash
   docker logs oscorpex-kernel > /tmp/incident-$(date +%Y%m%d-%H%M%S).log
   pg_dump $DATABASE_URL > /tmp/incident-db-$(date +%Y%m%d-%H%M%S).sql
   ```

4. **NOTIFY** — Post in `#oscorpex-beta-incidents` immediately:
   ```
   [P0] Incident detected. Kernel halted at <timestamp>. RCA in progress.
   ```
   Page: Engineering Lead, Security Lead, Infrastructure Lead (parallel).

5. **DO NOT** restart the kernel until root cause is identified and patched.

### 2.3 Investigation Checklist

- [ ] Identify the affected tenant(s)
- [ ] Determine the attack vector (API path, payload, auth token)
- [ ] Check audit_events table for the incident window
- [ ] Review RLS policies — confirm no policy is missing or misconfigured
- [ ] Confirm feature flags — check `OSCORPEX_ENABLE_TERMINAL_EXEC`, `OSCORPEX_ALLOW_MCP_WRITE_IN_PROD`
- [ ] Review kernel logs for any `warn` or `error` entries in the 30 minutes before detection
- [ ] Determine if any data was written to the database or filesystem without approval

### 2.4 Resolution Criteria

Before restarting the kernel:
- Root cause identified and documented
- Fix implemented and tested in staging
- Security Lead approval obtained in writing
- Incident report draft started (due within 24 hours of resolution)

---

## 3. P1 — 15-Minute Response (On-Call)

### 3.1 Triggers

- Service outage: kernel health check (`GET /healthz`) failing for > 3 minutes
- Write tool bypass: any request to a disabled write endpoint returns 200 instead of 404
- Cross-tenant data access attempt detected in logs (warning from RLS guard)
- Database connection pool fully exhausted (0 available connections for > 2 minutes)
- JWT secret rotation failure (all tokens invalid after a key rotation)
- Approval gate bypassed: task execution without a matching approval record

### 3.2 Response Procedure (within 15 minutes)

1. Acknowledge the PagerDuty alert — prevent automatic escalation
2. Assess: Is the system safe to remain running? If write tool bypass or cross-tenant
   access is confirmed, escalate to P0 immediately.
3. Post in `#oscorpex-incidents`:
   ```
   [P1] <description>. Investigating. ETA for update: <time + 15 min>
   ```
4. Begin investigation:
   - Check kernel health: `curl http://localhost:3141/healthz`
   - Check error rate in Grafana (last 10 minutes)
   - Check DB connectivity: `psql $DATABASE_URL -c "SELECT 1"`
   - Check container status: `docker ps | grep oscorpex`
5. Apply fix or restart if safe. For write tool bypass or cross-tenant issues, escalate to P0.

### 3.3 Common P1 Scenarios

**Kernel unresponsive (health check failing)**:
```bash
# Check container status
docker inspect oscorpex-kernel | jq '.[0].State'

# Check for OOM kill
dmesg | grep -i oom | tail -5

# Restart if no security concern
docker restart oscorpex-kernel
# Verify restart within 60 seconds
curl http://localhost:3141/healthz
```

**DB connection pool exhausted**:
```bash
# Check active connections
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity WHERE datname='oscorpex';"

# Check for long-running queries
psql $DATABASE_URL -c "SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE query != '<IDLE>' AND query_start < now() - interval '5 minutes';"

# Terminate runaway queries if safe
psql $DATABASE_URL -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
WHERE datname='oscorpex' AND query_start < now() - interval '10 minutes';"
```

---

## 4. P2 — 1-Hour Response (Team Lead)

### 4.1 Triggers

- Error rate > 5% for more than 10 consecutive minutes
- Rate limit spike: a single tenant exceeds their limit > 50 times in 10 minutes
- Provider unavailability: Claude/Codex/Cursor all unavailable for > 10 minutes
- Response latency p99 > 10 seconds sustained for > 5 minutes
- Memory growth: kernel heap increasing > 100 MB/hour for 2+ consecutive hours
- Hermes session budget exhausted by multiple sessions repeatedly

### 4.2 Response Procedure (within 1 hour)

1. Acknowledge the Slack alert (not PagerDuty — P2 is non-paging by default)
2. Post a status update in `#oscorpex-incidents`
3. Investigate using Grafana and Loki logs
4. If the issue resolves on its own, document the cause and add a monitoring note
5. If the issue persists beyond 30 minutes without a clear path to resolution,
   escalate to on-call engineer (treat as P1)
6. Schedule a post-mortem for any P2 that lasted > 30 minutes

### 4.3 Rate Limit Spike Response

If a single tenant is repeatedly hitting rate limits:
1. Contact the tenant's point of contact to understand the use case
2. Determine if the limit is appropriate or needs adjustment
3. If the tenant's behaviour is adversarial or violates the usage policy, revoke the key
4. Document the interaction in the weekly review log

---

## 5. P3 — Next Business Day (Team)

### 5.1 Triggers

- Minor UX regression reported by a tenant (non-blocking workflow issue)
- Performance degradation within SLO boundaries (p50 elevated but p99 acceptable)
- Non-critical bug: UI error, cosmetic rendering issue, non-blocking API quirk
- Feature request or feedback that requires triage
- Test failure in a non-critical test file after a code change

### 5.2 Response Procedure

1. Log the issue in the GitHub beta tracking issue with the `p3` label
2. Triage in the next scheduled weekly review
3. Assign to an engineer with a target resolution date
4. Communicate status to the reporting tenant within 1 business day

---

## 6. Alert Rules Reference

### 6.1 Critical Alerts (P0/P1 — PagerDuty)

| Alert Name | Condition | Action |
|------------|-----------|--------|
| `kernel-down` | `/healthz` fails for 3+ consecutive checks (1 min interval) | P1 → restart |
| `rls-bypass-detected` | Any cross-tenant row returned in audit | P0 → halt |
| `write-tool-enabled` | MCP write endpoint returns 200 | P0 → halt |
| `terminal-exec-enabled` | `/terminal/exec` returns 200 | P0 → halt |
| `db-pool-exhausted` | Pool utilization = 100% for > 2 minutes | P1 → investigate |
| `auth-failure-spike` | > 50 auth failures in 1 minute | P1 → investigate |

### 6.2 Warning Alerts (P2 — Slack)

| Alert Name | Condition | Action |
|------------|-----------|--------|
| `error-rate-high` | Error rate > 5% for 10 minutes | P2 → team lead |
| `latency-p99-high` | p99 > 10 seconds for 5 minutes | P2 → team lead |
| `rate-limit-abuse` | Single tenant > 50 rate limit hits in 10 minutes | P2 → contact tenant |
| `provider-all-unavailable` | All provider probes failing > 10 minutes | P2 → investigate |
| `memory-growth` | Heap growth > 100 MB/hour sustained | P2 → investigate |
| `injection-detected` | Any prompt injection event | P2 → security review |

---

## 7. Post-Incident Requirements

### 7.1 P0 Incidents

- Incident report required within 24 hours of resolution
- Blameless post-mortem within 5 business days
- Affected tenants notified within 1 hour of containment
- External disclosure assessed by Security Lead and Product Lead
- Fix deployed and verified before kernel is restarted

### 7.2 P1 Incidents

- Brief incident summary posted in `#oscorpex-incidents` within 2 hours of resolution
- Root cause documented in the incident tracking issue
- Post-mortem scheduled within 10 business days if the incident was non-trivial

### 7.3 P2 Incidents

- Issue logged in GitHub with `incident-p2` label
- Discussed in the next weekly review
- Resolution tracked and closed with a comment

### 7.4 All Incidents

- Timeline (detection, acknowledgement, resolution) recorded
- Action items added to the weekly review template
- Monitoring/alert rule improvements considered
