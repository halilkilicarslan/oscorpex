# Oscorpex — Operational Readiness Checklist

This document defines the minimum checks required before deploying Oscorpex to a new environment (dev, staging, or production).

## Pre-Deployment

### Infrastructure
- [ ] PostgreSQL 15+ is running and accessible
- [ ] Database `oscorpex` exists with correct credentials
- [ ] `scripts/init.sql` has been applied (idempotent — safe to re-run)
- [ ] Docker daemon is available (for container pool warm-up)
- [ ] Node.js 20+ and pnpm are installed
- [ ] Environment variables are configured:
  - [ ] `DATABASE_URL` or `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`
  - [ ] `PORT` (default: 3141)
  - [ ] `OSCORPEX_API_KEY` (optional but recommended for production)
  - [ ] `OSCORPEX_AUTH_ENABLED=true` (for tenant-aware auth)
  - [ ] `OSCORPEX_CORS_ORIGINS` (comma-separated allowed origins)

### Build
- [ ] `pnpm install` completes without lockfile conflicts
- [ ] `pnpm typecheck` passes (0 errors across all workspaces)
- [ ] `pnpm build` succeeds for `@oscorpex/kernel` and `@oscorpex/core`

## Deployment

### Boot Sequence
- [ ] `pnpm --filter @oscorpex/kernel dev` (or `node dist/index.js`) starts without fatal errors
- [ ] DB bootstrap logs "DB schema bootstrap complete"
- [ ] WebSocket server logs "WebSocket server started" (port 3142)
- [ ] Provider registry logs "Provider registry initialized with N adapters" (N >= 1)
- [ ] HTTP server logs "HTTP server ready — http://0.0.0.0:3141"

### Health Checks
- [ ] `GET /health` returns `200` with `{ status: "ok", mode: "kernel" }`
- [ ] `GET /api/studio/projects` returns `200` or `401` (depending on auth config)
- [ ] WebSocket port 3142 accepts connections

### Smoke Tests
- [ ] `pnpm --filter @oscorpex/kernel test` passes (all test files)
- [ ] Replay route smoke: `GET /replay/runs/test/snapshots` returns JSON
- [ ] Provider registry smoke: at least 1 adapter is registered after boot

## Post-Deployment

### Observability
- [ ] Logs are structured JSON (Pino format)
- [ ] Log level is appropriate for environment (`info` for prod, `debug` for dev)
- [ ] No unhandled rejections or exceptions in first 5 minutes

### Critical Paths
- [ ] Project creation works: `POST /api/studio/projects`
- [ ] Task creation works: `POST /api/studio/tasks`
- [ ] Pipeline start works: `POST /api/studio/projects/:id/pipeline/start`
- [ ] Budget guard does not block legitimate requests (if configured)

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "DB schema bootstrap" never logs | PostgreSQL unreachable | Check `DATABASE_URL` and network |
| "Provider registry initialized with 0 adapters" | Adapter constructors failed | Check `cli-adapter.ts` or provider binaries |
| `/health` 404 | Routes not mounted | Check `boot.ts` phase order |
| Port 3141 already in use | Another process listening | Kill existing process or change `PORT` env |
| WebSocket connection refused | Firewall or wrong port | Check port 3142 is open |
| `pnpm test` fails with pool-end error | Shared DB between tests | Tests run serialized by design; retry |
