# Oscorpex — Release Checklist

Combined operational readiness, smoke test, and rollback procedures.

---

## Pre-Release

### 1. Code Quality
- [ ] `pnpm typecheck` passes (0 errors across all workspaces)
- [ ] `pnpm build` succeeds for `@oscorpex/kernel` and `@oscorpex/core`
- [ ] `pnpm --filter @oscorpex/kernel test` passes (all test files green)
- [ ] No unhandled rejections in test output
- [ ] Lint passes: `pnpm --filter @oscorpex/kernel lint`

### 2. Documentation
- [ ] `docs/kernel-boundary.md` is up to date
- [ ] `docs/route-security-audit.md` reflects current routes
- [ ] `docs/operational-readiness.md` reflects current infra requirements
- [ ] `CHANGELOG.md` updated with release notes

### 3. Version
- [ ] `apps/kernel/package.json` version bumped
- [ ] `packages/core/package.json` version bumped (if changed)
- [ ] Git tag created: `git tag -a vX.Y.Z -m "Release X.Y.Z"`

---

## Release Deployment

### 4. Infrastructure
- [ ] PostgreSQL is running and reachable
- [ ] Database migrations applied (`scripts/init.sql`)
- [ ] Environment variables configured:
  - [ ] `DATABASE_URL`
  - [ ] `PORT` (default 3141)
  - [ ] `OSCORPEX_API_KEY` (production)
  - [ ] `OSCORPEX_AUTH_ENABLED=true` (production)
  - [ ] `OSCORPEX_CORS_ORIGINS`

### 5. Boot Smoke
- [ ] Kernel starts without fatal errors
- [ ] DB bootstrap logs success
- [ ] Provider registry logs "initialized with N adapters" (N >= 1)
- [ ] HTTP server ready on expected port
- [ ] WebSocket server ready on port 3142

### 6. Health Checks
- [ ] `GET /health` → `200 { status: "ok", mode: "kernel" }`
- [ ] `GET /api/studio/projects` → `200` or `401` (auth dependent)
- [ ] Response headers include `x-correlation-id`

### 7. Critical Path Smoke
- [ ] Project creation: `POST /api/studio/projects` → `201`
- [ ] Task creation: `POST /api/studio/tasks` → `201`
- [ ] Pipeline start: `POST /api/studio/projects/:id/pipeline/start` → `200`
- [ ] Replay list: `GET /api/studio/replay/runs/:runId/snapshots` → `200`
- [ ] Provider registry: at least 1 adapter registered

---

## Post-Release

### 8. Observability
- [ ] Logs are structured JSON (Pino format)
- [ ] No ERROR or FATAL logs in first 5 minutes
- [ ] Correlation IDs present on all request logs
- [ ] WebSocket connections accept `correlationId` query param

### 9. Monitoring
- [ ] Container memory usage stable
- [ ] DB connection pool not exhausted
- [ ] No unhandled rejections or exceptions

---

## Rollback

### Triggers
- Boot fails with fatal error
- Health check fails for >30 seconds
- Error rate >5% in first 10 minutes
- Database connection pool exhaustion

### Procedure
1. Stop new kernel process
2. Revert to previous Docker image / binary
3. Restore previous database schema (if migration was applied)
4. Verify health endpoint
5. Notify team via webhook

### Rollback Checklist
- [ ] Previous version binary/image available
- [ ] Database backup from pre-release
- [ ] Previous environment variables documented
- [ ] Rollback tested in staging

---

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Release Owner | | | |
| QA Lead | | | |
| Security Review | | | |
| Operations | | | |
