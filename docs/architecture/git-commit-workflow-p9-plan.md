# Git Commit Workflow — P9 Design Plan

**Status**: Design  
**Version**: 1.0  
**Date**: 2026-05-14  
**Authors**: Oscorpex Platform Team

---

## Overview

This document defines the safe, human-approved git commit workflow that will be implemented in P9. The goal is to allow an LLM agent (operating via MCP) to propose and apply git commits while maintaining strict human oversight, audit trails, secret scanning, and checkpoint-based rollback.

The workflow is intentionally conservative: the first version supports only `git commit` against already-staged changes. Push, rebase, merge, and reset operations are deferred to future milestones.

---

## Goal

Provide a MCP-exposed `git.commit` operation that is:

1. **Safe** — a checkpoint is created before every commit; rollback is always possible.
2. **Transparent** — the human sees an exact diff before approving.
3. **Secret-free** — every staged file is scanned for known secret patterns.
4. **Test-gated** — the commit is blocked if the test suite has not passed.
5. **Auditable** — every step emits a structured audit event.

---

## Non-Goals (First Version)

The following git operations are explicitly **out of scope** for P9:

| Operation | Reason deferred |
|-----------|----------------|
| `git push` | Requires remote auth, irreversible without force; deferred to P10 |
| `git reset` (hard/mixed) | Destructive; requires separate safety analysis |
| `git rebase` | Complex conflict resolution; deferred |
| `git merge` | Multi-parent history; deferred |
| `git push --force` | Never implemented without explicit human CLI action |
| `git checkout .` / `git restore` | Discards unstaged work silently; deferred |
| `git clean` | Destructive filesystem operation; deferred |
| `git branch -D` | Branch deletion; deferred |
| `git tag -d` | Tag deletion; deferred |

---

## Threat Model

### LLM-Crafted Commits

An LLM agent could attempt to:

- Inject malicious code into a staged file, then trigger a commit to persist it.
- Write a commit message that obscures what actually changed (e.g., benign-sounding message over a backdoor).
- Loop commit operations rapidly to exhaust audit log storage or obscure history.

**Mitigations**:
- Mandatory diff preview — human reads the exact patch before approving.
- Commit message policy enforced programmatically (length, banned patterns).
- Rate limit: max 5 `git.commit` MCP calls per pipeline execution.
- All commit proposals are logged to `audit_events` before execution.

### Secret Leakage

An LLM agent (or a misguided automation) could accidentally stage a file containing:

- API keys, tokens, or passwords
- Private keys (RSA, EC, SSH)
- Connection strings with embedded credentials
- `.env` files or cloud credentials

**Mitigations**:
- Pre-commit secret scan runs against every staged file using regex pattern matching.
- Commit is hard-blocked if any secret pattern matches — no override allowed.
- Patterns cover: AWS keys, GCP service accounts, GitHub tokens, JWT secrets, PEM blocks, connection strings, generic `password=` / `secret=` / `api_key=` assignments.

### Unauthorized Code Changes

An LLM agent could attempt to commit code the human did not intend:

- Staged files outside the expected workspace scope.
- Changes to security-sensitive files (`init.sql`, `routes/index.ts`, auth middleware).
- Binary files or files exceeding size limits.

**Mitigations**:
- File policy blocklist applied before diff is presented (mirrors P1 tool policy).
- Binary file commits blocked.
- Files exceeding 500 KB blocked.
- Sensitive path list checked: `scripts/init.sql`, `*.env*`, `*credentials*`, `*secret*`.

---

## Allowed Operations

### `git.commit`

**Description**: Proposes a commit for the currently staged changes, subject to all guards.

**Preconditions** (all must be satisfied):

1. A checkpoint exists and is current (created within the last 60 minutes, or immediately before this call).
2. There are staged changes (`git diff --cached --name-only` is non-empty).
3. The test suite has passed since the last file modification (test-pass token is valid).
4. No secret pattern matches any staged file.
5. No blocked file path is staged.
6. The proposed commit message passes policy validation.
7. The human has reviewed the diff and submitted an explicit approval.

