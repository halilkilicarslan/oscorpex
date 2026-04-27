# Optimization Dashboard Evidence (TASK 8)

**Page**: `apps/console/src/pages/studio/ProviderTelemetryPage.tsx`
**Route**: `/studio/telemetry`
**Data Source**: Kernel telemetry endpoints (`/telemetry/providers/*`, `/telemetry/performance/baseline`)

---

## Dashboard Sections

### 1. Performance Summary Cards (TASK 13)

| Card | Metric | Source | Color |
|------|--------|--------|-------|
| Avg queue wait | `avg(queueWaitMs)` | `/telemetry/providers/records` | white |
| Fallback rate | `% records with fallbackCount > 0` | `/telemetry/providers/records` | amber |
| Timeout rate | `% records with errorClassification = timeout` | `/telemetry/providers/records` | orange |
| Cooldown active | Count of providers with recent failure | `/telemetry/providers/latency` | red |

**Operator Action**: High fallback rate → check provider health. High timeout rate → review timeout policy config. High cooldown active → investigate provider failures.

---

### 2. Top Slow Providers Card

**Sort**: `averageLatencyMs` descending, top 5
**Columns**: Provider name, average latency, P95 latency
**Color**: Amber (`#f59e0b`) for latency values

**Operator Action**: If a provider is consistently slow, consider:
- Increasing its timeout multiplier
- Deprioritizing it in fallback chain
- Investigating binary/network issues

---

### 3. Top Failure Classifications Card

**Sort**: Count descending, top 5
**Columns**: Classification badge, count
**Color**: Red (`#ef4444`) for counts

**Classifications shown**:
- `timeout` — Provider took too long
- `spawn_failure` — Binary could not start
- `unavailable` — Provider binary not found
- `rate_limited` — Provider API rate limited
- `cli_error` — Provider exited with error code
- `tool_restriction_unsupported` — Provider cannot handle tool restrictions

**Operator Action**: Frequent `spawn_failure` → check binary paths. Frequent `timeout` → review complexity→timeout mapping. Frequent `rate_limited` → increase cooldown duration.

---

### 4. Provider Latency Cards

**Per-provider card** showing:
- Total executions
- Successful / failed counts
- Average latency (ms)
- P95 latency (ms)
- Last failure time + classification

---

### 5. Execution Records Table

**Filterable by**: Provider, Status (success/failed)
**Columns**:
- Task ID
- Primary / final provider
- Duration
- Fallback count
- Error classification
- Queue wait time
- Timestamp

---

### 6. Detail Drawer

**Clicking a record opens a drawer with**:
- Full fallback timeline (which provider was tried, in what order, why it failed)
- Error message
- Cancel reason (if cancelled)
- Degraded mode flag
- Retry reason

---

## Before/After View (TASK 8.4)

The dashboard does not yet show a before/after comparison directly. The baseline data is available in `docs/performance-evidence/03-before-after.md`.

**Future enhancement**: Add a "Benchmark" tab to the dashboard that:
1. Loads baseline metrics from a static JSON file
2. Compares current metrics against baseline
3. Shows green/red deltas with percentage change

---

## API Endpoints Consumed

| Endpoint | Data |
|----------|------|
| `GET /telemetry/providers/latency` | Latency snapshots per provider |
| `GET /telemetry/providers/records` | Execution records list |
| `GET /telemetry/performance/baseline` | Aggregated baseline metrics |

---

## Feature Flags

All dashboard features are always visible. No feature flag controls individual cards.

| Feature | Status |
|---------|--------|
| Performance summary cards | ✅ Live (TASK 13) |
| Top slow providers | ✅ Live (TASK 13) |
| Top failure classifications | ✅ Live (TASK 13) |
| Before/after comparison | 📝 Planned (static data available) |
