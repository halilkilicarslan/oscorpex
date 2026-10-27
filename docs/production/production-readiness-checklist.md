# Production Readiness Checklist

Version: 1.0 — 2026-05-14
Scope: Oscorpex Kernel (apps/kernel) and Console (apps/console)

---

## 1. Authentication and Authorization

- [ ] JWT_SECRET is set via environment variable (minimum 32 bytes, generated with `openssl rand -base64 32`)
- [ ] JWT expiry is configured to a sensible value (recommended: 1h access, 7d refresh)
- [ ] All kernel routes protected by auth middleware except explicitly public endpoints
- [ ] Route permissions table reviewed — no unintended public routes
- [ ] MCP endpoints require authenticated context (tenantId, actorId)
- [ ] Approval apply endpoint (`POST /mcp/write/apply`) validates approvalId is not replayable
- [ ] Role-based access: admin-only routes enforce `requireRole("admin")` middleware

## 2. Row-Level Security (RLS)

- [ ] RLS enabled on all multi-tenant tables (projects, tasks, phases, events, approvals, etc.)
- [ ] Direct `tenant_id` columns on tasks, phases, project_plans (no subquery RLS)
- [ ] RLS policies verified with `SELECT * FROM pg_policies` — no gaps
- [ ] DB connection pool does NOT share connections across tenants without resetting session variables
- [ ] Superuser connections (for migrations) are separate from application connections

## 3. Rate Limiting

- [ ] MCP endpoints: 100 req/min per IP (`rateLimiter({ windowMs: 60_000, max: 100 })`)
- [ ] Auth endpoints: stricter limit (10 req/min) to prevent brute-force
- [ ] WebSocket connections: per-tenant connection limit enforced
- [ ] API endpoints: global fallback rate limit applied
- [ ] Rate limit store uses Redis or PostgreSQL (not in-memory) in production

## 4. Docker Socket Security

- [ ] Docker socket (`/var/run/docker.sock`) is NOT mounted directly into the kernel container
- [ ] Container execution uses DinD sidecar or rootless Docker (see `docs/architecture/container-runtime-isolation-decision.md`)
- [ ] Container images are pinned to digests, not mutable tags
- [ ] Resource limits (CPU, memory) set on all spawned containers
- [ ] Network isolation: spawned containers run on an isolated network, no host networking

## 5. Environment Variable Sanitization

- [ ] No secrets committed to source control (`.env` is in `.gitignore`)
- [ ] `OSCORPEX_ENABLE_MCP_WRITE_TOOLS` is `false` or unset by default in production
- [ ] `OSCORPEX_ALLOW_MCP_WRITE_IN_PROD` requires explicit opt-in with documented justification
- [ ] Database URL uses a least-privilege application user (not superuser)
- [ ] `NODE_ENV=production` is set — enables production guards in write-tool-registry and policy enforcer
- [ ] All secrets provided via secret manager (e.g., Vault, AWS SSM) — not plain env files
- [ ] `install-scripts` guard active: `--ignore-scripts` appended to npm/pnpm/yarn install

## 6. MCP Tool Policy

- [ ] `OSCORPEX_ENABLE_MCP_WRITE_TOOLS` is explicitly `false` in production (default) unless write tools are needed
- [ ] Tool policy enforcer (`tool-policy-enforcer.ts`) is wired to all MCP invocation paths
- [ ] Write tool approval flow uses non-replayable approval IDs (server-generated UUIDs)
- [ ] Secret guard (`secret-guard.ts`) is called on all write payloads
- [ ] MCP audit log (`mcp-audit.ts`) is writing to persistent storage, not just stdout
- [ ] `POST /mcp/write/apply` checks `approvalId` against a persistent approvals table before executing
- [ ] Approval IDs are single-use and expire after a configured TTL (recommended: 10 minutes)

## 7. Checkpoint System