**Postconditions**:

- Commit is applied via `git commit -m "<message>"`.
- `commit:applied` audit event is emitted with commit SHA.
- Checkpoint record is updated with the new HEAD SHA.

---

## Denied Operations

The MCP bridge enforces a static allowlist. Any call to the following operations returns `OperationDeniedError` immediately, without human review:

```
git.push
git.push_force
git.reset
git.reset_hard
git.rebase
git.merge
git.cherry_pick
git.branch_delete
git.tag_delete
git.checkout_discard
git.clean
git.stash_drop
```

Denial events are logged to `audit_events` with `action = "git.operation.denied"`.

---

## Required Checkpoint

Before any `git.commit` is executed, a checkpoint must exist.

### Checkpoint Creation

A checkpoint is a lightweight record consisting of:

```typescript
interface GitCheckpoint {
  id: string;               // UUID
  createdAt: Date;
  headSha: string;          // git rev-parse HEAD at checkpoint time
  branchName: string;       // git branch --show-current
  stagedFiles: string[];    // git diff --cached --name-only at checkpoint time
  projectId: string;
  pipelineId: string | null;
}
```

Checkpoints are stored in the `git_checkpoints` table (to be created in P9 migration).

### Checkpoint Validity

A checkpoint is valid if:

- It was created within the last 60 minutes, **and**
- `headSha` matches the current `git rev-parse HEAD` (no external commits occurred).

If the checkpoint is invalid, `git.commit` is blocked and a new checkpoint must be explicitly created by the operator.

---

## Required Approval

Every `git.commit` requires a human approval. The approval flow:

1. Agent calls `git.propose_commit(message, stagedFiles)`.
2. System generates a diff preview (see below) and creates a `commit_proposal` record.
3. Approval request is surfaced to the human in the Console UI (same approval widget used for task approvals).
4. Human reviews diff, approves or rejects.
5. On approval, system executes the commit and emits `commit:applied`.
6. On rejection, system emits `commit:rejected` and the staged changes remain intact.

Approval tokens expire after 10 minutes. Expired approvals cannot be used.

---

## Diff Preview

The diff preview is mandatory and must be presented to the human before any approval is requested.

### Format

```
--- Staged Changes ---
Files changed: 3
Insertions: +47
Deletions: -12

diff --git a/apps/kernel/src/studio/foo.ts b/apps/kernel/src/studio/foo.ts
index abc123..def456 100644
--- a/apps/kernel/src/studio/foo.ts
+++ b/apps/kernel/src/studio/foo.ts
@@ -10,6 +10,8 @@ export function bar() {
...
```

### Constraints

- Maximum diff size rendered in UI: 500 KB. Larger diffs show a truncated view with a warning.
- Binary files shown as `[binary file — N bytes]` without content.
- Diff is generated at proposal time and stored in the `commit_proposals` table. The stored diff is what the human sees — it cannot be changed after proposal.

---

## Commit Message Policy

Commit messages must satisfy all of the following:

| Rule | Enforcement |
|------|-------------|
| First line max 72 characters | Hard block |
| First line not empty | Hard block |
| No secret patterns in message | Hard block (same regex as file scan) |
| No `[skip ci]` or `--no-verify` in message | Hard block |
| Conventional commit prefix preferred | Warn only (not blocked) |
| Blank line between subject and body (if body present) | Warn only |

