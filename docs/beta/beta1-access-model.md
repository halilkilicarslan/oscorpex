# Beta-1: Access Model

**Version**: Beta-1.0
**Date**: 2026-05-14
**Status**: Operational

---

## 1. Overview

Beta-1 uses a multi-layer access model combining API key authentication, role-based
access control (RBAC), per-endpoint rate limits, session budgets, full audit logging,
and strict data isolation via PostgreSQL Row Level Security (RLS).

No anonymous access is permitted in any environment. All requests must carry a valid
JWT Bearer token derived from a tenant-scoped API key.

---

## 2. Authentication

### 2.1 API Key Per Tenant

Each Beta-1 tenant receives exactly one API key scoped to their tenant ID. The key:

- Is generated server-side with `node:crypto.randomUUID()`
- Hashed with SHA-256 before storage (raw key is never stored)
- Has a maximum lifetime of 30 days (configurable, shorter is preferred)
- Can be revoked instantly via `src/scripts/revoke-api-key.ts`
- Carries a fixed scope set (no dynamic scope elevation)

API keys are exchanged for short-lived JWT access tokens (1 hour expiry) via the
`POST /api/auth/token` endpoint. Refresh tokens expire after 7 days.

### 2.2 Token Validation

Every authenticated route validates:
1. JWT signature (HMAC-SHA256 with `JWT_SECRET`)
2. Token expiry (`exp` claim)
3. Tenant ID claim matches the resource being accessed
4. Token not in the revocation list (checked against DB)

A failed validation returns HTTP 401. No information about the failure reason is
returned to the client (prevents oracle attacks).

---

## 3. Role-Based Access Control (RBAC)

### 3.1 Beta-1 Roles

| Role | Description | Allowed Actions |
|------|-------------|----------------|
| `owner` | Full read access + approval submission | Read all resources, submit approvals, view audit log |
| `developer` | Standard read access + project creation | Read projects/tasks/agents, create projects, trigger pipelines |
| `viewer` | Read-only access | Read projects, tasks, agent sessions, pipeline status |

### 3.2 Role Assignment

Roles are assigned at tenant onboarding and stored in the `tenant_members` table.
A tenant may have multiple users, each with their own role. Role changes require
admin approval and are logged in the audit event stream.

### 3.3 Permission Matrix

| Resource | viewer | developer | owner |
|----------|--------|-----------|-------|
| `GET /projects` | yes | yes | yes |
| `POST /projects` | no | yes | yes |
| `GET /projects/:id/tasks` | yes | yes | yes |
| `GET /agents` | yes | yes | yes |
| `GET /agent-sessions` | yes | yes | yes |
| `POST /approvals/:id/approve` | no | no | yes |
| `GET /audit-events` | no | no | yes |
| `GET /skills` | yes | yes | yes |
| `POST /skills` | no | no | yes |
| `GET /telemetry/performance/baseline` | no | yes | yes |
| `POST /terminal/exec` | no | no | no (disabled) |
| `POST /mcp/write/*` | no | no | no (disabled) |

---

## 4. Rate Limits

### 4.1 Per-Endpoint Limits

All rate limits are applied per API key (not per IP) using a sliding window counter
backed by the in-process rate limiter.

| Endpoint Group | Limit | Window | Burst Allowed |
|---------------|-------|--------|--------------|
| Hermes sessions (`/hermes/*`) | 20 requests | 1 minute | No |
| Gateway requests (`/gateway/*`) | 60 requests | 1 minute | No |
| General API (`/api/studio/*`) | 200 requests | 1 minute | Yes (up to 250) |
| Authentication (`/api/auth/*`) | 10 requests | 1 minute | No |
| Project creation (`POST /projects`) | 5 requests | 1 minute | No |
| Approval submission | 30 requests | 1 minute | No |

### 4.2 Rate Limit Response

When a rate limit is exceeded, the API returns:

```json
{
  "error": "rate_limit_exceeded",
  "retry_after_seconds": 42,
  "limit": 20,
  "window": "1m"
}
```

HTTP status: 429. The `Retry-After` header is also set.

### 4.3 Rate Limit Monitoring

Rate limit hits are emitted as structured log events at `WARN` level:

```json
{
  "level": "warn",
  "module": "rate-limiter",
  "tenant_id": "...",
  "endpoint": "/hermes/session",
  "limit": 20,
  "hits": 21,
  "msg": "rate limit exceeded"
}
```

A Grafana alert fires if any single tenant exceeds their rate limit more than
50 times in a 10-minute window (indicates misuse or runaway client).

---

## 5. Session Budget

### 5.1 Hermes Session Budget

Each Hermes session has a hard budget of **50 tool calls per session**. This prevents
runaway agent loops from consuming excessive resources.

When the budget is exhausted:
- The session is terminated gracefully
- The agent receives a `session_budget_exceeded` error
- The event is logged with tenant ID, session ID, and tool call count

### 5.2 Budget Tracking

Budgets are tracked in-memory per session and persisted to the `agent_sessions` table
at session completion. There is no cross-session budget pooling in Beta-1.

---

## 6. Audit Logging

### 6.1 What Is Logged

All of the following are logged to the `audit_events` table with tenant ID, timestamp,
user ID, and request metadata:

- Every authenticated API request (method, path, response status)
- Every approval submission (task ID, approver, decision)
- Every agent session start and end (session ID, duration, tool call count)
- Every rate limit hit
- Every authentication failure (without exposing the reason to the client)
- Every feature flag check that results in access denial
- Every prompt injection detection event

### 6.2 Log Retention

Audit logs are retained for a minimum of 90 days. Logs older than 90 days are
archived to cold storage (not deleted) and can be retrieved within 48 hours.

### 6.3 Tenant Access to Audit Logs

Tenants with the `owner` role can read their own audit events via
`GET /api/studio/audit-events`. They cannot read other tenants' audit events
(enforced by RLS).

---

## 7. Data Isolation

### 7.1 Row Level Security (RLS)

All multi-tenant tables have PostgreSQL RLS policies enforced. The kernel sets
`app.current_tenant_id` at the start of each request. Every query on a
multi-tenant table automatically filters to the current tenant.

`FORCE ROW LEVEL SECURITY` is enabled on all tables, including for the table
owner role. This prevents accidental bypass via superuser connections.

### 7.2 Per-Tenant Workspace

Each tenant's project files are stored under:
```
/workspace/<tenant_id>/<project_id>/
```

Path scope checks use `realpathSync()` + `normalize()` + `path.sep` comparison
before any filesystem operation. Symlink traversal outside the tenant workspace
is blocked by the sandbox guard.

### 7.3 Cross-Tenant Isolation Verification

Before any beta tenant begins using the system:

1. Run the tenant isolation test suite:
   ```bash
   pnpm test -- --testPathPattern=tenant-isolation
   ```
2. Manually verify that Tenant A cannot read Tenant B's projects via the API
3. Confirm RLS is active on the database connection used by the kernel:
   ```sql
   SELECT tablename, rowsecurity, forcerowsecurity
   FROM pg_tables
   WHERE schemaname = 'public'
   ORDER BY tablename;
   ```
   All rows should show `rowsecurity = true` and `forcerowsecurity = true`.
