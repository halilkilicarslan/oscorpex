# Production Telemetry Review

**Status**: Reference document  
**Date**: 2026-05-14  
**Scope**: Kernel (port 3141) + PostgreSQL + Console (port 5161)

---

## Overview

Oscorpex emits structured JSON logs via Pino and exposes telemetry endpoints. This document defines the key metrics to watch, health check strategy, log aggregation approach, alert conditions, and capacity planning baselines.

---

## Key Metrics

### Task Pipeline
| Metric | Description | Acceptable Range |
|--------|-------------|-----------------|
| `task_completion_rate` | % of tasks completing without retry | > 90% |
| `task_retry_rate` | Retries / total task starts | < 10% |
| `task_failure_rate` | Permanent failures / total starts | < 5% |
| `task_p95_duration_ms` | 95th percentile task wall time | < 1800000 (30 min) |
| `stale_approvals` | Approvals pending > 24h | 0 (alert at > 0) |
| `approval_wait_ms` | Time from task ready to approval | < 3600000 (1h) |

### Execution Engine
| Metric | Description | Acceptable Range |
|--------|-------------|-----------------|
| `active_concurrent_tasks` | Current semaphore usage | < 10 (adaptive max) |
| `queue_depth` | Tasks waiting for a slot | < 5 before scale signal |
| `provider_availability` | % of providers responding healthy | > 80% |
| `provider_fallback_rate` | Fallbacks triggered / total dispatches | < 20% |
| `cooldown_active_count` | Providers in cooldown state | < 2 simultaneously |

### Budget
| Metric | Description | Threshold |
|--------|-------------|----------|
| `cost_usd_per_pipeline` | Total cost of a full pipeline run | Configurable per project |
| `budget_circuit_breaker_trips` | Times budget guard paused a pipeline | Alert at > 0 |
| `token_cache_hit_rate` | Anthropic cache hits / total tokens | > 85% (baseline 93.5%) |

### HTTP API
| Metric | Description | Threshold |
|--------|-------------|----------|
| `http_request_rate` | Requests/sec across all routes | Baseline < 50 rps |
| `http_error_rate_5xx` | 5xx responses / total | < 1% |
| `http_p99_latency_ms` | 99th percentile response time | < 2000ms |
| `http_p95_latency_ms` | 95th percentile response time | < 500ms |

### Database
| Metric | Description | Threshold |
|--------|-------------|----------|
| `db_connection_pool_usage` | Active connections / pool max | < 80% |
| `db_query_p99_ms` | 99th percentile query time | < 500ms |
| `db_replication_lag_ms` | If replica present | < 5000ms |
| `db_dead_tuples` | Accumulation signal for autovacuum | Monitor trend |

---

## Health Check Endpoints

### Kernel Built-in
```
GET /health         — Returns { status: "ok" | "degraded", uptime, version }
GET /health/db      — PostgreSQL connectivity check
GET /health/providers — Provider availability snapshot
GET /telemetry/performance/baseline — Aggregated perf metrics (P3-M endpoint)
```

### Liveness vs Readiness
- **Liveness** (`/health`): simple process alive check; no DB call; used by container orchestrator restart policy
- **Readiness** (`/health/db`): checks DB connectivity; used by load balancer to route traffic

### Recommended Probe Configuration (Kubernetes / Docker)
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3141
  initialDelaySeconds: 10
  periodSeconds: 30
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health/db
    port: 3141
  initialDelaySeconds: 5
  periodSeconds: 10
  failureThreshold: 2
