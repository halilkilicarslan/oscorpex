# RC1-J: Observability / Dashboard Review

**Version**: 1.0
**Date**: 2026-05-14
**Scope**: Kernel observability coverage as of P0-P13 completion
**Status**: RC1 pre-production review

---

## 1. Current Observability Coverage

### 1.1 Structured Logging (Pino JSON)

All kernel modules emit structured JSON via `createLogger("module-name")`. Every
log line includes `module`, `level`, `time`, `pid`, and contextual fields such as
`tenantId`, `projectId`, `taskId`.

| Coverage Area | Module Tag | Status |
|---------------|-----------|--------|
| Task dispatch | `execution-engine` | Covered |
| Task execution lifecycle | `task-executor` | Covered |
| Provider routing | `model-router` | Covered |
| Pipeline state changes | `pipeline-engine` | Covered |
| Budget enforcement | `budget-guard` | Covered |
| Adaptive concurrency | `adaptive-concurrency` | Covered |
| Graph mutations | `graph-coordinator` | Covered |
| Sandbox enforcement | `sandbox-manager` | Covered |
| Session lifecycle | `agent-runtime` | Covered |
| Authentication | `auth` | Covered |
| Rate limiting | `rate-limiter` | Covered |
| DB operations (slow queries) | `db` (repo level) | Partial — no query timing |

**Gap**: DB query timing (`pg` query duration) is not surfaced in structured logs.
Query duration must be instrumented at the pool level to feed P99 dashboards.

### 1.2 MCP Audit Events

Every MCP tool invocation (allow or deny) is written to `mcp_audit_logs` via
`recordMcpAudit()`. Fields logged:

```
tenantId, actorId, toolName, action (allow|deny),
reason, payloadHash, durationMs, timestamp
```

Coverage:
- `POST /mcp/write/apply` — full audit on every request
- `POST /mcp/invoke` — full audit
- `POST /hermes/invoke` — full audit (P12)
- Batch tool calls — audited per individual tool (not batch-level only)

**Gap**: Audit records are written synchronously in the request path. Under high
load, audit write latency could affect response time. Consider async audit queue
with durable backlog.

### 1.3 Scheduler Audit Events

Scheduler jobs emit structured audit events on start, completion, and failure via
the scheduler audit log module. Fields include `jobName`, `durationMs`,
`rowsRead`, `status`, `errorMessage`.

**Gap**: Scheduler audit events go to `stdout` only; they are not persisted to the
`audit_events` DB table. Add DB persistence for scheduler audits before production.

### 1.4 Hermes Session Metrics

`GET /hermes/metrics` returns:

```json
{
  "activeSessions": 12,
  "totalInvocations": 847,
  "deniedInvocations": 3,
  "injectionDetections": 1,
  "sessionExhaustions": 2,
  "rateLimitHits": 14,
  "redactionCount": 7
}
```

Metrics are aggregated in-memory and reset on restart. No persistence between
restarts.

**Gap**: Hermes metrics are ephemeral. Integrate with a time-series store (Prometheus
push or DB snapshots every minute) so soak test data survives kernel restarts.

### 1.5 Gateway Invocation Metrics

Gateway logs per-invocation structured events including `toolName`, `tenantId`,
`action`, `redactedFields`, `payloadBytes`, `durationMs`.

**Gap**: No dedicated `GET /gateway/metrics` aggregate endpoint. Metrics must be
derived from log aggregation. Add a metrics endpoint before production (mirrors
`/hermes/metrics` pattern).

### 1.6 Rate Limit Hit Counts

Rate limiting is enforced via middleware; `429` responses are logged with
`module: rate-limiter`, `endpoint`, `tenantId`, `windowHits`.

Coverage: All MCP endpoints, Hermes endpoints, auth endpoints.

**Gap**: Rate limit counters are in-memory. In a multi-instance deployment, each
instance has an independent counter. A shared Redis or PostgreSQL counter is
required for accurate enforcement across instances.

### 1.7 Secret Redaction Counts

`secret-guard.ts` logs every redaction event with the pattern category that matched
(e.g., `github_pat`, `openai_key`) but not the raw secret value.

**Gap**: Redaction miss detection is not instrumented. If a pattern fails to match,
no signal is emitted. Add a canary-secret audit mode for staging that inserts known
test secrets and verifies they are always redacted.

### 1.8 Prompt Injection Detection Counts

`hermes-routes.ts` and `learning-governance.ts` log injection detection events.
Hermes uses 14 patterns; learning governance uses 23 patterns.

