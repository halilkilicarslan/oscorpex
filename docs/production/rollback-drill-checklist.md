# Rollback Drill Checklist

Version: 1.0 — 2026-05-14
Scope: Oscorpex RC1 — Application + Database + Subsystem Rollback
Frequency: Before each major release and after any production incident

---

## Overview

This checklist guides the operator through a complete rollback drill. It covers Git checkpoint rollback, database schema considerations, Docker image rollback, and disabling optional subsystems (Hermes, Gateway, Scheduler).

**Maximum rollback time target**: 30 minutes from decision to restored service

---

## Communication Template

Send this message to the team channel before starting a rollback:

```
[ROLLBACK IN PROGRESS]
Time: <UTC timestamp>
Environment: <staging | production>
Reason: <brief description>
Operator: <name>
Target version: <git SHA or Docker image tag>
ETA: <estimated completion time>

Updates will follow every 10 minutes.
```

Send a follow-up when complete:

```
[ROLLBACK COMPLETE / FAILED]
Time: <UTC timestamp>
Duration: <minutes>
Outcome: <restored | escalating>
Next steps: <monitoring window | incident ticket>
```

---

## Step 1: Identify Rollback Target

- [ ] Identify the last known-good Git SHA:

```bash
git log --oneline -20
# Find the last SHA before the bad deploy
```

- [ ] Identify the corresponding Docker image tag (format: `oscorpex/kernel:<SHA>` and `oscorpex/console:<SHA>`)
- [ ] Confirm the target database schema is compatible with the rollback application version
  - If the release included a **backward-compatible** migration: rollback is safe
  - If the release included a **breaking** schema change: execute database schema rollback first (Step 3)

---

## Step 2: Git Checkpoint Rollback Procedure

A "Git checkpoint rollback" means deploying the prior Git SHA — not reverting commits.

```bash
# Identify the target SHA
TARGET_SHA="<known-good-sha>"

# Pull the corresponding Docker images (built by CI for that SHA)
docker pull oscorpex/kernel:${TARGET_SHA}
docker pull oscorpex/console:${TARGET_SHA}

# Update docker-compose.yml or the orchestrator to use the target image tags
# Then redeploy:
docker compose up -d --no-build
```

- [ ] Target SHA identified and images available in the registry
- [ ] Docker images pulled successfully
- [ ] `docker compose up -d` exits 0
- [ ] `GET /health` returns 200 within 60 seconds of container start
- [ ] Check kernel logs for startup errors: `docker compose logs backend --tail=50`

---

## Step 3: Database Schema Rollback Considerations

Oscorpex migrations use `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS`. This means:
- **Additive migrations are safe to leave in place** when rolling back the application
- **No automatic down-migration scripts** exist — manual steps required for breaking changes

For each breaking schema change in the rolled-back release:

```sql
-- Example: if a column was added and must be removed
ALTER TABLE <table> DROP COLUMN IF EXISTS <column>;

-- Example: if a table was added and must be dropped
DROP TABLE IF EXISTS <new_table>;
```

- [ ] Review the Git diff between the bad SHA and the rollback target for schema changes
- [ ] For each breaking change, execute the inverse SQL in a transaction:

```sql
BEGIN;
-- inverse migration SQL here
COMMIT;
```

- [ ] Verify schema matches the rollback target: `\d <table>` for affected tables
- [ ] Confirm RLS policies are intact after schema changes: `SELECT * FROM pg_policies;`

---

## Step 4: Application Rollback (Docker Image Tag)

```bash
# Set the rollback image tag in the environment or compose override
export KERNEL_IMAGE_TAG="<rollback-sha>"
export CONSOLE_IMAGE_TAG="<rollback-sha>"

# Apply the rollback
docker compose pull
docker compose up -d

# Verify
sleep 10
curl -sf http://localhost:3141/health && echo "Health OK"
```

- [ ] Application starts without errors
- [ ] `GET /health` returns `{"status":"ok","db":"ok"}`
- [ ] WebSocket port 3142 accepts connections
- [ ] A basic API call succeeds (e.g., `GET /projects`)

---

## Step 5: Hermes Disable Procedure

If Hermes is running and needs to be disabled during rollback:

1. Set `OSCORPEX_ENABLE_HERMES=false` in the environment
2. Restart the backend container: `docker compose restart backend`
3. Confirm no Hermes routes respond: `curl -s http://localhost:3141/hermes/status` should return 404 or disabled message

- [ ] `OSCORPEX_ENABLE_HERMES` set to `false`
- [ ] Backend restarted
- [ ] Hermes routes inactive
- [ ] Verify no in-flight Hermes sessions were interrupted abruptly (check `agent_sessions` table for stuck sessions)

```sql
-- Check for stuck Hermes sessions
SELECT id, status, started_at FROM agent_sessions
WHERE status = 'running'
  AND started_at < NOW() - INTERVAL '10 minutes'
ORDER BY started_at DESC;
```

---

## Step 6: Gateway Disable Procedure

1. Set `OSCORPEX_ENABLE_GATEWAY=false`
2. Restart backend
3. Confirm gateway routes inactive

- [ ] `OSCORPEX_ENABLE_GATEWAY` set to `false`
- [ ] Backend restarted
- [ ] Gateway routes return 404 / disabled
- [ ] Confirm no pending gateway operations in progress

---

## Step 7: Scheduler Pause Procedure

1. Set `OSCORPEX_ENABLE_SCHEDULER=false`
2. Restart backend
3. Any in-flight scheduled tasks will be picked up on the next scheduler start (tasks are DB-persisted)

- [ ] `OSCORPEX_ENABLE_SCHEDULER` set to `false`
- [ ] Backend restarted
- [ ] No new scheduled tasks are dispatched
- [ ] In-flight tasks complete or are left in `pending` state for next run

```sql
-- Check tasks left pending by scheduler shutdown
SELECT COUNT(*) FROM tasks WHERE status = 'pending';
```

---

## Step 8: Post-Rollback Verification

- [ ] `GET /health` returns 200
- [ ] `GET /telemetry/performance/baseline` returns 200
- [ ] Create a test project and run a minimal pipeline to confirm end-to-end flow
- [ ] Monitor error rate in logs for 15 minutes: `docker compose logs backend -f | grep '"level":50'`
- [ ] Confirm no RLS violations in logs: `grep "tenant_id" logs/` or Pino structured log search
- [ ] Update the communication channel with rollback outcome

---

## Step 9: Post-Rollback Documentation

- [ ] Record the incident in the incident log (`docs/production/hermes-incident-response-playbook.md` template)
- [ ] File a ticket for root cause analysis
- [ ] Document any manual DB steps taken
- [ ] Schedule a retrospective within 48 hours

---

## Drill Run Log

| Date | Operator | Trigger | Rollback SHA | Duration (min) | Outcome | Notes |
|------|----------|---------|--------------|----------------|---------|-------|
| | | Drill | | | | First drill |

---

## References

- `docs/production/backup-restore-drill-checklist.md` — data restore procedure
- `docs/production/staging-environment-definition.md` — isolated test environment
- `docs/production/hermes-incident-response-playbook.md` — incident response
- `apps/kernel/scripts/init.sql` — schema source of truth
