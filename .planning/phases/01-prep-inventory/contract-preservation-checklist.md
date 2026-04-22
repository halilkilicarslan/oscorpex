# Phase 01: Contract Preservation Checklist

**Established:** 2025-04-22
**Status:** Active

---

## Behavioral Contracts That MUST NOT Break

### 1. API Contract

**Covers**: All routes in `src/studio/routes/` (32 modules)

**Verification**:
```bash
pnpm build && pnpm typecheck
```

**What constitutes a break**:
- Any HTTP endpoint changes request/response shape
- Route paths change
- WebSocket event types removed or renamed

**Temporary breaks acceptable**: During a phase, if fixed before phase completion

---

### 2. WebSocket Contract

**Covers**: All event types in the `EventType` union (52 types)

**Verification**:
```bash
# No EventType values removed (additions only)
rg "EventType.*=" src/studio/types.ts
```

**What constitutes a break**:
- Any existing `EventType` value removed from the union
- `StudioEvent` interface shape changes (field removal)
- WebSocket message format changes

**Rule**: EventType additions are allowed, removals are not.

---

### 3. Task Lifecycle Contract

**Covers**: All transitions documented in `state-transitions.md`

**Verification**: Integration tests for each transition path

**What constitutes a break**:
- A legal transition becomes impossible
- A transition that emitted an event no longer emits it
- A transition's side effects (DB writes, events) are removed

**Temporary breaks**: Acceptable during a phase if all transitions are restored by phase end.

---

### 4. Provider Adapter Contract

**Covers**: `CLIAdapter` interface and 3 implementations (Claude, Codex, Cursor)

**Verification**:
```bash
pnpm typecheck
```

**What constitutes a break**:
- `CLIAdapter` interface signature changes without backward compatibility
- Any provider adapter stops working
- `getAdapter()` or `getAdapterChain()` return types change

**Extraction rule**: New `ProviderAdapter` contract must coexist with `CLIAdapter` until migration is complete.

---

### 5. Database Contract

**Covers**: Schema in `scripts/init.sql` (83 tables)

**Verification**:
```bash
pnpm docker:up && sleep 3 && pnpm test
```

**What constitutes a break**:
- Table or column removed
- Column type narrowed
- NOT NULL constraint added without default

**Rule**: Additive migrations only. New columns and tables are always OK.

---

### 6. Event Contract

**Covers**: All `eventBus.emit()` and `eventBus.emitTransient()` calls

**Verification**:
```bash
# Count should not decrease
rg "eventBus\.emit\(" src/studio/*.ts | wc -l
rg "eventBus\.emitTransient\(" src/studio/*.ts | wc -l
```

**What constitutes a break**:
- An emit call is removed without replacement
- An event type is renamed (breaks subscribers)
- Payload shape changes incompatibly

**Rule**: New events OK. Renamed/removed events require subscriber migration first.

---

### 7. Pipeline Contract

**Covers**: DAG execution and stage progression in `pipeline-engine.ts`

**Verification**: Integration tests for stage progression

**What constitutes a break**:
- Tasks execute in wrong order
- Stage dependencies not respected
- Pipeline pause/resume/retry behavior changes

---

### 8. Verification Contract

**Covers**: Task completion decisions via `execution-gates.ts`

**Verification**: Task outcomes (done/failed/revision) must be consistent

**What constitutes a break**:
- Tasks that previously passed verification now fail
- Tasks that previously failed now pass
- Review loop behavior changes

---

### 9. Frontend Contract

**Covers**: Console API client in `console/src/lib/studio-api/`

**Verification**:
```bash
cd console && pnpm tsc -b
```

**What constitutes a break**:
- API response types change without frontend update
- Endpoint URL changes
- WebSocket event format changes

---

## Phased Extraction Rules

1. **Every extracted package MUST have its own tests before anything depends on it.**
   - `@oscorpex/core` needs type tests before `@oscorpex/event-schema` imports from it
   - `@oscorpex/event-schema` needs payload tests before `event-bus.ts` delegates to it

2. **When moving code, leave a re-export shim in the original location.**
   ```ts
   // src/studio/event-bus.ts (after extraction)
   export { EventBus } from "@oscorpex/event-schema";
   export type { EventType } from "@oscorpex/event-schema";
   ```

3. **Remove shims only after all consumers are updated.**
   - Track shim removal as a separate task
   - Never remove a shim and update consumers in the same commit

4. **Type-only packages can be published before implementation.**
   - `@oscorpex/core` types can be defined before any implementation
   - Consumers can start importing types immediately

5. **Behavioral parity is verified by running the same test suite before and after extraction.**
   - Run `pnpm test` before extraction
   - Run `pnpm test` after extraction
   - Same test count, same pass/fail count

6. **Pnpm workspace resolution must work at every step.**
   - `pnpm install` must succeed after every commit
   - `pnpm build` must succeed after every commit
   - `pnpm typecheck` must pass after every commit

---

## Regression Checkpoint

Run after each phase:
```bash
pnpm install && pnpm build && pnpm typecheck && pnpm test
```

Expected: 0 type errors, same test count (1056 passed + 2 PG connection failures).

---

*Phase: 01-prep-inventory*
*Established: 2025-04-22*