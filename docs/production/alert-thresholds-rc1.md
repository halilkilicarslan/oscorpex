# RC1-K: Alert Threshold Definitions

**Version**: 1.0
**Date**: 2026-05-14
**Scope**: All alert conditions for Oscorpex kernel post-RC1 deploy
**Channels**: PagerDuty (P0/P1 page), Slack `#oscorpex-alerts` (P1/P2/P3 notify)

---

## Severity Definitions

| Severity | SLA | Response |
|----------|-----|----------|
| **P0** | Immediate — wake anyone | Security breach or data loss; halt service |
| **P1** | < 15 min acknowledgement | Service degraded or security boundary at risk |
| **P2** | < 1 hr acknowledgement | Anomaly requiring investigation; no immediate data risk |
| **P3** | Business hours / daily report | Trend to watch; no urgency |

---

## Alert Table

| Alert | Condition | Severity | Channel | Auto-action |
|-------|-----------|----------|---------|-------------|
| **Error rate spike** | HTTP 5xx > 5% over any 5-min window | P1 | PagerDuty + Slack | — |
| **RLS bypass attempt** | Any `tenant_mismatch` audit event | P0 | PagerDuty + Slack (immediate) | Kill session |
| **Secret leak detected** | Redaction miss in canary audit | P0 | PagerDuty + Slack (immediate) | Halt endpoint |
| **Prompt injection spike** | > 10 `injection_detected` events in 1 hr | P1 | Slack | — |
| **Session budget abuse** | > 5 session exhaustions / hr / tenant | P2 | Slack | — |
| **Write tool via Hermes** | Any `action: deny` on write tool via Hermes (or worse: execute) | P1 | Slack | Disable Hermes flag |
| **Write tool via Gateway** | Any `action: deny` on write tool via Gateway (or worse: execute) | P1 | Slack | Disable Gateway flag |
| **Scheduler write attempt** | Any `action: deny` from `scheduler-policy` | P1 | Slack | Disable Scheduler flag |
| **Scheduler job failure** | Any `status: failed` in scheduler audit | P2 | Slack | — |
| **DB connection pool exhaustion** | Pool utilisation > 90% for > 2 min | P1 | PagerDuty | — |
| **Checkpoint cleanup needed** | Active checkpoints > 1000 | P3 | Daily report email | — |
| **Budget circuit breaker** | Any `budget_circuit_breaker_trips` > 0 | P1 | Slack | Pipeline auto-paused |
| **Provider total outage** | All providers in cooldown simultaneously | P1 | PagerDuty | — |
| **DB connectivity failure** | `/health/db` non-200 for > 60s | P0 | PagerDuty | — |
| **Process restart loop** | Container restarts > 3 in 10 min | P1 | PagerDuty | — |
| **Task failure rate elevated** | `task_failure_rate` > 5% over 1 hr | P2 | Slack | — |
| **HTTP P99 latency degraded** | P99 latency > 2000ms sustained > 5 min | P2 | Slack | — |
| **Stale approval blocking pipeline** | Approval pending > 24 hr | P2 | Slack | — |
| **Queue depth growing** | `queue_depth` > 5 for > 10 min | P2 | Slack | — |
| **Cache hit rate degraded** | `token_cache_hit_rate` < 85% | P2 | Slack | — |
| **Cross-tenant data in response** | `tenantId` mismatch in response payload | P0 | PagerDuty (immediate) | Kill session |
| **API key brute force** | > 20 auth failures in 1 min from same IP | P1 | Slack | IP block |
| **Memory leak signal** | RSS growth > 200 MB over 6 hr without restart | P2 | Slack | — |
| **Injection detection rate drop** | Detection rate < 95% during soak canary test | P1 | Slack | — |

---

## Alert Rule Specifications

### P0: RLS Bypass Attempt

```yaml
alert: rls_bypass_attempt
expr: count(audit_events{event_type="tenant_mismatch"}) > 0
for: 0m
severity: P0
annotations:
  summary: "RLS bypass detected — immediate response required"
  runbook: "docs/production/incident-response-tabletop-rc1.md#scenario-2"
```

### P0: Secret Leak Detected

