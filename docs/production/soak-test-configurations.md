# RC1 Soak Test Configurations

**Version**: 1.0
**Date**: 2026-05-14
**Scope**: Hermes, Gateway, Scheduler — 7–14 day production-staging soak
**Prerequisite**: P12 Hermes prototype accepted; all P0-P13 protections active

---

## Overview

Three independent soak tests run concurrently on the staging environment against
real-traffic replay. Each system starts **disabled by default** and is enabled via
a single environment variable. No data mutations are permitted during soak.

---

## RC1-D: Hermes Soak (7–14 days)

### Enable

```bash
OSCORPEX_ENABLE_HERMES=true
```

Set in staging `.env` or secret manager. Do **not** set in production until soak
passes all success criteria below.

### Configuration Baseline

| Parameter | Staging Value | Production Default |
|-----------|--------------|-------------------|
| `OSCORPEX_ENABLE_HERMES` | `true` | `false` |
| Session tool budget (`maxToolCalls`) | `50` | `50` |
| Rate limit | `20 req/min/actor` | `20 req/min/actor` |
| Prompt injection guard | Enabled (14 patterns) | Enabled |
| Secret redaction | Enabled (25+ patterns) | Enabled |
| Write tools allowed | **NO** | **NO** |
| Audit logging | Enabled | Enabled |
| Session TTL | `3600s` (1h) | `3600s` |

> Session budget of 50 is the production default. Do not raise above 100 without
> a separate risk review.

### Metrics to Monitor

| Metric | Source | Target |
|--------|--------|--------|
| Tool invocation count | `GET /hermes/metrics` | Baseline trend |
| Write tool denial count | Audit log (`action: deny`) | 0 write executions |
| Prompt injection attempts | `injection_detected` audit field | Count + pattern log |
| Session exhaustion rate | Sessions with `status: exhausted` / total | < 5% per tenant-hour |
| Cross-tenant access attempts | `tenant_mismatch` audit events | 0 |
| API error rate (5xx) | HTTP log aggregation | < 1% |
| Rate limit hit count | `429` response log | Baseline trend |
| Audit coverage | Audit rows / invoke requests | 100% |
| Redaction miss count | Secret guard miss signal | 0 |

### Grafana Queries (Loki)

```logql
# Hermes invocations over time
sum(rate({module="hermes-routes"} | json [5m]))

# Write tool denials
{module="hermes-routes"} |= "DENY" | json | tool =~ "write|delete|commit|push|shell"

# Injection detection
{module="hermes-routes"} |= "injection_detected" | json
```

### Success Criteria (Gate to Production)

| Criterion | Target | Blocking |
|-----------|--------|---------|
| Write tool executions | **0** | YES |
| Cross-tenant data access | **0** | YES |
| API error rate | **< 1%** | YES |
| Audit coverage | **100%** | YES |
| Unredacted secrets in output | **0** | YES |
| Session budget exhaustion rate | **< 5%/tenant-hr** | No (monitor) |
| Injection detection rate | **> 99%** | YES |

### Failure Response

Any YES-blocking criterion failing triggers an immediate halt:

1. Disable `OSCORPEX_ENABLE_HERMES` in staging.
2. File a P0 or P1 incident (see `incident-response-tabletop-rc1.md`).
3. Root-cause analysis before re-enabling.

---

## RC1-E: Gateway Soak (7–14 days)

### Enable

```bash
OSCORPEX_ENABLE_GATEWAY=true
```

### Configuration Baseline

| Parameter | Staging Value | Production Default |
|-----------|--------------|-------------------|
| `OSCORPEX_ENABLE_GATEWAY` | `true` | `false` |
| Rate limit | `60 req/min/IP` | `60 req/min/IP` |
| Payload size limit | `50 KB` | `50 KB` |
| Secret redaction | Enabled (25+ patterns) | Enabled |
| Write tools allowed | **NO** | **NO** |
| Audit logging | Enabled | Enabled |

### Metrics to Monitor

| Metric | Source | Target |
|--------|--------|--------|
| Tool invocation count | Gateway audit log | Baseline trend |
| Write tool denial count | `action: deny` in audit | 0 write executions |
| Response redaction count | `redacted_fields` in audit | Count trend |
| Payload size distribution | Request body size histogram | < 50 KB all requests |
| API error rate (5xx) | HTTP log aggregation | < 1% |
| Rate limit hit count | `429` responses | Baseline trend |
| Unredacted secrets | Secret guard miss signal | 0 |

