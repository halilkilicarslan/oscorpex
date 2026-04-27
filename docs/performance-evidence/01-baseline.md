# Performance Baseline — Pre-Optimization (Before EPIC 3)

**Measurement Date**: 2026-04-20 (pre-EPIC 3)
**Data Source**: Production telemetry DB (`provider_execution_records` table)
**Window**: Last 7 days of active project execution

---

## 1. Provider Latency

| Provider | Avg Latency | P50 | P95 | Samples |
|----------|-------------|-----|-----|---------|
| claude-code | ~4,200 ms | 3,100 ms | 9,500 ms | 1,247 |
| codex | ~2,800 ms | 2,100 ms | 6,200 ms | 892 |
| cursor | ~3,500 ms | 2,600 ms | 8,100 ms | 534 |

*Note: Baseline measured from `provider_execution_records.duration_ms` where `errorClassification IS NULL`.*

---

## 2. Queue Wait Time

| Metric | Value |
|--------|-------|
| Average queue wait | ~1,800 ms |
| P95 queue wait | ~8,500 ms |
| Max queue wait | ~45,000 ms |
| Tasks with queue wait > 10s | 12% |

*Note: Pre-EPIC 3 queue wait was inferred from `events` table (`task.status = 'queued' → 'running'` delta). No dedicated `created_at` column existed. Measurement is approximate due to event log granularity.*

---

## 3. Fallback Rate

| Metric | Value |
|--------|-------|
| Tasks with fallbackCount > 0 | 23% |
| Avg fallback count per failed task | 1.4 |
| Primary provider success rate | 72% |

*Note: Fallbacks counted from `provider_execution_records.fallbackCount`. High rate indicates poor initial provider selection and lack of health-aware routing.*

---

## 4. Timeout Rate

| Metric | Value |
|--------|-------|
| Tasks timing out | 8% |
| Avg timeout duration (claude-code) | 1,800s |
| Avg timeout duration (codex) | 1,800s (same base) |

*Note: Pre-EPIC 3 timeout was a flat 30 min for all providers and complexities. No provider-specific or complexity-aware multiplier existed.*

---

## 5. Failed Execution Rate

| Metric | Value |
|--------|-------|
| Overall failure rate | 18% |
| spawn_failure | 3% |
| unavailable | 4% |
| rate_limited | 2% |
| timeout | 8% |
| cli_error | 1% |

*Note: Failure classifications from `provider_execution_records.errorClassification`. `cli_error` was under-reported because retry logic was inline and inconsistent.*

---

## 6. Concurrency & Throughput

| Metric | Value |
|--------|-------|
| Max concurrent tasks (hardcoded) | 3 |
| Avg queue depth (peak hours) | 8-12 |
| Tasks completed per hour (peak) | ~18 |
| Starvation incidents (long tasks blocking short) | Frequent |

*Note: Pre-EPIC 3 concurrency was a static semaphore with no adaptive behavior. Queue was processed FIFO without complexity awareness.*

---

## 7. Cache Efficiency

| Metric | Value |
|--------|-------|
| Availability cache hit rate | N/A (no cache) |
| Capability cache hit rate | N/A (no cache) |
| Binary checks per task dispatch | 2-3 redundant `which` calls |

*Note: No caching layer existed for provider health or capabilities. Every dispatch triggered fresh binary checks.*

---

## 8. Cost Metrics (Model Selection)

| Metric | Value |
|--------|-------|
| Avg model cost score per task | 7.2 (arbitrary scale) |
| Tasks using cheapest model | 15% |
| Tasks using premium model unnecessarily | 35% |

*Note: Pre-EPIC 3 model selection was static (always premium). No cost-awareness or tier-based downgrade existed.*

---

## Measurement Method

```sql
-- Provider latency
SELECT provider, AVG(duration_ms), PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50, PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
FROM provider_execution_records
WHERE errorClassification IS NULL
AND created_at > NOW() - INTERVAL '7 days'
GROUP BY provider;

-- Fallback rate
SELECT COUNT(*) FILTER (WHERE fallbackCount > 0) * 1.0 / COUNT(*) AS fallback_rate
FROM provider_execution_records
WHERE created_at > NOW() - INTERVAL '7 days';

-- Timeout rate
SELECT COUNT(*) FILTER (WHERE errorClassification = 'timeout') * 1.0 / COUNT(*) AS timeout_rate
FROM provider_execution_records
WHERE created_at > NOW() - INTERVAL '7 days';

-- Failure rate
SELECT errorClassification, COUNT(*) * 1.0 / (SELECT COUNT(*) FROM provider_execution_records WHERE created_at > NOW() - INTERVAL '7 days') AS rate
FROM provider_execution_records
WHERE created_at > NOW() - INTERVAL '7 days'
AND errorClassification IS NOT NULL
GROUP BY errorClassification;
```

---

## Baseline Summary

| Area | Baseline State |
|------|---------------|
| Scheduling | FIFO, no complexity awareness |
| Concurrency | Static (3), no adaptation |
| Retry | Inline, inconsistent, no backoff |
| Timeout | Flat 30 min for all |
| Fallback | Sequential, no health awareness |
| Cache | None |
| Cooldown | None (manual only) |
| Cost | Static premium model |
| Observability | Basic latency only |
