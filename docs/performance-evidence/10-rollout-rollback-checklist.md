# Rollout Plan (TASK 10.1)

**Feature Flag**: `OSCORPEX_PERF_FEATURES`
**Default**: All enabled (unset)

---

## Phase Sequence

### Phase 1: Observation (Week 1)
**Flags**: `queueWaitTelemetry,timeoutPolicy,providerCooldown`
**Goal**: Establish baseline with new observability

| Check | Pass Criteria |
|-------|--------------|
| `/telemetry/providers/queue-wait` returns data | queueWaitMs present in records |
| `/telemetry/performance/baseline` loads | < 500ms response time |
| Timeout rates stable | No spike in timeout classification |

### Phase 2: Conservative (Week 2)
**Flags**: `+retryPolicy,fallbackDecisionMotor,providerRuntimeCache`
**Goal**: Verify retry and fallback logic without concurrency changes

| Check | Pass Criteria |
|-------|--------------|
| Fallback rate stable or lower | < 20% |
| Non-retryable errors do not retry | spawn_failure, unavailable = 0 retries |
| Cache hit rate > 50% | availabilityHits / (hits + misses) |

### Phase 3: Active (Week 3)
**Flags**: `+adaptiveConcurrency,fairScheduling,costAwareModelSelection`
**Goal**: Enable throughput and cost optimizations

| Check | Pass Criteria |
|-------|--------------|
| Queue depth reduced | < 50% of pre-EPIC3 baseline |
| Short task queue wait < 1s | 90th percentile |
| Cost score reduced | < 10% reduction from baseline |
| No starvation incidents | All short tasks start within 2 long tasks |

### Phase 4: Full (Week 4)
**Flags**: `+preflightWarmup,providerHealthCache`
**Goal**: Enable all optimizations

| Check | Pass Criteria |
|-------|--------------|
| Cold start ratio < 10% | First execution marked cold |
| Binary checks reduced | < 1 per dispatch on average |
| No regression in failure rate | Within 5% of Phase 2 |

---

## Staging → Canary → Prod

```
Staging (1 day)
  └─ All flags ON
  └─ Run full test suite
  └─ Load test: 50 concurrent tasks

Canary (10% traffic, 2 days)
  └─ Phase 1 flags only
  └─ Monitor: fallback rate, timeout rate, queue depth
  └─ If metrics stable → Phase 2 flags

Canary (25% traffic, 2 days)
  └─ Phase 2 flags
  └─ Monitor: cache hit rate, retry counts

Canary (50% traffic, 2 days)
  └─ Phase 3 flags
  └─ Monitor: throughput, queue wait, cost score

Canary (100% traffic, 1 day)
  └─ Phase 4 flags
  └─ Monitor: cold start, binary checks

Prod
  └─ Full rollout
  └─ Continuous monitoring
```

---

## Rollback Triggers (TASK 10.2)

| Metric | Threshold | Action |
|--------|-----------|--------|
| Failure rate | > 25% (baseline: 18%) | Rollback to Phase 2 flags |
| Fallback rate | > 30% (baseline: 23%) | Rollback to Phase 1 flags |
| Queue wait P95 | > 15s (baseline: 8.5s) | Disable `fairScheduling` |
| Tasks/hour | < 15 (baseline: 18) | Disable `adaptiveConcurrency` |
| Cost score | > 8.0 (baseline: 7.2) | Disable `costAwareModelSelection` |
| Cache hit rate | < 30% | Disable `providerRuntimeCache` |

**Emergency rollback**: `OSCORPEX_PERF_FEATURES=""` → all disabled instantly.

---

## Staging Checklist (TASK 10.3)

### Cache
- [ ] `GET /telemetry/cache` returns hit/miss stats
- [ ] Availability cache TTL = 30s
- [ ] Capability cache TTL = 5min
- [ ] Invalidation on failure works (check `/telemetry/cache` after failed execution)

### Cooldown
- [ ] `GET /telemetry/cooldown` shows active cooldowns
- [ ] Cooldown expires automatically
- [ ] Provider skipped when in cooldown

### Retry
- [ ] `timeout` → retry with backoff
- [ ] `spawn_failure` → immediate fallback (no retry)
- [ ] Max 3 retries enforced

### Timeout
- [ ] claude-code S = 30min
- [ ] codex L = 54min (1.2x multiplier)
- [ ] cursor XL = 66min (1.1x multiplier)

### Concurrency
- [ ] `GET /telemetry/concurrency` shows current max
- [ ] Max auto-adjusts based on failure rate
- [ ] Never exceeds 10, never below 1

---

## Prod Smoke Checklist (TASK 10.4)

**Immediately after deploy**:
- [ ] Kernel boots without errors
- [ ] `GET /telemetry/performance/baseline` responds in < 1s
- [ ] Dashboard loads and shows data

**Within 1 hour**:
- [ ] Tasks are being dispatched
- [ ] No spike in `errorClassification = unavailable`
- [ ] Queue wait remains < 2s average

**Within 24 hours**:
- [ ] Fallback rate within 10% of baseline
- [ ] No starvation incidents detected
- [ ] Cache hit rate > 50%

**Within 1 week**:
- [ ] Throughput meets or exceeds baseline
- [ ] Cost score reduced or stable
- [ ] All phases rolled out successfully