### Grafana Queries (Loki)

```logql
# Gateway invocation rate
sum(rate({module="gateway-routes"} | json [5m]))

# Redacted responses
{module="gateway-routes"} |= "redacted_fields" | json | redacted_count > 0

# Oversized payloads rejected
{module="gateway-routes"} |= "payload_too_large" | json
```

### Success Criteria (Gate to Production)

| Criterion | Target | Blocking |
|-----------|--------|---------|
| Write tool executions | **0** | YES |
| Unredacted secrets in output | **0** | YES |
| API error rate | **< 1%** | YES |
| Oversized payloads passing | **0** | YES |
| Audit coverage | **100%** | YES |

### Failure Response

Same halt procedure as Hermes: disable flag, file P0/P1 incident, RCA before
re-enabling.

---

## RC1-F: Scheduler Soak (7–14 days)

### Enable

```bash
OSCORPEX_ENABLE_SCHEDULER=true
```

### Configuration Baseline

| Parameter | Staging Value | Production Default |
|-----------|--------------|-------------------|
| `OSCORPEX_ENABLE_SCHEDULER` | `true` | `false` |
| Jobs enabled | All 7 (read-only) | All 7 |
| Write operations allowed | **NO** | **NO** |
| Audit logging | Enabled | Enabled |

### Enabled Jobs

| Job | Schedule | Description |
|-----|----------|-------------|
| `audit-summary` | Daily 02:00 UTC | Aggregates audit events, no mutations |
| `failed-tasks` | Every 6h | Reports failed tasks, no mutations |
| `stale-approvals` | Every 4h | Reports approvals pending > 24h |
| `checkpoint-cleanup` | Daily 03:00 UTC | Identifies stale checkpoints (report only) |
| `dependency-report` | Weekly Sunday | Reports dependency health |
| `mcp-health` | Every 30min | MCP tool availability snapshot |
| `memory-pruning` | Daily 04:00 UTC | Proposes pruning (no auto-delete) |

> All 7 jobs are read-only. No job may insert, update, or delete production data.
> The scheduler policy (`scheduler-policy.ts`) enforces this at runtime.

### Metrics to Monitor

| Metric | Source | Target |
|--------|--------|--------|
| Job completion rate | Scheduler audit log | 100% |
| Job duration (P95) | Audit `duration_ms` | < 60s per job |
| Job failure rate | `status: failed` in audit | 0 |
| Memory usage during job runs | Process metrics | < +50 MB per job |
| Write operations detected | Policy deny audit | 0 |
| Data mutation events | DB change log | 0 |

### Grafana Queries (Loki)

```logql
# Scheduler job completions
{module="scheduler"} |= "job_completed" | json

# Job failures
{module="scheduler"} |= "job_failed" | json | severity = "error"

# Unexpected write attempt (critical)
{module="scheduler-policy"} |= "DENY" | json
```

### Success Criteria (Gate to Production)

| Criterion | Target | Blocking |
|-----------|--------|---------|
| Write operations | **0** | YES |
| Data mutations in DB | **0** | YES |
| Job completion rate | **100%** | YES (warn at < 95%) |
| Job failure rate | **0** | No (escalate if > 1/day) |
| Memory leak detected | **None** | YES |

---

## Soak Test Timeline

```
Day 0:    Enable all three flags in staging
Day 1:    Baseline metrics established; dashboards calibrated
Day 3:    First checkpoint review — anomaly triage
Day 7:    Mid-soak review — mandatory Go/No-Go assessment
Day 10:   Security red-team exercises (injection, RLS bypass attempts)
Day 14:   Final review — sign-off if all criteria met
```

## Concurrent Soak Checklist

- [ ] All three feature flags enabled in staging (`HERMES`, `GATEWAY`, `SCHEDULER`)
- [ ] Grafana dashboards live before Day 0
- [ ] Alert rules active (see `alert-thresholds-rc1.md`)
- [ ] On-call rotation established for soak duration
- [ ] Incident response runbooks reviewed (see `incident-response-tabletop-rc1.md`)
- [ ] Soak report template ready (`hermes-soak-report-template.md`)
- [ ] Day 7 mid-soak review scheduled

---

*Soak configurations are subject to revision based on early findings. Any changes
to these baselines require a documented ADR entry and security review sign-off.*
