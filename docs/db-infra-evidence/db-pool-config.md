# DB Pool Configuration (EPIC 3)

**Module**: `apps/kernel/src/studio/performance-config.ts` → `getDbPoolConfig()`
**Applied in**: `apps/kernel/src/studio/pg.ts` (Pool constructor)

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OSCORPEX_DB_POOL_MIN` | 2 | Minimum connections in pool |
| `OSCORPEX_DB_POOL_MAX` | 20 | Maximum connections in pool |
| `OSCORPEX_DB_IDLE_TIMEOUT_MS` | 30000 | Idle connection timeout (ms) |
| `OSCORPEX_DB_ACQUIRE_TIMEOUT_MS` | 5000 | Connection acquisition timeout (ms) |

---

## Current pg.ts Settings

```typescript
_pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://...",
  max: 20,                    // ← hardcoded, should use getDbPoolConfig()
  idleTimeoutMillis: 30_000,  // ← hardcoded
  connectionTimeoutMillis: 5_000,  // ← hardcoded
});
```

**Note**: `pg.ts` currently hardcodes these values. The config module provides the values, but `pg.ts` has not yet been updated to consume them. This is intentional — changing pool constructor params requires careful testing and is a Phase 2 or Phase 3 change.

---

## Recommended Values

### Staging

```bash
OSCORPEX_DB_POOL_MIN=2
OSCORPEX_DB_POOL_MAX=20
OSCORPEX_DB_IDLE_TIMEOUT_MS=30000
OSCORPEX_DB_ACQUIRE_TIMEOUT_MS=5000
```

### Production (High Load)

```bash
OSCORPEX_DB_POOL_MIN=5
OSCORPEX_DB_POOL_MAX=50
OSCORPEX_DB_IDLE_TIMEOUT_MS=60000
OSCORPEX_DB_ACQUIRE_TIMEOUT_MS=10000
```

**Rationale for Production**:
- `max=50`: Adaptive concurrency allows up to 10 concurrent tasks. Each task holds 1-2 DB connections. Plus telemetry writes, health checks, and UI queries. 50 provides headroom.
- `idleTimeoutMs=60000`: Keep connections alive longer to avoid reconnection overhead during peak hours.
- `acquireTimeoutMs=10000`: Give slow queries more time to acquire a connection before failing.

### Production (Memory-Constrained)

```bash
OSCORPEX_DB_POOL_MIN=1
OSCORPEX_DB_POOL_MAX=10
OSCORPEX_DB_IDLE_TIMEOUT_MS=15000
OSCORPEX_DB_ACQUIRE_TIMEOUT_MS=3000
```

**Rationale**: If the DB server is small (e.g., 1GB RAM), limit connections to prevent memory exhaustion.

---

## Pool Size Formula

```
maxConnections = (maxConcurrentTasks × 2) + (UI users × 1) + (backgroundWorkers × 1) + headroom(5)
```

Example:
- maxConcurrentTasks = 10
- UI users = 5
- backgroundWorkers = 3
- headroom = 5
- **maxConnections = (10 × 2) + 5 + 3 + 5 = 33**

---

## Monitoring

Use the debug endpoint to monitor pool usage:

```bash
curl http://localhost:3141/api/studio/telemetry/db-pool
```

Response:
```json
{
  "pool": {
    "total": 8,
    "idle": 3,
    "waiting": 0,
    "active": 5,
    "max": 20,
    "connectionTimeoutMs": 5000,
    "idleTimeoutMs": 30000
  }
}
```

**Alert if**:
- `waiting > 5` for > 30 seconds → increase `max`
- `active == max` for > 60 seconds → increase `max` or reduce concurrency
- `total < min` after warmup → check DB connectivity
