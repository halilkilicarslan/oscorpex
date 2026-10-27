# Beta-1: Expansion, Pause, and Rollback Criteria

**Version**: Beta-1.0
**Date**: 2026-05-14
**Status**: Operational

---

## 1. Purpose

This document defines the explicit, measurable criteria that govern three possible
decisions during the Beta-1 period:

- **Expand**: Add more tenants or enable additional features
- **Pause**: Stop new tenant onboarding and restrict active tenant access pending investigation
- **Rollback**: Revert to the pre-beta state by halting the service and restoring the previous version

All decisions require agreement from Engineering Lead, Security Lead, and Product Lead.
A single dissenting vote prevents the decision from proceeding (veto applies to Expand only;
Pause and Rollback can be triggered unilaterally by Engineering or Security Lead in an
emergency).

---

## 2. Expand Criteria

### 2.1 Criteria to Add More Beta Tenants

All of the following must be true before expanding Beta-1 to additional tenants:

| Criterion | Threshold | Measurement Method |
|-----------|-----------|-------------------|
| No P0 or P1 incident | 14+ consecutive days | Incident log in `#oscorpex-beta-incidents` |
| Overall error rate | < 1% for the full preceding week | Grafana weekly error rate panel |
| Tenant feedback | Net positive (more positive items than blockers) | Weekly review feedback summary |
| Weekly review approval | Explicit GO vote at the most recent review | Weekly review template sign-off |
| Feature flag audit | All security flags confirmed at correct values | Manual verification by Security Lead |
| Capacity headroom | DB pool < 60% peak, heap < 1 GB | Grafana metrics for the preceding week |

### 2.2 Criteria to Enable Write MCP Tools (Beta-2 Gate)

Write tools remain disabled in Beta-1. To enable them in a future beta phase,
the following additional criteria must be met:

| Criterion | Threshold |
|-----------|-----------|
| Read-only beta period | Minimum 21 days completed |
| Approval gate hardening | Zero approval bypass incidents in Beta-1 |
| Write tool test coverage | 100% of write tool paths covered by tests |
| Security Lead sign-off | Explicit written approval |
| Canary deployment | Write tools enabled for 1 tenant only, monitored for 7 days before broad rollout |

### 2.3 Criteria to Enable Container Runtime (Beta-2/3 Gate)

| Criterion | Threshold |
|-----------|-----------|
| Container images built and scanned | All images pass vulnerability scan (no CRITICAL CVEs) |
| Docker socket isolation verified | Kernel process confirmed not running as root |
| Sandbox escape tests | Custom fuzzing test suite passes |
| Infrastructure readiness | Dedicated container pool host provisioned |
| Security Lead + Infra Lead sign-off | Explicit written approval from both |

---

## 3. Pause Criteria

Any of the following conditions triggers an automatic pause recommendation.
The on-call engineer may pause immediately; formal confirmation from Engineering Lead
within 30 minutes.

### 3.1 Automatic Pause Triggers

| Trigger | Description | Response |
|---------|-------------|----------|
| P1 incident detected | Service outage, write tool bypass, or approval gate failure | Pause new onboarding; investigate immediately |
| Error rate > 5% | API error rate exceeds 5% for more than 10 consecutive minutes | Pause new tenant activation; investigate |
| Cross-tenant data access attempt | Log entry shows a request returned data from a different tenant | Pause ALL tenant access; investigate as potential P0 |
| Write tool bypass detected | Disabled endpoint returns 200 instead of 404/403 | Pause ALL tenant access; investigate as P0 |
| Rate limit sustained abuse | Single tenant hits rate limit > 100 times in 30 minutes | Pause that tenant's key; contact tenant |
| DB pool exhaustion | Connection pool at 100% for > 5 minutes | Pause new requests via maintenance mode; investigate |
| Memory growth unchecked | Heap growth > 200 MB/hour for > 2 hours | Pause and investigate for memory leak |

### 3.2 Pause Procedure

1. Set the kernel to maintenance mode (returns 503 for non-health endpoints)
2. Notify all active beta tenants via Slack: "Beta-1 temporarily paused for maintenance. ETA: [time]"
3. Begin investigation per the appropriate escalation procedure (`beta1-alert-escalation.md`)
4. Post status updates every 30 minutes until resolved
5. Resume only after the root cause is resolved and verified

### 3.3 Unpause Criteria

Before unpausing after a triggered pause:

- Root cause identified and documented
- Fix deployed (if applicable) and verified in a test environment
- Security Lead confirms no security risk
- All active tenants notified of the resolution and resumption time
- Enhanced monitoring enabled for the 48 hours following unpause

---

## 4. Rollback Criteria

The following conditions trigger an immediate rollback. This is a more severe
action than a pause — the kernel is halted and the previous version is restored.
Rollback can be triggered by Engineering Lead or Security Lead alone without
waiting for full leadership consensus.

### 4.1 Rollback Triggers

| Trigger | Description |
|---------|-------------|
| P0 security incident | Confirmed security breach, data leak, or RCE execution |
| RLS bypass confirmed | Cross-tenant data returned in a query result and confirmed as an RLS failure (not a test artifact) |
| Secret leaked to external system | JWT secret, DB password, API key, or tenant data found in logs, responses, or external telemetry |
| Uncontrolled write execution | Agent writes a file, executes a command, or modifies the DB without a valid approval record |
| Mass data corruption | DB records for multiple tenants found in an inconsistent or corrupted state |
| Cryptographic failure | JWT signature verification fails for all tokens (key compromise or rotation failure) |

### 4.2 Rollback Procedure

```bash
# Step 1: Halt the current kernel container
docker stop oscorpex-kernel

# Step 2: Snapshot current state for forensics
docker logs oscorpex-kernel > /tmp/rollback-snapshot-$(date +%Y%m%d-%H%M%S).log
pg_dump $DATABASE_URL > /tmp/rollback-db-$(date +%Y%m%d-%H%M%S).sql

# Step 3: Identify the previous stable image
# Previous image SHA is recorded in the deployment log
PREVIOUS_SHA=$(cat /var/oscorpex/last-stable-sha)
docker pull oscorpex/kernel:${PREVIOUS_SHA}

# Step 4: Start the previous version
docker run -d \
  --name oscorpex-kernel \
  --env-file .env.beta \
  -p 3141:3141 \
  oscorpex/kernel:${PREVIOUS_SHA}

# Step 5: Verify health
curl http://localhost:3141/healthz

# Step 6: If DB migration rollback is needed, consult the migration rollback runbook
# (each migration in scripts/init.sql uses IF NOT EXISTS — assess case by case)
```

### 4.3 Post-Rollback Actions

1. Revoke all active beta API keys
2. Notify all beta tenants: "Beta-1 has been rolled back due to a critical issue. We will contact you with a timeline for resumption."
3. Begin incident response procedure (P0 by definition)
4. Do NOT resume Beta-1 until a full post-mortem is completed and the fix is verified
5. New Beta-1 start requires a fresh Go decision from all sign-off parties

---

## 5. Decision Log

Record all Expand, Pause, and Rollback decisions here during the beta period.

| Date | Decision | Trigger | Decided By | Notes |
|------|----------|---------|-----------|-------|
| | | | | |

---

## 6. Criteria Review

These criteria are reviewed at each weekly meeting. If operational experience
suggests that any threshold is too aggressive or too lenient, the criteria may
be adjusted by agreement of Engineering Lead and Security Lead, with the change
documented in the revision history below.

**Revision History**:

| Version | Date | Change | Changed By |
|---------|------|--------|-----------|
| 1.0 | 2026-05-14 | Initial criteria defined | Platform Engineering |
