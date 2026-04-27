# Operator Runbooks

## 5.1 Provider Failure Runbook

### Timeout
- **Symptom**: Task fails with `ProviderTimeoutError`, latency close to timeout limit
- **Action**:
  1. Check `/telemetry/providers/latency` for the provider's p95 latency
  2. If p95 > 80% of timeout, increase timeout tier or switch provider
  3. If isolated incident, retry usually succeeds
  4. If repeated, provider may be degraded — check cooldown status

### Unavailable
- **Symptom**: `ProviderUnavailableError`, binary not found or HTTP unreachable
- **Action**:
  1. Verify binary is in PATH or server is running
  2. Check provider health endpoint (`/telemetry/runtime` or `health()`)
  3. If persistent, provider enters 30s cooldown automatically
  4. Fallback chain will skip this provider until available

### Rate Limited
- **Symptom**: `ProviderRateLimitError`, HTTP 429, or rate limit message
- **Action**:
  1. Provider enters cooldown with `rate_limited` trigger
  2. Wait for cooldown to expire (default 30s)
  3. Consider upgrading API tier or adding fallback providers

### Repeated Timeout
- **Symptom**: Same provider times out 3+ times in a row
- **Action**:
  1. Provider enters 90s cooldown (`repeated_timeout` trigger)
  2. Review task complexity — may need larger timeout tier (L/XL)
  3. Check network connectivity to provider endpoint

---

## 5.2 Cooldown Runbook

### Reading Cooldown Status
- Check `/telemetry/cooldown` endpoint for active cooldowns
- Fields: `provider`, `trigger`, `cooldownUntil`, `remainingMs`

### When Cooldown Resets
- Automatically when `cooldownUntil` timestamp passes
- Manual reset: restart kernel or call provider-specific health check

### When Manual Intervention Is Needed
- Cooldown stuck due to DB clock skew
- Provider falsely reported unavailable (binary path changed)
- Emergency: set `OSCORPEX_PERF_FEATURES=-providerCooldown` to disable

---

## 5.3 Telemetry Runbook

### Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/telemetry/providers/latency` | Per-provider latency snapshots |
| `/telemetry/providers/records` | Execution records with fallback timeline |
| `/telemetry/concurrency` | Adaptive concurrency controller state |
| `/telemetry/cache` | Health cache hit/miss stats |
| `/telemetry/cooldown` | Active provider cooldowns |
| `/telemetry/preflight` | Preflight warm-up status |
| `/telemetry/db-pool` | Database pool metrics |
| `/telemetry/runtime` | Runtime dispatch state |

### Key Metrics

| Metric | Threshold | Alarm? |
|--------|-----------|--------|
| Avg queue wait | > 30s | Yes |
| Fallback rate | > 25% | Yes |
| Timeout rate | > 15% | Yes |
| Failure rate | > 20% | Yes |
| DB pool waiting | > 5 | Yes |

---

## 5.4 Console Guide

### Telemetry Page (`/studio/telemetry`)
- Top cards show total runs, success, failure, avg latency
- Performance cards: queue wait, fallback rate, timeout rate, cooldown active
- Latency cards per provider with success rate badge
- Execution records table with filters

### Comparison Dashboard (`/studio/providers/compare`)
- Side-by-side provider metrics
- Fastest / Cheapest / Reliable / Noisy badges
- Filter by provider
- Sort by clicking column headers (future)

### Fallback Timeline
- In execution detail drawer
- Shows provider hops with reason and classification
- Green = success, red = failure, yellow = degraded

---

## 5.5 Incident Templates

### Provider Outage
```
Severity: High
Impact: Tasks failing for provider X
Runbook: 5.1 Provider Failure
Actions:
- Confirm outage via /telemetry/providers/latency
- Check if fallback chain covers the load
- If not, temporarily switch default provider
- Post-mortem: add more fallbacks or diversify providers
```

### Degraded Mode
```
Severity: Medium
Impact: All providers exhausted for some tasks
Runbook: 5.1 Provider Failure
Actions:
- Check /telemetry/cooldown for mass cooldown
- Verify network connectivity
- If local provider (ollama), check server status
- Escalate to infrastructure if API keys expired
```

### High Queue Wait
```
Severity: Medium
Impact: Tasks waiting too long before dispatch
Runbook: 5.3 Telemetry
Actions:
- Check /telemetry/concurrency for current max
- If max < queue depth, consider increasing
- Review adaptive concurrency logs for throttling reason
- Check if providers are in cooldown causing backlog
```
