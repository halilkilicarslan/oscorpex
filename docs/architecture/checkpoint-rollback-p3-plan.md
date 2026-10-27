# Checkpoint / Rollback P3 Plan

## Goal

Provide a minimal, reliable mechanism to snapshot workspace state before dangerous operations and roll back when failures or policy violations occur. Enable safe autonomous agent execution by ensuring every destructive action is reversible.

## Non-Goals

- Full PITR (point-in-time recovery) for the database
- Version control replacement (Git already handles file history)
- Cross-tenant checkpoint sharing
- Real-time streaming checkpoint (too expensive for MVP)

## Threat Model

| Threat | Checkpoint Protection |
|--------|----------------------|
| Agent writes destructive code | Git checkpoint → rollback to pre-change state |
| Agent deletes critical files | Filesystem snapshot → restore |
| Migration corrupts DB schema | DB checkpoint (schema hash) → alert, manual rollback |
| Pipeline produces wrong output | Task-state checkpoint → revert to pre-task state |
| Provider returns malicious content | Provider-output checkpoint → discard and retry |
| Rollback leaks secrets | Secret-aware restore: never restore secrets into context |

## Checkpoint Types

| Type | What's Captured | Storage | Restore Method |
|------|----------------|---------|----------------|
| `git` | Git ref (commit SHA) | Git repo | `git checkout <ref>` |
| `filesystem` | File content hash manifest | DB + optional blob store | Re-create files from manifest |
| `database` | Schema version hash | DB table | Alert only (manual restore) |
| `task-state` | Task status, assigned agent, retry count | DB snapshot row | UPDATE task to checkpoint state |
| `pipeline-state` | Stage index, phase statuses | DB snapshot row | UPDATE pipeline to checkpoint state |
| `provider-output` | Raw provider response | DB JSON column | Discard and re-execute |

## Data Model

```sql
CREATE TABLE IF NOT EXISTS checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    run_id UUID,
    task_id UUID,
    type TEXT NOT NULL CHECK (type IN ('git', 'filesystem', 'database', 'task-state', 'pipeline-state', 'provider-output')),
    ref TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT NOT NULL CHECK (created_by IN ('system', 'user', 'agent')),
    reason TEXT NOT NULL,
    risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rolled_back', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_project ON checkpoints(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON checkpoints(task_id) WHERE task_id IS NOT NULL;

ALTER TABLE checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY checkpoint_tenant_isolation ON checkpoints
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS rollback_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checkpoint_id UUID NOT NULL REFERENCES checkpoints(id),
    requested_by TEXT NOT NULL,
    reason TEXT NOT NULL,
    dry_run BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'applied', 'failed', 'rejected')),
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);
```

## Event Model

```typescript
// New event types for @oscorpex/event-schema
type CheckpointEventType =
    | "checkpoint:created"
    | "checkpoint:rollback_requested"
    | "checkpoint:rollback_approved"
    | "checkpoint:rollback_applied"
    | "checkpoint:rollback_failed"
    | "checkpoint:expired";
```

## API Contract

```typescript
interface Checkpoint {
    id: string;
    tenantId: string;
    projectId: string;
    runId?: string;
    taskId?: string;
    type: "git" | "filesystem" | "database" | "task-state" | "pipeline-state" | "provider-output";
    ref: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
    createdBy: "system" | "user" | "agent";
    reason: string;
    riskLevel: "low" | "medium" | "high";
    status: "active" | "rolled_back" | "expired";
}

interface RollbackRequest {
    checkpointId: string;
    requestedBy: string;
    reason: string;
    dryRun: boolean;
}

interface RollbackResult {
    status: "planned" | "applied" | "failed" | "requires_approval";
    changedFiles?: string[];
    restoredState?: Record<string, unknown>;
    errors?: string[];
}

// Service interface
interface CheckpointService {
    createCheckpoint(params: Omit<Checkpoint, "id" | "createdAt" | "status">): Promise<Checkpoint>;
    getCheckpoint(id: string): Promise<Checkpoint | null>;
    listCheckpoints(projectId: string, opts?: { type?: string; limit?: number }): Promise<Checkpoint[]>;
    requestRollback(request: RollbackRequest): Promise<RollbackResult>;
    expireOldCheckpoints(olderThanDays: number): Promise<number>;
}
```

## Integration Points

