# Beta-1: Monitoring Ownership

**Version**: Beta-1.0
**Date**: 2026-05-14
**Status**: Operational

---

## 1. Purpose

This document assigns monitoring responsibilities for the Beta-1 period. Each
dashboard panel, alert group, and log stream has a named owner. The owner is
responsible for reviewing their area during the first 48 hours (intensive watch)
and continuing at the cadence described for the remainder of the beta period.

---

## 2. Dashboard Assignments

### 2.1 Kernel Overview Dashboard

**Owner**: On-Call Engineer (rotating)
**Review frequency**: Every 30 minutes during first 48 hours; every 4 hours thereafter

| Panel | Metric | Alert Threshold | Owner |
|-------|--------|----------------|-------|
| Request rate | req/min by endpoint | > 500/min overall | On-Call |
| Error rate | 4xx + 5xx / total | > 5% over 5 min window | On-Call |
| p50 / p95 / p99 latency | Response time ms | p99 > 5000ms | On-Call |
| Active WebSocket connections | Connection count | > 100 concurrent | On-Call |
| DB pool utilization | Connections used / max | > 80% of pool | Infra Lead |
| Heap memory usage | Node.js RSS bytes | > 1.5 GB | Infra Lead |

### 2.2 Security Dashboard

**Owner**: Security Lead
**Review frequency**: Every hour during first 48 hours; daily thereafter

| Panel | Metric | Alert Threshold | Owner |
|-------|--------|----------------|-------|
| Authentication failures | 401 responses by tenant | > 20/min per tenant | Security Lead |
| Rate limit hits | 429 responses by tenant | > 50 hits in 10 min | Security Lead |
| Prompt injection detections | Detection events/hour | Any detection fires alert | Security Lead |
| Audit event stream | Events/min | Drop to 0 for > 2 min | Security Lead |
| Approval submissions | Approvals per hour | Sudden spike > 10x baseline | Security Lead |

### 2.3 Agent Pipeline Dashboard

**Owner**: Platform Engineering
**Review frequency**: Every 2 hours during first 48 hours; daily thereafter

| Panel | Metric | Alert Threshold | Owner |
|-------|--------|----------------|-------|
| Active pipelines | Pipeline count by status | > 20 active simultaneously | Platform Eng |
| Task completion rate | Tasks completed/hour | < 1 task/hour when pipelines active | Platform Eng |
| Agent session duration | Median session time | > 30 minutes per session | Platform Eng |
| Tool call budget hits | Budget exceeded events | Any budget exhaustion | Platform Eng |
| Retry rate | Retried tasks / total | > 30% retry rate | Platform Eng |
| Provider availability | Probe success rate | < 90% over 5 min | Platform Eng |

### 2.4 Tenant Activity Dashboard

**Owner**: Product Lead
**Review frequency**: Daily

| Panel | Metric | Alert Threshold | Owner |
|-------|--------|----------------|-------|
| API calls per tenant | Calls by tenant ID | Sudden > 5x spike vs baseline | Product Lead |
| Projects created | New projects per day | No activity for > 3 days | Product Lead |
| Feedback events | Bug reports / feature requests | — (informational) | Product Lead |

---

## 3. On-Call Rotation

### 3.1 Beta-1 On-Call Schedule

The beta-1 on-call rotation covers the full beta period. Each shift is 24 hours.

| Date | Primary On-Call | Backup |
|------|----------------|--------|
| Beta Day 1-2 | *(assign before launch)* | *(assign before launch)* |
| Beta Day 3-7 | *(assign before launch)* | *(assign before launch)* |
| Beta Day 8-14 | *(assign before launch)* | *(assign before launch)* |

**Before launch**: Fill in the table above with actual names and confirm
availability in the `#oscorpex-beta-1` Slack channel.

### 3.2 On-Call Responsibilities

Primary on-call must:
- Monitor PagerDuty alerts (must acknowledge P0/P1 within 5 minutes)
- Review the kernel overview dashboard at the defined cadence
- Be reachable via phone/Slack during their shift (response < 5 minutes)
- Escalate immediately for any P0 incident (see `beta1-alert-escalation.md`)
- Write a brief shift handoff note at the end of each 24-hour shift

Backup on-call must:
- Be available within 15 minutes if primary is unreachable
- Take over immediately if primary escalates a P0 incident

### 3.3 On-Call Tooling Access

Before the shift, verify the on-call engineer has:
- [ ] PagerDuty account with escalation policy assigned
- [ ] Grafana read access to all beta dashboards
- [ ] Loki / log aggregation access for log queries
- [ ] Database read access (read replica preferred) for incident investigation
- [ ] `kubectl` or Docker access to restart the kernel container if needed
- [ ] Access to the rollback script and documented rollback procedure

---

## 4. Escalation Path

```
Tier 1: On-Call Engineer
  |
  | (cannot resolve in 15 min OR P0/P1 detected)
  v
Tier 2: Engineering Lead
  |
  | (confirmed security incident OR data breach)
  v
Tier 3: Security Lead + Infrastructure Lead (parallel escalation)
  |
  | (all-hands required OR external communication needed)
  v
Tier 4: Product Lead + Executive Sponsor
```

For detailed escalation rules by severity, see `beta1-alert-escalation.md`.

---

## 5. First 48 Hours — Critical Metrics

The first 48 hours after any beta tenant makes their first API call are the
highest-risk period. The following metrics must be watched continuously:

### 5.1 Security Signals (watch every 30 minutes)

1. **Authentication failure rate**: Baseline is near zero. Any sustained rate above
   5 failures/minute from a single tenant warrants investigation.

2. **Cross-tenant probe attempts**: The tenant isolation test logs a warning when a
   request contains a different tenant's ID in the path. Any occurrence is an
   immediate P1 incident.

3. **Prompt injection detections**: Any detection fires an alert. Review the prompt
   content and determine if it was accidental or adversarial.

4. **Feature flag bypass attempts**: Any request to `/terminal/exec`, MCP write
   endpoints, or Docker-related paths should return 404. A 200 from any of these
   is an immediate P0 incident.

### 5.2 Stability Signals (watch every 60 minutes)

1. **Error rate**: Target < 1%. If error rate exceeds 5% for 10 minutes, page
   on-call and evaluate a pause decision.

2. **Heap memory growth**: Node.js heap should stabilize after warmup. Sustained
   growth > 50 MB/hour indicates a memory leak requiring investigation.

3. **DB connection exhaustion**: Pool should stay below 80% utilization. If
   connections hit 100%, new requests will hang until a connection is freed.

4. **Response latency p99**: Should stay below 5 seconds for API endpoints.
   Spikes above 10 seconds indicate a downstream provider or DB issue.

### 5.3 Operational Signals (watch daily)

1. **Agent session completion rate**: What percentage of started sessions complete
   successfully? Baseline from staging soak is the reference point.

2. **Budget utilization**: Are tenants approaching the 50 tool call session budget?
   Repeated budget exhaustion may indicate a need to adjust limits.

3. **Feedback volume**: Are tenants submitting feedback? Zero feedback after 3 days
   may indicate the feedback channel is broken or tenants are not engaging.
