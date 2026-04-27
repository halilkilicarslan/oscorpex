# Runtime Infra Debug Surface (EPIC 13)

**Endpoints Added**:
- `GET /telemetry/runtime` — Active execution state
- `GET /telemetry/db-pool` — DB pool snapshot (EPIC 2)

---

## GET /telemetry/runtime

### Response

```json
{
  "runtime": {
    "dispatchingTaskCount": 2,
    "activeControllerCount": 2,
    "semaphore": {
      "active": 2,
      "pending": 1,
      "max": 5
    },
    "workerId": "worker-12345-1777317000000"
  }
}
```

### Fields

| Field | Description |
|-------|-------------|
| `dispatchingTaskCount` | Number of tasks currently in the dispatch phase (prevents double-dispatch) |
| `activeControllerCount` | Number of running tasks with active AbortControllers |
| `semaphore.active` | Currently executing tasks (acquired semaphore slots) |
| `semaphore.pending` | Tasks waiting for semaphore |
| `semaphore.max` | Current max concurrency |
| `workerId` | Unique ID of this kernel worker |

---

## GET /telemetry/db-pool

### Response

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

---

## Endpoint Usage Examples

### Check for stuck tasks
```bash
curl http://localhost:3141/api/studio/telemetry/runtime | jq '.runtime.dispatchingTaskCount'
# If > 0 for extended time, tasks may be stuck
```

### Check pool pressure
```bash
curl http://localhost:3141/api/studio/telemetry/db-pool | jq '.pool.waiting'
# If > 5, increase pool size or reduce concurrency
```

### Full health check
```bash
curl http://localhost:3141/api/studio/telemetry/runtime
curl http://localhost:3141/api/studio/telemetry/db-pool
curl http://localhost:3141/api/studio/telemetry/concurrency
curl http://localhost:3141/api/studio/telemetry/cache
```

---

## Tests

### Runtime endpoint test
```typescript
it("returns runtime state", async () => {
  const res = await app.request("/telemetry/runtime");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.runtime).toHaveProperty("dispatchingTaskCount");
  expect(body.runtime).toHaveProperty("semaphore");
});
```

### DB pool endpoint test
```typescript
it("returns pool snapshot", async () => {
  const res = await app.request("/telemetry/db-pool");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.pool).toHaveProperty("total");
  expect(body.pool).toHaveProperty("waiting");
});
```
