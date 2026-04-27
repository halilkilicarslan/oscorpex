# Provider State Persistence Optimization (EPIC 11)

**Module**: `provider-state.ts`

---

## Persist Frequency

**Current Behavior**:
- `markCooldown()` → `persistToDb()`
- `markRateLimited()` → `persistToDb()`
- `markSuccess()` → `persistToDb()`
- `markFailure()` → `persistToDb()` (only if < 3 failures)

**Persist Query**:
```sql
INSERT INTO provider_state (adapter, rate_limited, cooldown_until, consecutive_failures, last_success)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (adapter) DO UPDATE SET
  rate_limited = EXCLUDED.rate_limited,
  cooldown_until = EXCLUDED.cooldown_until,
  consecutive_failures = EXCLUDED.consecutive_failures,
  last_success = EXCLUDED.last_success;
```

**Frequency Estimate**:
- Per task execution: 1-2 persist calls (success or failure)
- Per cooldown trigger: 1 persist call
- Per fallback: 1 persist call (if it triggers cooldown)

**For 100 tasks/hour**: ~150 persist calls/hour = 2.5 calls/minute

**Assessment**: NOT a bottleneck. The rate is low and the query is simple (single-row UPSERT).

---

## Debounce/Bulk Opportunity

**Analysis**:
- `persistToDb()` iterates over all 3 providers and runs 3 UPSERTs
- If 2 providers change state within milliseconds, they could be batched

**Potential optimization**:
```typescript
// Debounce persist by 100ms
private persistTimer: ReturnType<typeof setTimeout> | null = null;

markCooldown(...) {
  // ... update state ...
  this.schedulePersist();
}

private schedulePersist(): void {
  if (this.persistTimer) return;
  this.persistTimer = setTimeout(() => {
    this.persistTimer = null;
    this.persistToDb();
  }, 100);
}
```

**Benefit**: Batches rapid state changes into a single persist cycle.
**Risk**: LOW — 100ms delay is acceptable for provider state.

---

## Lightweight Improvement

**Status**: NOT IMPLEMENTED

**Rationale**: Current persist rate is too low to justify the complexity. The UPSERT is fast and the table is tiny (3 rows).

**Revisit if**:
- Provider count grows > 10
- State changes increase to > 10/second
- DB CPU becomes a bottleneck
