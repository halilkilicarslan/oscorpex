# Oscorpex — Logging & Trace Standardization

This document defines the conventions for structured logging across the Oscorpex kernel.

## Logger Setup

Every module must use Pino via the internal `createLogger` helper:

```typescript
import { createLogger } from "./logger.js";
const log = createLogger("module-name");
```

The module name should be:
- Lowercase with hyphens (e.g., `boot:db`, `provider-registry`, `replay-store`)
- Hierarchical for boot phases: `boot:<phase>` (e.g., `boot:http`, `boot:replay`)

## Log Levels

| Level | Usage |
|-------|-------|
| `fatal` | System cannot continue (e.g., DB unreachable at boot) |
| `error` | Operation failed but system continues (e.g., recovery phase failed) |
| `warn` | Non-blocking anomaly (e.g., provider state load skipped) |
| `info` | Normal lifecycle events (e.g., "HTTP server ready") |
| `debug` | Detailed execution trace (disabled in production) |

## Structured Log Fields

### Required for every log
- `level` — Pino level
- `time` — ISO timestamp
- `service` — Always `"oscorpex"`
- `module` — Module name from `createLogger`

### Contextual fields (add when relevant)
- `projectId` — Project context
- `runId` — Execution run context
- `taskId` — Task context
- `agentId` — Agent context
- `provider` — Provider ID
- `err` — Error object (always as first positional arg: `log.warn({ err }, "msg")`)

## Patterns

### Correct
```typescript
log.info("Checkpoint created for project %s at stage %s", projectId, stageIndex);
log.warn({ err }, "Provider registry init skipped");
log.error({ err }, "Startup recovery failed");
```

### Incorrect
```typescript
log.warn("msg", err);           // Pino type error — err must be in object
log.info("Checkpoint created for project " + projectId);  // Avoid string concat
```

## Critical Events That Must Be Logged

| Event | Level | Required Fields |
|-------|-------|-----------------|
| Boot start | info | `port` |
| Boot complete | info | `port` |
| DB bootstrap failure | fatal | `err` |
| Provider registry init | info | `adapterCount` |
| Task assigned | info | `taskId`, `agentId`, `projectId` |
| Task completed | info | `taskId`, `agentId`, `projectId`, `durationMs` |
| Task failed | error | `taskId`, `agentId`, `projectId`, `err` |
| Pipeline stage completed | info | `projectId`, `stageIndex` |
| Pipeline completed | info | `projectId`, `status` |
| Budget warning | warn | `projectId`, `currentCost`, `limitCost` |
| Budget exceeded | error | `projectId`, `currentCost`, `limitCost` |
| Replay checkpoint created | info | `projectId`, `checkpoint` |
| Replay restore requested | info | `projectId`, `runId`, `dryRun` |
| Provider execution cancelled | info | `runId`, `taskId` |
| Policy violation | warn | `projectId`, `taskId`, `violation` |
| Sandbox violation | warn | `projectId`, `taskId`, `tool`, `reason` |

## Correlation ID (Implemented)

Correlation ID propagation is active across the kernel:

- **HTTP requests**: `x-correlation-id` header is read from incoming requests; generated if missing; always returned in response headers
- **WebSocket connections**: `correlationId` query parameter is accepted and propagated through WebSocket events
- **SSE streams**: `x-correlation-id` header is included in SSE response headers
- **Event bus**: All events automatically carry `correlationId` and `causationId` from the async context
- **Logger**: `createLogger()` automatically injects `correlationId` when inside an active correlation context
- **Guaranteed header**: A fallback middleware ensures `x-correlation-id` is present even on error responses

### Usage

```typescript
import { withCorrelation, getCurrentCorrelationId } from "./correlation-context.js";

// Inside HTTP handlers — automatic (correlationMiddleware handles it)
// Inside manual async flows:
await withCorrelation(async () => {
  const id = getCurrentCorrelationId();
  log.info("Processing task %s", taskId);
  // correlationId is automatically attached to this log entry
}, "optional-fixed-id");
```

## Implementation Status

| Feature | Status | Commit |
|---------|--------|--------|
| Module-scoped child loggers | **Implemented** | Initial |
| Log level standardization | **Implemented** | Initial |
| Structured JSON output | **Implemented** | Initial |
| Correlation ID auto-injection | **Implemented** | `8161288` |
| WebSocket/SSE correlation propagation | **Implemented** | `3da4fbe` |
| Guaranteed header on error responses | **Implemented** | `3da4fbe` |
| Pino-pretty auto-install | Planned | — |
| OpenTelemetry trace integration | Planned | — |

## Log Destination

- **Development**: stdout (human-readable via `pino-pretty` if installed)
- **Production**: stdout as structured JSON (ingested by log aggregator)
- **Never** write logs to files inside the container