| When | Checkpoint Type | Created By | Risk Level |
|------|----------------|-----------|-----------|
| Before file write (agent task) | `git` | system | medium |
| Before app-runner script execution | `git` + `filesystem` | system | high |
| Before provider tool execution | `provider-output` | system | medium |
| Before Git mutation (force push, reset) | `git` | system | high |
| Before DB migration | `database` | system | high |
| Before task graph mutation (insertNode) | `task-state` | system | low |
| Before destructive action requiring approval | `pipeline-state` | system | high |

### Wiring into existing code

```
task-executor.ts:
    Before executeTaskInner() → createCheckpoint({ type: "git", reason: "pre-task" })
    After task completion → mark checkpoint as "consumed" or create new one

app-runner/starter.ts:
    Before migration execSync → createCheckpoint({ type: "database", reason: "pre-migration" })

graph-coordinator.ts:
    Before applyInsertNode() → createCheckpoint({ type: "task-state", reason: "pre-mutation" })

pipeline-engine.ts:
    Before advanceStage() → createCheckpoint({ type: "pipeline-state", reason: "pre-advance" })
```

## Rollback Semantics

| Checkpoint Type | Rollback Action | Reversible? |
|----------------|----------------|-------------|
| `git` | `git checkout <ref>` or `git stash` + restore | Yes |
| `filesystem` | Restore files from manifest | Yes |
| `database` | Alert only — manual DBA action | No (alert only) |
| `task-state` | UPDATE task status/retry count | Yes |
| `pipeline-state` | UPDATE pipeline stage/status | Yes |
| `provider-output` | Discard output, mark task for re-execution | Yes |

### Rollback rules

1. Rollback MUST preserve tenant isolation (tenant_id check)
2. Rollback MUST NOT restore secrets into memory/context/prompts
3. Rollback of `git` type MUST verify workspace scope before checkout
4. Rollback of `database` type is ALERT-ONLY — no automated schema rollback
5. High-risk rollback MUST require approval (uses existing approval-service)
6. All rollback actions MUST be auditable (event emitted)
7. Dry-run MUST be supported for all rollback types

## Approval Requirements

| Risk Level | Approval Required? |
|-----------|-------------------|
| low | No — auto-rollback |
| medium | No — auto-rollback with notification |
| high | Yes — requires human approval via approval-service |

## Verification Requirements

After rollback:
1. Verify workspace is within scope (assertInsideWorkspace)
2. Verify Git ref is valid and belongs to project
3. Verify no secret leakage in restored state
4. Emit `checkpoint:rollback_applied` event
5. Re-run verification gate on restored state

## Failure Modes

| Failure | Handling |
|---------|---------|
| Checkpoint storage fails | Log error, continue execution (non-blocking) |
| Rollback fails mid-operation | Mark as `failed`, preserve partial state, alert |
| Approval timeout | Keep checkpoint active, escalate notification |
| Expired checkpoint requested | Return error, suggest latest available checkpoint |
| Cross-tenant rollback attempt | Deny immediately (RLS + application check) |
| Concurrent rollback requests | Serialize via DB lock (SELECT FOR UPDATE) |

## P3 Implementation Plan

### Phase 3a — Core Checkpoint (Week 1)
1. Add `checkpoints` and `rollback_requests` tables to init.sql
2. Create `apps/kernel/src/studio/db/checkpoint-repo.ts`
3. Create `apps/kernel/src/studio/checkpoint-service.ts`
4. Add checkpoint event types to `@oscorpex/event-schema`
5. Wire `createCheckpoint()` into task-executor (pre-task)
6. Add checkpoint REST routes

### Phase 3b — Rollback Engine (Week 2)
7. Implement `requestRollback()` with dry-run support
8. Implement Git rollback (`git checkout <ref>`)
9. Implement task-state rollback (DB UPDATE)
10. Implement pipeline-state rollback
11. Wire approval-service for high-risk rollbacks
12. Add rollback REST routes

### Phase 3c — Integration & Testing (Week 3)
13. Wire into app-runner, graph-coordinator, pipeline-engine
14. Add checkpoint/rollback regression tests
15. Add checkpoint expiry cron
16. Add UI for checkpoint history and rollback actions
17. Integration test: create → checkpoint → modify → rollback → verify

### Dependencies
- Requires: tool-policy enforcement (P2-1) ✓
- Requires: workspace isolation (P1-3) ✓
- Requires: tenant context (P0-8) ✓
- Requires: approval-service (existing)

### Estimated effort
- 3 weeks for a single developer
- Can run in parallel with P3 frontend modernization
