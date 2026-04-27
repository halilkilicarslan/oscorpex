# Preflight Warm-up Technical Note (TASK 7)

**Module**: `apps/kernel/src/studio/preflight-warmup.ts`
**Feature Flag**: `OSCORPEX_PREFLIGHT_ENABLED` (default: `true`)

---

## Entrypoint

**When**: `runPreflightHealthChecks(adapters)` is called during kernel boot.
**Where**: `index.ts` or initialization sequence after CLI adapters are registered.
**Condition**: Only runs if `getPreflightConfig().enabled === true`.

```typescript
import { runPreflightHealthChecks } from "./preflight-warmup.js";

// During kernel startup:
await runPreflightHealthChecks([
  { name: "claude-code", isAvailable: () => checkClaudeBinary() },
  { name: "codex", isAvailable: () => checkCodexBinary() },
  { name: "cursor", isAvailable: () => checkCursorBinary() },
]);
```

---

## What It Does

1. **Checks each provider binary** via `adapter.isAvailable()`
2. **Caches results** in `providerRuntimeCache` (30s TTL for available, ~10s for unavailable)
3. **Records telemetry** (`PreflightTelemetry`) with success/fail counts and durations
4. **Makes first execution warm** — subsequent task dispatches hit the cache instead of running `which` again

---

## Cold Start Tracking

```typescript
// First task execution in this process:
const { isColdStart } = markExecutionStarted();
// isColdStart === true  (first time)
// isColdStart === false (subsequent)
```

Cold-start flag is attached to `ProviderExecutionTelemetry` metadata for observability.

---

## Binary Path Cache

```typescript
const path = await resolveBinaryPath("claude-code");
// First call: execFile("which", ["claude-code"]) → caches result
// Second call: returns cached result (no subprocess)
```

---

## Debug Endpoint

**GET /telemetry/preflight**

```json
{
  "hasRun": true,
  "telemetry": {
    "ranAt": "2026-04-27T10:00:00.000Z",
    "totalProviders": 3,
    "successCount": 2,
    "failCount": 1,
    "results": [
      { "providerId": "claude-code", "available": true, "durationMs": 45 },
      { "providerId": "codex", "available": true, "durationMs": 32 },
      { "providerId": "cursor", "available": false, "durationMs": 12 }
    ]
  }
}
```

---

## Disabling Warm-up

```bash
OSCORPEX_PREFLIGHT_ENABLED=false
```

When disabled:
- `runPreflightHealthChecks()` returns `[]` immediately
- First task dispatch performs fresh binary checks (cold start)
- No telemetry is recorded

---

## Known Limitations

1. **No periodic recheck** — If a provider goes down after preflight, first failure triggers cooldown. No automatic re-warm exists.
2. **Process-local** — Preflight runs per kernel process. Multi-instance deployments run independently.
3. **Synchronous per provider** — Checks run sequentially, not in parallel (avoids subprocess storm).
