# RC1 Security Review Checklist

Version: 1.0 — 2026-05-14
Scope: Oscorpex RC1 — All P0-P13 Security Protections
Reviewer: (fill in)
Review Date: (fill in)

---

## How to Use This Checklist

Each item must be marked one of:
- `[x]` — Verified and passing
- `[ ]` — Not yet verified
- `[!]` — Verified but has an open issue (link the ticket)
- `[N/A]` — Not applicable with justification

All items in the P0 section must be `[x]` before RC1 can be approved for production deployment.
Items in P1-P13 must be `[x]` or `[N/A]` with documented justification.

---

## P0: Critical Security — RCE, Auth, and RLS

These are hard blockers. Zero exceptions.

### RCE Vectors

- [ ] Command injection vectors identified in code review are closed (sandboxManager path checks active)
- [ ] `resolveAndValidateUrl()` performs DNS resolution before private IP check (SSRF protection)
- [ ] `--ignore-scripts` is appended to all npm/pnpm/yarn install commands
- [ ] No user-supplied input is interpolated directly into shell command strings
- [ ] `realpathSync()` is used before scope checks to resolve symlinks (symlink escape protection)
- [ ] `checkInjectionLimits()` is called before `proposeTask()` (injection quota enforcement)

### Authentication Hardening

- [ ] JWT secret is set via `OSCORPEX_JWT_SECRET` (minimum 32 bytes)
- [ ] `OSCORPEX_DEV_NO_AUTH` is `false` or unset in production
- [ ] All kernel routes have auth middleware except explicitly whitelisted public endpoints
- [ ] Route permissions table reviewed — no unintended public routes
- [ ] Admin-only routes enforce `requireRole("admin")`
- [ ] MCP endpoints require authenticated `tenantId` and `actorId`
- [ ] Approval IDs are server-generated UUIDs (not replayable)

### RLS (Row-Level Security)

- [ ] RLS enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) on all multi-tenant tables
- [ ] FORCE RLS applied (`ALTER TABLE ... FORCE ROW LEVEL SECURITY`) on all multi-tenant tables
- [ ] Direct `tenant_id` columns on tasks, phases, project_plans (no subquery RLS)
- [ ] No `tenant_id IS NULL OR tenant_id =` escape patterns in `init.sql`
- [ ] `SELECT * FROM pg_policies` shows policies on all expected tables
- [ ] DB connection pool does not share connections across tenants without session reset
- [ ] Superuser connections (for migrations) are separate from application connections

---

## P1: Infrastructure Hardening

### Docker Socket

- [ ] Docker socket (`/var/run/docker.sock`) is NOT mounted into the kernel container in production
- [ ] `docker-compose.yml` default config has no uncommented `docker.sock` volume
- [ ] Container images are pinned to digests or locked SHAs (not mutable `latest` tags)
- [ ] Spawned containers have CPU and memory resource limits configured
- [ ] Spawned containers run on an isolated network (no host networking)

### Rate Limiting

- [ ] MCP endpoints: 100 req/min per IP rate limiting active
- [ ] Auth endpoints: stricter rate limit (10 req/min) to prevent brute-force
- [ ] `rateLimiter` is wired in `routes/index.ts`
- [ ] Rate limit store uses persistent backend (Redis or PostgreSQL) in production — not in-memory

---

## P2: Tool Policy and Environment Sanitization

### Tool Policy Enforcement

- [ ] `tool-policy-enforcer.ts` is wired to all MCP invocation paths
- [ ] `OSCORPEX_ENABLE_MCP_WRITE_TOOLS` is `false` or unset by default in production
- [ ] Write tool approval flow is non-replayable (server-generated UUIDs, single-use)
- [ ] `secret-guard.ts` is called on all write payloads (25+ detection patterns verified)
- [ ] `POST /mcp/write/apply` validates `approvalId` against the persistent approvals table
- [ ] Approval IDs expire after configured TTL (recommended: 10 minutes)

### Environment Sanitization

- [ ] No secrets committed to source control (`.env` in `.gitignore`, verified via `git ls-files`)
- [ ] `NODE_ENV=production` set — enables production guards in write-tool-registry and policy enforcer
- [ ] All secrets provided via secret manager — not plain env files
- [ ] MCP write tool production guard: `OSCORPEX_ENABLE_MCP_WRITE_TOOLS=false` validated in preflight

---

## P3: Checkpoint Service

- [ ] Checkpoint creation is non-optional for all MCP write operations
- [ ] Checkpoints stored in PostgreSQL `mcp_checkpoints` table (not only in memory)
- [ ] Checkpoint table exists in schema: `SELECT to_regclass('public.mcp_checkpoints')` returns non-null
- [ ] Checkpoint rollback tested for at least one write tool (e.g., `file.write`)
- [ ] Checkpoint cleanup job configured to prevent unbounded table growth
- [ ] Checkpoint metadata includes: `tenantId`, `actorId`, `toolName`, `operation`, `timestamp`

---

## P4 + P5: MCP Read-Only Stability

- [ ] MCP read-only endpoints (`GET /mcp/*`) return correct data without side effects
- [ ] Read-only operation audit confirms no writes occur during read-path execution
- [ ] MCP audit log (`mcp-audit.ts`) writes to persistent storage (not only stdout)
- [ ] MCP metrics endpoint (`GET /mcp/metrics`) is operational and scraped by monitoring

---

## P6: Write Tools Approval Gate