- [ ] Checkpoint creation is non-optional for all write operations
- [ ] Checkpoints are stored in PostgreSQL, not only in memory
- [ ] Checkpoint rollback tested for at least one tool (file.write)
- [ ] Checkpoint cleanup job runs periodically to prevent unbounded growth
- [ ] Checkpoint metadata includes enough context for audit reconstruction

## 8. Coverage Thresholds

- [ ] Lines: 55% (set in vitest.config.ts — P7-I)
- [ ] Functions: 55%
- [ ] Branches: 50%
- [ ] Statements: 55%
- [ ] CI pipeline fails the build if any threshold is breached
- [ ] Coverage report archived as CI artifact for trend tracking

## 9. CI/CD Pipeline

- [ ] `pnpm typecheck` runs on every PR (tsc --noEmit)
- [ ] `pnpm lint` runs on every PR (Biome check)
- [ ] `pnpm test` runs on every PR (vitest with DB)
- [ ] Coverage gates enforced in CI (vitest --coverage)
- [ ] Dependency audit runs on schedule (`pnpm audit`)
- [ ] Docker image built and scanned (Trivy or Grype) before deployment
- [ ] Secrets scanning in CI (gitleaks or detect-secrets)
- [ ] Branch protection rules: require PR review + status checks before merge to master

## 10. Monitoring and Observability

- [ ] `GET /health` returns 200 with DB connectivity status
- [ ] `GET /telemetry/performance/baseline` is accessible to monitoring systems
- [ ] `GET /mcp/metrics` is scraped by Prometheus or equivalent
- [ ] Pino log output is JSON and shipped to a log aggregator (Loki, Datadog, CloudWatch)
- [ ] Structured error logs include `err.message`, `err.stack`, and context fields
- [ ] Alert on: task failure rate > 20%, pipeline stall > 30 min, budget circuit breaker trip
- [ ] Distributed tracing configured (OpenTelemetry) for cross-service request correlation
- [ ] WebSocket connection count monitored (port 3142)

## 11. Database

- [ ] PostgreSQL version pinned (recommended: 16.x)
- [ ] Connection pool size tuned: `max = 20`, `idleTimeoutMillis = 30000`
- [ ] `init.sql` applied idempotently on startup (`CREATE TABLE IF NOT EXISTS` pattern)
- [ ] Migrations tested on a staging DB before production apply
- [ ] Automated daily backups with point-in-time recovery enabled
- [ ] Backup restore tested quarterly
- [ ] Slow query logging enabled (`log_min_duration_statement = 1000ms`)
- [ ] Index coverage verified for hot query paths (tasks by project, events by type+project)

## 12. Deployment

- [ ] HTTP server binds to `127.0.0.1` in development, `0.0.0.0` only behind a reverse proxy in production
- [ ] TLS termination at reverse proxy (nginx or Caddy) — kernel never handles raw TLS
- [ ] CORS origins restricted to known console domain(s)
- [ ] Graceful shutdown: in-flight requests complete before process exit
- [ ] Health check endpoint verified by orchestrator (Kubernetes readiness probe or ECS health check)
- [ ] Rolling deployment configured — zero-downtime deploys
- [ ] Reserved ports documented: 5161 (Console), 4242 (preview), 3141 (Kernel), 3142 (WebSocket)

## 13. Security Headers

- [ ] `Content-Security-Policy` set on console frontend
- [ ] `X-Frame-Options: DENY` set
- [ ] `X-Content-Type-Options: nosniff` set
- [ ] `Referrer-Policy: strict-origin-when-cross-origin` set
- [ ] HSTS header set with `max-age >= 31536000`
- [ ] Webhook URL validation: `resolveAndValidateUrl()` performs DNS resolution before private IP check

---

## Sign-off

| Area | Owner | Status | Date |
|------|-------|--------|------|
| Auth/Authorization | | | |
| RLS | | | |
| Rate Limiting | | | |
| Container Security | | | |
| MCP Policy | | | |
| CI/CD | | | |
| Monitoring | | | |
| Database | | | |
| Deployment | | | |
