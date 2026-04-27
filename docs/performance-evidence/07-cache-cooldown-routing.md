# Cache, Cooldown & Routing Metric Surface (TASK 6)

**Modules**:
- `provider-runtime-cache.ts` — Availability + capability caches
- `provider-state.ts` — Cooldown state management
- `model-router.ts` — Cost-aware model selection

---

## Cache Usage Points

### Availability Cache
**Where used**: `fallback-decision.ts::shouldSkipProvider()` → `providerState.isAvailable()` → `providerRuntimeCache.getAvailability()`
**What it caches**: `adapter.isAvailable()` boolean result (binary check)
**TTL**: 30s for available, ~10s for unavailable
**Invalidation triggers**:
- Execution failure (`providerState.markFailure`)
- Cooldown start (`providerState.markCooldown`)
- Manual refresh

### Capability Cache
**Where used**: `fallback-decision.ts::shouldSkipProvider()` → `providerRuntimeCache.resolveCapability()`
**What it caches**: `ProviderCapabilities` object (supportedModels, supportsToolRestriction, etc.)
**TTL**: 5 minutes
**Invalidation triggers**:
- Manual refresh only (capabilities rarely change)

---

## Debug Endpoints

### GET /telemetry/cache
```json
{
  "stats": {
    "availabilityHits": 1247,
    "availabilityMisses": 312,
    "capabilityHits": 89,
    "capabilityMisses": 12
  },
  "availabilityEntries": [
    { "providerId": "claude-code", "available": true, "expiresInMs": 15420, "source": "health_check" },
    { "providerId": "codex", "available": false, "expiresInMs": 3210, "source": "execution_failure" }
  ]
}
```

### GET /telemetry/cooldown
```json
{
  "totalProviders": 3,
  "activeCooldownCount": 1,
  "activeCooldowns": [
    {
      "provider": "codex",
      "trigger": "spawn_failure",
      "cooldownUntil": "2026-04-27T10:01:00.000Z",
      "remainingMs": 45000,
      "consecutiveFailures": 3
    }
  ],
  "earliestRecoveryMs": 45000
}
```

---

## Cost-Aware Routing Decision

**Module**: `model-router.ts::selectCostAwareModel()`
**Telemetry field**: `ProviderExecutionTelemetry.decisionReason`

### Decision Rules
1. **S/M complexity + no prior failures** → cheapest model (`cost_optimize`)
2. **L/XL complexity** → premium model (`quality_first`)
3. **Any complexity + prior failures > 0** → premium model (`quality_preserve`)

### Example Telemetry
```json
{
  "runId": "r-1",
  "taskId": "t-1",
  "decisionReason": "cost_optimize (saved=4pts, tier=M)"
}
```

---

## Metric Extraction for Dashboard

| Metric | Source | Endpoint |
|--------|--------|----------|
| Availability hit rate | `providerRuntimeCache.getStats()` | `/telemetry/cache` |
| Capability hit rate | `providerRuntimeCache.getStats()` | `/telemetry/cache` |
| Active cooldowns | `providerState.getAllStates()` | `/telemetry/cooldown` |
| Earliest recovery | `providerState.getEarliestRecoveryMs()` | `/telemetry/cooldown` |
| Model decision reason | `ProviderExecutionTelemetry.decisionReason` | `/telemetry/providers/records` |