- [ ] All write tool invocations go through the approval flow before execution
- [ ] Approval gate cannot be bypassed by crafting a direct internal API call
- [ ] Approval IDs are single-use: second use of the same ID returns 409 Conflict
- [ ] Write operations are logged to audit table with approval reference

---

## P9: Git Commit Control

- [ ] Git commit operations are controlled and require explicit user approval
- [ ] No autonomous git push to production branches without human sign-off
- [ ] Agent git operations are sandboxed to the project working directory
- [ ] `graph-coordinator.ts`: `validateAddEdge()` called before every `addEdge` (cycle detection)

---

## P10: Scheduler Read-Only Mode

- [ ] Scheduler operates in read-only mode by default (`OSCORPEX_ENABLE_SCHEDULER` opt-in)
- [ ] Secret guard active: 25+ detection patterns validated in `secret-guard.ts`
- [ ] Scheduler does not perform write operations without explicit configuration
- [ ] Scheduler can be paused immediately via environment variable change + restart

---

## P11: Gateway Read-Only Mode

- [ ] Gateway operates in read-only mode by default
- [ ] `OSCORPEX_ENABLE_GATEWAY` requires explicit opt-in
- [ ] Gateway routes return 404 or a disabled message when `OSCORPEX_ENABLE_GATEWAY=false`
- [ ] Gateway read operations do not expose cross-tenant data

---

## P12: Hermes Read-Only Mode and Prompt Injection Guard

- [ ] Hermes operates in read-only mode by default
- [ ] `OSCORPEX_ENABLE_HERMES` requires explicit opt-in
- [ ] Prompt injection guard active: `detectPromptInjection()` with 23 regex patterns
- [ ] `validatePatternContent()` and `sanitizeForPrompt()` called on all learning pattern content
- [ ] Hermes session budget configured conservatively (`OSCORPEX_HERMES_SESSION_BUDGET <= 50`)
- [ ] Hermes incident response playbook reviewed: `docs/production/hermes-incident-response-playbook.md`

---

## P13: Red-Team Tests and Coverage Gate

- [ ] Red-team test suite (`vitest.p13.config.ts`) passes with zero failures
- [ ] Hermes and Gateway module coverage meets 80% threshold (lines, functions, statements)
- [ ] Branches coverage meets 75% threshold
- [ ] Coverage threshold configured in `vitest.p13.config.ts` and enforced in CI
- [ ] All P0-P12 test suites run in CI without `continue-on-error`
- [ ] Full regression script (`scripts/run-full-regression.sh`) exits 0

---

## Additional Security Items

### Secret Guard Verification

- [ ] `secret-guard.ts` contains 25 or more detection patterns
- [ ] Patterns cover: API keys, JWT tokens, private keys, passwords, connection strings, OAuth tokens
- [ ] Secret guard is called before any MCP write operation is applied
- [ ] False positive rate is acceptable (verified against test fixtures)

### Prompt Injection Guard

- [ ] `learning-governance.ts` `detectPromptInjection()` active with 23 regex patterns
- [ ] Injected patterns are logged and rejected — not silently dropped
- [ ] Test coverage for injection detection: all 23 patterns have corresponding test cases

### Monitoring and Alerting

- [ ] `GET /health` returns 200 with DB connectivity
- [ ] `GET /telemetry/performance/baseline` accessible to monitoring
- [ ] `GET /mcp/metrics` scraped by Prometheus or equivalent
- [ ] Alert configured: task failure rate > 20%
- [ ] Alert configured: pipeline stall > 30 minutes
- [ ] Alert configured: budget circuit breaker trip

---

## Staging Validation

- [ ] All checks above verified in staging environment before production deploy
- [ ] `scripts/tenant-isolation-smoke.sh` exits 0
- [ ] `scripts/production-preflight.sh` passes (with `NODE_ENV=production` env)
- [ ] Backup restore drill completed successfully (`docs/production/backup-restore-drill-checklist.md`)
- [ ] Rollback drill completed successfully (`docs/production/rollback-drill-checklist.md`)
- [ ] Soak test: Hermes + Gateway + Scheduler run for minimum 2 hours in staging without incident

---

## Production Preflight

- [ ] `scripts/production-preflight.sh` passes with `NODE_ENV=production` and real secrets
- [ ] Zero `[FAIL]` results in preflight output
- [ ] All `[WARN]` results reviewed and accepted or resolved
- [ ] Preflight output saved as a release artifact

---

## Sign-Off

All P0 items must be `[x]` before signing. P1-P13 items must be `[x]` or `[N/A]`.

| Section | Reviewer | Status | Date | Notes |
|---------|----------|--------|------|-------|
| P0: RCE | | | | |
| P0: Auth | | | | |
| P0: RLS | | | | |
| P1: Docker + Rate Limiting | | | | |
| P2: Tool Policy + Env | | | | |
| P3: Checkpoint | | | | |
| P4+P5: MCP Read-Only | | | | |
| P6: Write Approval Gate | | | | |
| P9: Git Control | | | | |
| P10: Scheduler | | | | |
| P11: Gateway | | | | |
| P12: Hermes + Prompt Injection | | | | |
| P13: Red-Team + Coverage | | | | |
| Staging Validation | | | | |
| Production Preflight | | | | |

**Final RC1 Security Review Decision**: [ ] APPROVED / [ ] BLOCKED

Approved by: ___________________________  Date: ___________