```

---

## Log Aggregation Strategy

### Format
Kernel uses Pino for structured JSON logging. Every log line is an object:
```json
{
  "level": 30,
  "time": 1715695200000,
  "pid": 1234,
  "hostname": "kernel-0",
  "module": "execution-engine",
  "msg": "[execution] Task dispatched",
  "taskId": "uuid",
  "projectId": "uuid",
  "tenantId": "uuid"
}
```

### Module Tags
All loggers created via `createLogger("module-name")` emit a `module` field. This enables per-module log filtering without grep.

### Recommended Aggregation Stack
1. **Stdout collection**: Container runtime (Docker/K8s) captures stdout
2. **Log shipper**: Fluent Bit or Vector sidecar forwards to central store
3. **Storage**: Loki (lightweight, label-indexed) or Elasticsearch
4. **Query UI**: Grafana (Loki datasource) or Kibana

### Key Log Labels for Indexing
- `module` — which subsystem emitted the log
- `tenantId` — tenant context (present on most studio operations)
- `projectId` — pipeline context
- `taskId` — execution context
- `level` — standard pino numeric levels (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal)

### Sensitive Field Handling
- Logs must never contain raw secrets; `redactForAudit()` is called before any content reaches log lines
- `DATABASE_URL` and provider credentials are never logged
- Task outputs in logs are truncated to 500 chars via pino serializers

---

## Alert Conditions

### Critical (Page immediately)
| Condition | Signal |
|-----------|--------|
| Process crash / restart loop | Container restarts > 3 in 10 min |
| DB connection failure | `/health/db` returns non-200 for > 60s |
| Budget circuit breaker trip | `budget_circuit_breaker_trips` > 0 |
| 5xx error rate spike | HTTP 5xx > 5% over 5-min window |
| Stale approval blocking pipeline | Approval pending > 24h |
| Provider total outage | All providers in cooldown simultaneously |

### Warning (Alert, no page)
| Condition | Signal |
|-----------|--------|
| Task failure rate elevated | `task_failure_rate` > 5% over 1h |
| Queue depth growing | `queue_depth` > 5 for > 10 min |
| Cache hit rate degraded | `token_cache_hit_rate` < 85% |
| DB connection pool > 80% | Pool usage sustained above threshold |
| HTTP p99 latency > 2s | Sustained for > 5 min |
| Provider cooldown active | Any provider in cooldown > 10 min |

### Informational (Dashboard only)
| Condition | Signal |
|-----------|--------|
| New pipeline started | `project.status = running` |
| Pipeline completed | `project.status = completed` |
| Budget checkpoint hit | Token cost crosses 50% of budget |
| Adaptive concurrency adjustment | Semaphore limit changed |

---

## Dashboard Recommendations

### Grafana Panels (Priority Order)
1. **Pipeline Health**: Active pipelines, completion rate (24h), failure rate (24h)
2. **Task Execution**: Tasks dispatched/hr, retry rate, p95 duration, queue depth
3. **Budget**: Cost per pipeline (rolling), circuit breaker trips, cache hit rate
4. **HTTP API**: Request rate, error rate (4xx/5xx split), p95/p99 latency
5. **Database**: Connection pool usage, query p99, table sizes trend
6. **Provider Health**: Availability per provider, cooldown history, fallback rate
7. **Approvals**: Pending approval count, oldest pending age

### Pre-built Query Examples (Loki LogQL)
```logql
# Error rate by module (last 1h)
sum by (module) (rate({app="kernel"} | json | level >= 50 [1h]))

# Slow tasks (duration > 30min)
{app="kernel", module="execution-engine"} | json | durationMs > 1800000

# Budget trips
{app="kernel", module="budget-guard"} |= "circuit breaker"
```

---

## Performance Baselines (Post P10)

These baselines were established from the smoke test v4 full pipeline run:

| Metric | Baseline |
|--------|---------|
| Token cache hit rate | 93.5% |
| Full pipeline duration (12 agents) | ~45 min (simple project) |
| Task p95 duration | < 20 min |
| HTTP p95 latency | < 200ms (non-execution routes) |
| DB query p99 | < 50ms (indexed queries) |
| Adaptive concurrency max reached | 3–5 tasks (typical load) |
| Provider fallback rate | < 5% in healthy cluster |

---

## Capacity Planning

### Single-Node Minimums
| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 2 GB | 4 GB |
| Disk (DB) | 20 GB | 100 GB |
| Disk (artifacts) | 10 GB | 50 GB |
| Network | 100 Mbps | 1 Gbps |

### PostgreSQL Sizing
- 85 tables; primary growth tables: `agent_episodes`, `events`, `audit_events`, `command_audit_logs`
- `agent_episodes` grows ~50 MB/pipeline on a medium project
- `audit_events` grows ~5 MB/pipeline
- Recommend: monthly VACUUM ANALYZE + autovacuum tuned for high-insert tables
- Index coverage: all tenant_id columns must be indexed (not just FK)

### Scaling Signals
| Signal | Action |
|--------|--------|
| DB connection pool > 80% sustained | Increase pool size or add read replica |
| Queue depth > 5 sustained > 30 min | Increase `OSCORPEX_MAX_CONCURRENT_TASKS` (max 10) |
| HTTP p99 > 2s | Profile slow routes; consider horizontal scaling |
| Disk growth > 5 GB/day | Add artifact retention policy or increase storage |
| Token cache hit < 85% | Review prompt stability; excessive prompt variation degrades cache |

### Multi-Tenant Growth Model
Each active tenant adds:
- ~3–5 concurrent tasks at peak
- ~100 MB/month DB growth (moderate usage)
- ~$5–50/month LLM cost depending on project complexity

Recommend capacity review at 10, 25, and 50 tenants.

---

## Operational Runbook Pointers

- Budget guard tuning: `apps/kernel/src/studio/budget-guard.ts` — `budget.maxCostUsd` config key
- Adaptive concurrency tuning: `OSCORPEX_MAX_CONCURRENT_TASKS`, `OSCORPEX_ADJUSTMENT_INTERVAL_MS`
- Provider cooldown tuning: `OSCORPEX_COOLDOWN_*` env vars (see CLAUDE.md)
- Full environment variable reference: `apps/kernel/src/studio/performance-config.ts`
- Structured log field reference: `apps/kernel/src/studio/logger.ts`
