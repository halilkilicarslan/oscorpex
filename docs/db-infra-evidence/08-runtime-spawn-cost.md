# Runtime Spawn Cost (EPIC 8)

**Scope**: CLI adapter spawn time — `cli-runtime.ts` and `execution-engine.ts`

---

## Spawn Metric Design

**What to measure**:
- `spawnStartAt`: Before `child_process.spawn()` or `execFile()`
- `spawnReadyAt`: After process stdout/stderr are ready
- `spawnLatencyMs`: `spawnReadyAt - spawnStartAt`

**Where to add**:
- `cli-runtime.ts::executeWithCLI()` — main CLI execution path
- `provider-registry.ts` — adapter registration/execution

---

## Provider-Based Measurement

| Provider | Typical Spawn | Notes |
|----------|--------------|-------|
| claude-code | ~200-500ms | Binary check + OAuth token validation |
| codex | ~100-300ms | Binary check + API key validation |
| cursor | ~150-400ms | Binary check + config load |

**Note**: Spawn latency is currently not measured. It is included in the overall `latencyMs` but cannot be isolated.

---

## Telemetry Record Enhancement

```typescript
interface ProviderExecutionTelemetry {
  // Existing fields...
  latencyMs: number;

  // Proposed addition:
  spawnLatencyMs?: number;  // Time to spawn the provider process
}
```

**Implementation complexity**: MEDIUM — requires instrumenting `cli-runtime.ts` and passing the value back to `execution-engine.ts`.

---

## Debug Surface

**GET /telemetry/runtime** (proposed in EPIC 13) would include:
```json
{
  "spawnMetrics": {
    "claude-code": { "avgMs": 350, "count": 1247 },
    "codex": { "avgMs": 180, "count": 892 },
    "cursor": { "avgMs": 220, "count": 534 }
  }
}
```

---

## Quick Win: Cold Start Detection

Already implemented via `preflight-warmup.ts`:
- `markExecutionStarted()` returns `{ isColdStart }`
- First execution after kernel boot = cold start
- Cold start includes spawn + binary check + cache miss

**Status**: ✅ Cold start is already tracked. Spawn-specific breakdown is future work.
