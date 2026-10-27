# Backup / Restore Drill Checklist

Version: 1.0 — 2026-05-14
Scope: Oscorpex RC1 — PostgreSQL + Application State
Frequency: Quarterly (minimum), or before each major release

---

## Overview

This checklist guides the operator through a complete backup-and-restore drill in an isolated environment. The drill must be completed successfully before RC1 production deployment.

**Recovery Time Objective (RTO)**: 60 minutes from incident declaration to restored service
**Recovery Point Objective (RPO)**: 24 hours (daily backup schedule)

---

## Pre-Drill Preparation

- [ ] Identify the isolated restore environment (Docker Compose on a separate host, or a staging DB instance with a different DSN)
- [ ] Confirm the restore environment has no network path to production
- [ ] Confirm `pg_dump` and `psql` versions match the production PostgreSQL version (16.x)
- [ ] Gather credentials for the backup storage location (S3 bucket, NFS share, etc.)
- [ ] Notify the team that a drill is in progress (use the communication template in `rollback-drill-checklist.md`)

---

## Step 1: PostgreSQL Backup (pg_dump)

```bash
# Run from a host with psql client access to production DB
# Replace DSN and output path as appropriate

TIMESTAMP=$(date -u '+%Y%m%dT%H%M%SZ')
BACKUP_FILE="oscorpex-db-${TIMESTAMP}.pgdump"

pg_dump \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  "$DATABASE_URL" \
  --file="$BACKUP_FILE"

echo "Backup written to: $BACKUP_FILE"
ls -lh "$BACKUP_FILE"
```

- [ ] `pg_dump` exits 0
- [ ] Backup file size is non-zero and plausible (check against prior backups)
- [ ] Backup file is transferred to backup storage with checksum verification (`sha256sum`)
- [ ] Backup labeled with timestamp and Git commit SHA (`git rev-parse HEAD`)

---

## Step 2: Checkpoint Data Backup

MCP write-tool checkpoints are stored in the `mcp_checkpoints` table. These are included in the `pg_dump` above, but verify separately:

```sql
SELECT COUNT(*) FROM mcp_checkpoints;
SELECT MAX(created_at) FROM mcp_checkpoints;
```

- [ ] `mcp_checkpoints` table is present in the backup
- [ ] Row count matches production (verify with `\dt+ mcp_checkpoints` before and after restore)

---

## Step 3: Configuration Backup

Application configuration is managed via environment variables. Back up the non-secret configuration manifest:

```bash
# Export environment variable names (no values) as documentation
printenv | grep '^OSCORPEX_' | cut -d= -f1 | sort > oscorpex-env-keys-${TIMESTAMP}.txt
```

- [ ] Environment variable key list saved alongside the DB backup
- [ ] Secret values are stored in the secret manager (Vault / AWS SSM) — verify the snapshot exists
- [ ] `docker-compose.yml` and `apps/kernel/scripts/init.sql` are committed to Git (source of truth)

---

## Step 4: Test Restore in Isolated Environment

```bash
# Create a clean restore target database
createdb -U oscorpex oscorpex_restore_drill

# Restore the backup
pg_restore \
  --format=custom \
  --no-owner \
  --no-acl \
  --dbname="postgresql://oscorpex:oscorpex_dev@localhost:5432/oscorpex_restore_drill" \
  "$BACKUP_FILE"

echo "Restore exit code: $?"
```

- [ ] `pg_restore` exits 0
- [ ] No errors printed to stderr (warnings about superuser roles are acceptable)
- [ ] All 85 tables present in the restored database:

```sql
SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
-- Expected: 85
```

---

## Step 5: Data Integrity Verification

Run the following queries on the **restored** database and compare counts against a snapshot taken from production just before the backup:

```sql
-- Core entity counts
SELECT 'projects'   AS tbl, COUNT(*) FROM projects
UNION ALL
SELECT 'tasks',              COUNT(*) FROM tasks
UNION ALL
SELECT 'phases',             COUNT(*) FROM phases
UNION ALL
SELECT 'events',             COUNT(*) FROM events
UNION ALL
SELECT 'mcp_checkpoints',    COUNT(*) FROM mcp_checkpoints
UNION ALL
SELECT 'approvals',          COUNT(*) FROM approvals
UNION ALL
SELECT 'audit_events',       COUNT(*) FROM audit_events;
```

- [ ] Row counts match production snapshot (within RPO window tolerance)
- [ ] RLS policies present: `SELECT COUNT(*) FROM pg_policies;` — count matches production
- [ ] FORCE RLS active: `SELECT tablename FROM pg_tables WHERE rowsecurity = true;`
- [ ] No `tenant_id IS NULL` rows exist in multi-tenant tables

---

## Step 6: Application Smoke Test Against Restored DB

Start the kernel against the restored database in the isolated environment:

```bash
DATABASE_URL="postgresql://oscorpex:oscorpex_dev@localhost:5432/oscorpex_restore_drill" \
NODE_ENV=staging \
OSCORPEX_DEV_NO_AUTH=true \
  node apps/kernel/dist/index.js &

sleep 5
curl -s http://localhost:3141/health | jq .
```

- [ ] `GET /health` returns `200` with `{"status":"ok"}`
- [ ] `GET /telemetry/performance/baseline` returns 200
- [ ] A test project can be created via `POST /projects`
- [ ] Shut down the test kernel process after verification

---

## Step 7: Recovery Time Measurement

- [ ] Record the **drill start time** (when backup file was identified / incident declared)
- [ ] Record the **service restored time** (when smoke test passed)
- [ ] Calculate elapsed time: must be under 60 minutes (RTO)
- [ ] If RTO is breached, file an improvement ticket before the next drill

---

## Step 8: Cleanup

```bash
dropdb -U oscorpex oscorpex_restore_drill
rm -f "$BACKUP_FILE"
```

- [ ] Restore database dropped
- [ ] Backup file deleted from local disk (primary copy remains in backup storage)
- [ ] Drill result documented in the team run-log

---

## Drill Run Log

| Date | Operator | Backup File | Restore OK | RTO (min) | Notes |
|------|----------|-------------|------------|-----------|-------|
| | | | | | First drill |

---

## RTO / RPO Summary

| Metric | Target | Measured |
|--------|--------|----------|
| RTO | 60 min | (fill after drill) |
| RPO | 24 h | Daily pg_dump |

---

## References

- PostgreSQL backup docs: https://www.postgresql.org/docs/16/backup-dump.html
- `apps/kernel/scripts/init.sql` — schema source of truth
- `docs/production/rollback-drill-checklist.md` — application rollback procedure
- `docs/production/staging-environment-definition.md` — isolated restore environment spec