```yaml
alert: secret_leak_detected
expr: count(secret_guard_events{result="miss"}) > 0
for: 0m
severity: P0
annotations:
  summary: "Secret redaction miss — data leakage possible"
  runbook: "docs/production/incident-response-tabletop-rc1.md#scenario-5"
```

### P1: Error Rate Spike

```yaml
alert: error_rate_spike
expr: |
  sum(rate(http_requests_total{status=~"5.."}[5m]))
  /
  sum(rate(http_requests_total[5m])) > 0.05
for: 5m
severity: P1
annotations:
  summary: "HTTP 5xx rate exceeds 5% threshold"
  runbook: "docs/production/incident-response-tabletop-rc1.md#scenario-4"
```

### P1: DB Pool Exhaustion

```yaml
alert: db_pool_exhaustion
expr: db_pool_active / db_pool_max > 0.90
for: 2m
severity: P1
annotations:
  summary: "DB connection pool at {{ $value | humanizePercentage }}"
  runbook: "docs/production/incident-response-tabletop-rc1.md#db-pool-runbook"
```

### P1: Write Tool via Hermes

```yaml
alert: hermes_write_tool_attempt
expr: count(hermes_audit_events{action="deny", tool_category="write"}) > 0
for: 0m
severity: P1
annotations:
  summary: "Write tool invoked via Hermes — tool: {{ $labels.tool }}"
  action: "Disable OSCORPEX_ENABLE_HERMES if write execution confirmed"
```

### P1: Write Tool via Gateway

```yaml
alert: gateway_write_tool_attempt
expr: count(gateway_audit_events{action="deny", tool_category="write"}) > 0
for: 0m
severity: P1
annotations:
  summary: "Write tool invoked via Gateway — tool: {{ $labels.tool }}"
  action: "Disable OSCORPEX_ENABLE_GATEWAY if write execution confirmed"
```

### P2: Session Budget Abuse

```yaml
alert: session_budget_abuse
expr: |
  sum by (tenant_id) (
    increase(hermes_session_exhaustions_total[1h])
  ) > 5
for: 0m
severity: P2
annotations:
  summary: "Tenant {{ $labels.tenant_id }} exhausting sessions at high rate"
```

### P3: Checkpoint Cleanup Needed

```yaml
alert: checkpoint_cleanup_needed
expr: active_checkpoints_total > 1000
for: 0m
severity: P3
annotations:
  summary: "{{ $value }} active checkpoints — cleanup job may be needed"
```

---

## Notification Channel Configuration

### PagerDuty

- Service: `oscorpex-kernel-prod`
- Escalation: on-call engineer → team lead → platform owner
- P0 alerts page immediately with high urgency
- P1 alerts page with normal urgency after 5-min grace

### Slack: `#oscorpex-alerts`

- All P1/P2/P3 alerts post here
- P0 alerts also post here but PagerDuty is the primary channel
- Format: `[P{severity}] {alert_name} — {summary}` + runbook link

### Daily Report (P3)

- Scheduler sends daily digest at 08:00 UTC
- Includes: checkpoint count, slow query trends, stale approvals

---

## Inhibition Rules

- Suppress `task_failure_rate` when `provider_total_outage` is active — expected
- Suppress `queue_depth` when `adaptive_concurrency_adjustment` is in progress
- Suppress `session_budget_abuse` for internal load-test tenants

---

## On-Call Runbook

1. **Acknowledge** alert in PagerDuty within SLA
2. **Check** Grafana dashboard for context (Platform Health + Security Events)
3. **Identify** affected tenantId / projectId from alert labels
4. **Follow** runbook link in alert annotation
5. **Document** in `#oscorpex-incidents` Slack channel
6. **Post-mortem** for all P0/P1 incidents within 48 hr

---

## Review Schedule

Alert thresholds should be reviewed:
- After each major sprint (adjust baselines if load patterns change)
- After every P0/P1 incident post-mortem
- At 30, 60, and 90 days post-production launch
- At each new tenant tier onboarding (enterprise traffic patterns differ)

---

*Alert conditions derived from production baselines in `production-telemetry-review.md`
and security requirements in P0-P13 hardening reports.*