Conventional commit prefixes (warn if missing): `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `style`, `ci`, `build`, `revert`.

---

## Secret Scan

Every staged file is scanned before the diff is presented. The scan uses the following pattern categories:

### Pattern Categories

| Category | Example Pattern |
|----------|----------------|
| AWS Access Key | `AKIA[0-9A-Z]{16}` |
| AWS Secret Key | `(?i)aws.{0,20}secret.{0,20}['\"][0-9a-zA-Z/+]{40}` |
| GitHub Token | `ghp_[0-9a-zA-Z]{36}` or `github_pat_[0-9a-zA-Z_]{82}` |
| GCP Service Account | `"type": "service_account"` |
| Private Key PEM Block | `-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----` |
| Generic API Key | `(?i)(api_key|apikey)\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}` |
| Generic Secret | `(?i)(secret|password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}` |
| JWT Token | `eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+` |
| Connection String with password | `(?i)(postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]{4,}@` |
| Anthropic API Key | `sk-ant-[a-zA-Z0-9_\-]{40,}` |
| OpenAI API Key | `sk-[a-zA-Z0-9]{48}` |

### Scan Behavior

- Scan is run against the raw bytes of each staged file.
- Binary files are skipped (no text to scan, and binary commits are already blocked).
- If any match is found:
  - The commit proposal is rejected immediately.
  - `commit:secret_scan_failed` audit event is emitted with the file name and pattern category (but NOT the matched value).
  - The human is notified with the file name and category.
- False positive override: not supported in first version. The human must unstage the file, clean the secret, and re-stage.

---

## Test Requirements

A commit is blocked unless the test suite has passed since the last modification to any staged file.

### Test-Pass Token

When `vitest run` (or the configured test command) exits with code 0, the system issues a test-pass token:

```typescript
interface TestPassToken {
  issuedAt: Date;
  coveredFiles: string[];   // files in scope when tests ran
  testCommand: string;
  exitCode: 0;
}
```

The token is valid for 30 minutes. If staged files were modified after the token was issued, the token is invalidated.

If no valid token exists, `git.commit` returns `TestRequiredError` with guidance on which test command to run.

---

## Rollback Strategy

If a commit is applied and the human subsequently determines it was incorrect, the rollback path is:

### Soft Reset to Checkpoint

```bash
git reset --soft <checkpoint.headSha>
```

This:
- Moves HEAD back to the checkpoint SHA.
- Leaves all changes staged (nothing is lost from the working tree).
- Does not rewrite history in any way that requires force-push.

The soft reset is exposed as `git.rollback_to_checkpoint(checkpointId)` in the MCP bridge and requires the same human approval flow as a commit.

### Rollback Preconditions

- The target checkpoint must exist in `git_checkpoints` and belong to the current project.
- The checkpoint `headSha` must be reachable from the current HEAD (i.e., it is an ancestor).
- The current branch must not have been pushed to remote after the checkpoint was created (to avoid divergence).

---

## Audit Events

All git workflow operations emit structured events to the `audit_events` table.

| Event | Trigger | Key Fields |
|-------|---------|-----------|
| `checkpoint:created` | Checkpoint is successfully recorded | `headSha`, `branchName`, `stagedFiles[]` |
| `commit:proposed` | Agent submits a commit proposal | `message`, `stagedFiles[]`, `diffSizeBytes` |
| `commit:secret_scan_failed` | Secret pattern found in staged file | `fileName`, `patternCategory` |
| `commit:test_gate_failed` | No valid test-pass token | `lastTestRun`, `stagedFiles[]` |
| `commit:approved` | Human approves the proposal | `approvedBy`, `proposalId` |
| `commit:rejected` | Human rejects the proposal | `rejectedBy`, `proposalId`, `reason?` |
| `commit:applied` | git commit executed successfully | `sha`, `message`, `filesChanged`, `insertions`, `deletions` |
| `commit:apply_failed` | git commit execution failed | `error`, `proposalId` |
| `commit:rollback_proposed` | Rollback to checkpoint proposed | `checkpointId`, `targetSha` |
| `commit:rollback_applied` | git reset --soft executed | `fromSha`, `toSha`, `checkpointId` |
| `git.operation.denied` | Denied operation attempted | `operation`, `callerContext` |

All events include: `projectId`, `pipelineId?`, `actorType` (`agent` or `human`), `actorId`, `timestamp`.

---

## P9 Implementation Plan

### Phase 1 — Diff Preview Infrastructure

**Goal**: Human can see an exact diff before any commit is made.

Tasks:
1. DB migration: `git_checkpoints` table, `commit_proposals` table.
2. `git-checkpoint-service.ts` — create, validate, list checkpoints.
3. `git-diff-service.ts` — generate diff from staged changes, store snapshot.
4. MCP tool: `git.create_checkpoint` (no approval required).
5. MCP tool: `git.propose_commit` — validates preconditions, generates diff, creates proposal.
6. Console UI: diff viewer component (unified diff, syntax highlight, file list).
7. Audit event emission for `checkpoint:created` and `commit:proposed`.

Acceptance criteria:
- Agent can call `git.propose_commit`, human sees the full diff in Console.
- Proposal is stored and retrievable by ID.
- Checkpoint headSha is verified against current HEAD.

### Phase 2 — Commit Execution

**Goal**: Human-approved commits are applied with full guard enforcement.

Tasks:
1. Secret scan service — pattern registry + file scan runner.
2. Test-pass token service — issue, validate, invalidate on file change.
3. Commit message policy validator.
4. Approval integration — wire `commit_proposals` into existing approval widget.
5. `git-commit-executor.ts` — runs `git commit -m`, captures SHA, emits `commit:applied`.
6. MCP tool: `git.approve_commit` (human-facing, not agent-facing).
7. Rate limiter: max 5 `git.commit` calls per pipeline.
8. Audit events for all commit lifecycle steps.

Acceptance criteria:
- Commit blocked if secret found in staged file.
- Commit blocked if no valid test-pass token.
- Commit blocked if message violates policy.
- Commit applied only after human approval.
- `commit:applied` event records exact SHA.

### Phase 3 — Post-Commit Verification and Rollback

**Goal**: Verify commit integrity after application; provide safe rollback.

Tasks:
1. Post-commit verification: re-run typecheck, confirm SHA matches expected.
2. `git.rollback_to_checkpoint` MCP tool — requires approval, runs `git reset --soft`.
3. Rollback precondition checks (ancestry, push status).
4. Console UI: checkpoint history panel, rollback trigger button.
5. Audit events for rollback lifecycle.
6. Integration test: full propose → approve → commit → rollback cycle.

Acceptance criteria:
- Rollback returns staged files to pre-commit state without data loss.
- Post-commit typecheck failure triggers alert (does not auto-rollback).
- Full audit trail queryable from Console.

---

## Database Schema (P9 Migration)

```sql
CREATE TABLE IF NOT EXISTS git_checkpoints (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    pipeline_id     UUID REFERENCES pipelines(id) ON DELETE SET NULL,
    head_sha        TEXT NOT NULL,
    branch_name     TEXT NOT NULL,
    staged_files    JSONB NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    invalidated_at  TIMESTAMPTZ,
    invalidation_reason TEXT
);

CREATE TABLE IF NOT EXISTS commit_proposals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    checkpoint_id   UUID NOT NULL REFERENCES git_checkpoints(id),
    message         TEXT NOT NULL,
    staged_files    JSONB NOT NULL,
    diff_snapshot   TEXT NOT NULL,
    diff_size_bytes INTEGER NOT NULL,
    secret_scan_passed BOOLEAN NOT NULL DEFAULT FALSE,
    test_gate_passed   BOOLEAN NOT NULL DEFAULT FALSE,
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | applied | failed
    proposed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at      TIMESTAMPTZ,
    applied_at      TIMESTAMPTZ,
    result_sha      TEXT,
    decided_by      UUID REFERENCES users(id),
    rejection_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_git_checkpoints_project_id ON git_checkpoints(project_id);
CREATE INDEX IF NOT EXISTS idx_commit_proposals_project_id ON commit_proposals(project_id);
CREATE INDEX IF NOT EXISTS idx_commit_proposals_status ON commit_proposals(status);
```

---

## References

- P3 Checkpoint Design: `docs/architecture/checkpoint-rollback-p3-plan.md`
- MCP Bridge Readonly Plan: `docs/architecture/mcp-bridge-readonly-plan.md`
- Tool Policy (P1): `apps/kernel/src/studio/execution/tool-policy.ts`
- Audit Events Schema: `apps/kernel/scripts/init.sql` (`audit_events` table)
- Approval Service: `apps/kernel/src/studio/task/approval-service.ts`