**Gap**: Detection events from the two subsystems use different log schemas. Unify
under a common `injection_event` structured log type for easier aggregation.

### 1.9 Health Check Endpoints

| Endpoint | Purpose | Status |
|----------|---------|--------|
| `GET /health` | Liveness — process alive | Active |
| `GET /health/db` | Readiness — DB connectivity | Active |
| `GET /health/providers` | Provider availability snapshot | Active |
| `GET /telemetry/performance/baseline` | Aggregated perf metrics | Active |
| `GET /gateway/health` | Gateway subsystem health | Missing |
| `GET /hermes/health` | Hermes subsystem health | Missing |

**Gap**: `/gateway/health` and `/hermes/health` endpoints are not implemented.
Container orchestrators and load balancers need subsystem-specific liveness probes.

---

## 2. Recommended Grafana Dashboards

### Dashboard 1: Platform Health (Primary)

| Panel | Metric | Alert Threshold |
|-------|--------|----------------|
| Active pipelines | Count of `project.status = running` | — |
| Task completion rate (24h) | Completed / started | < 90% → warn |
| HTTP 5xx rate (5min window) | 5xx / total | > 5% → page |
| DB connection pool % | Active / max | > 90% → page |
| Provider availability | Healthy providers / total | < 80% → warn |
| Budget circuit breaker trips | Count today | > 0 → warn |

### Dashboard 2: Security Events

| Panel | Metric | Alert Threshold |
|-------|--------|----------------|
| MCP write denials | `action: deny` on write tools | Any → slack |
| Hermes write denials | `action: deny` on write tools | Any → slack |
| Prompt injection detections | `injection_detected` events | > 10/hr → P1 |
| RLS bypass events | `tenant_mismatch` events | Any → P0 |
| Secret redaction count | Redaction events / hr | Spike → investigate |
| Rate limit hits by endpoint | `429` by endpoint | Spike → investigate |

### Dashboard 3: Hermes & Gateway

| Panel | Metric |
|-------|--------|
| Active Hermes sessions | `activeSessions` from `/hermes/metrics` |
| Session exhaustion rate | Exhausted / created per hour |
| Hermes tool invocation rate | Invocations / min |
| Gateway payload size histogram | Request body bytes distribution |
| Gateway redaction events | Redacted responses / hr |

### Dashboard 4: Scheduler Jobs

| Panel | Metric |
|-------|--------|
| Job completion rate | Completed / scheduled per day |
| Job duration heatmap | `durationMs` per job per run |
| Job failure count | `status: failed` events |
| Memory delta per job | RSS before vs after job |

### Dashboard 5: DB Performance

| Panel | Metric |
|-------|--------|
| Connection pool utilization | Active / max over time |
| Slow queries (P99) | Once instrumented at pool level |
| Table size growth | `pg_relation_size` daily trend |
| Dead tuple accumulation | Autovacuum health signal |

---

## 3. Missing Observability — Remediation Plan

| Gap | Priority | Owner | Target |
|-----|----------|-------|--------|
| DB query timing at pool level | P1 | Backend | Before production |
| Async audit queue for MCP | P2 | Backend | First 30 days post-launch |
| Scheduler audit persistence to DB | P1 | Backend | Before production |
| Hermes metrics time-series persistence | P1 | Backend | Before production |
| `GET /gateway/metrics` endpoint | P1 | Backend | Before production |
| `GET /gateway/health` endpoint | P1 | Backend | Before production |
| `GET /hermes/health` endpoint | P1 | Backend | Before production |
| Redis-backed rate limit counters | P1 | Infra | Before multi-instance deploy |
| Canary-secret redaction audit mode | P2 | Security | First 30 days post-launch |
| Unified `injection_event` log schema | P2 | Backend | First 30 days post-launch |

---

## 4. Observability Sign-Off Checklist

- [ ] All P1 gaps above resolved before production deploy
- [ ] Grafana dashboards provisioned and reviewed
- [ ] Alert rules live (see `alert-thresholds-rc1.md`)
- [ ] On-call runbook references correct dashboard URLs
- [ ] Log retention policy defined (recommended: 90 days hot, 1 year cold)
- [ ] `GET /hermes/health` and `GET /gateway/health` implemented
- [ ] Scheduler audit events persisted to DB

---

*This document should be re-reviewed after each major sprint that adds new
subsystems. Next review: post-RC2 stabilisation.*
