# Hermes Bridge Design — v2

**Status**: Design specification (pre-implementation)
**Date**: 2026-05-14
**Supersedes**: hermes-gateway-risk-assessment.md (P10-L)
**Target sprint**: P12 (implementation gated on preconditions below)
**Classification**: Architecture Decision Record

---

## Goal

Define the technical architecture for the Hermes bridge — a controlled channel that allows LLM-mediated agents (Hermes clients) to invoke Oscorpex actions through a structured gateway. The bridge must enforce the same security guarantees as direct MCP write paths, with additional Hermes-specific constraints around prompt injection, tool budgets, and tenant isolation.

This document refines the threat model in P10-L and provides a concrete implementation blueprint for P12.

---

## Design Principles

1. **Read-only first.** Only read MCP tools are available to Hermes clients at launch. Write access requires explicit approval and is disabled by default.
2. **Defense in depth.** Every layer (auth, policy, tool gate, audit, secret guard) operates independently — a bypass in one layer does not grant access.
3. **Approval-mandatory for writes.** Write operations initiated via Hermes must pass through the same checkpoint + approval flow as direct MCP write calls. No auto-approve.
4. **Audit everything.** Every Hermes invocation (including denied ones) is recorded in `audit_events` with `source: "hermes"`.
5. **Tenant isolation is absolute.** A Hermes client authenticated as Tenant A cannot access Tenant B data under any circumstances.
6. **Secret guard on all boundaries.** Every inbound and outbound payload crosses a `checkForSecrets()` / `redactForAudit()` boundary.

---

## Architecture

```
Hermes Client
     │
     ▼
┌──────────────────────────────┐
│       Hermes Gateway         │  ← API key auth, rate limit, request validation
│  POST /hermes/invoke         │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│       MCP Bridge             │  ← JSON-RPC 2.0 protocol layer
│  handleJsonRpcRequest()      │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│       Tool Policy Gate       │  ← evaluateToolPolicy() — deny write if not approved
│  evaluateToolPolicy()        │
└──────────────┬───────────────┘
               │ (read-only)           │ (write — requires approval)
               ▼                       ▼
┌────────────────────┐    ┌──────────────────────────┐
│   Tool Execution   │    │   Approval Checkpoint     │
│  (read tools only) │    │  createApproval() →       │
│                    │    │  human review →           │
└────────────────────┘    │  applyApprovedWrite()     │
                          └──────────────────────────┘
               │
               ▼
┌──────────────────────────────┐
│     Secret Guard             │  ← redactForAudit() on all responses
│     Audit Emit               │  ← audit_events record (always)
└──────────────────────────────┘
               │
               ▼
          Hermes Client (response)
```

---

## Auth Flow

### API Key Resolution

1. Hermes client sends `Authorization: Bearer <hermes-api-key>` on every request.
2. Gateway middleware resolves the key against the `hermes_api_keys` table (hashed storage).
3. Resolution returns `{ tenantId, clientId, role, rateLimit }`. Key not found → 401.
4. `tenantId` is stamped on the request context. All downstream queries are scoped to this tenant.

### RBAC Roles

| Role | Allowed | Forbidden |
|------|---------|-----------|
| `hermes-reader` | Read MCP tools, status endpoints | Any write tool, pipeline mutations |
| `hermes-writer` | Same as reader + write proposals (pending approval) | Auto-approve, admin actions |

External Hermes clients never receive `admin`, `operator`, or `service` roles.

### Key Management

- Keys are stored hashed (SHA-256) in `hermes_api_keys` table.
- Keys are scoped to a single tenant and a single role.
- Keys can be rotated without service restart (DB lookup on every request).
- Revoked keys are hard-deleted from the table; revocation takes effect immediately.

---

## Request Flow (Read-Only Path)

```
1. POST /hermes/invoke  { method: "tools/call", params: { name: "read_file", ... } }
2. Auth middleware → resolve API key → stamp tenantId
3. Rate limiter → check per-client + per-tenant limits
4. detectPromptInjection() → applied to all string params in the request body
5. evaluateToolPolicy({ toolName, riskLevel: "read", source: "hermes" }) → allow
6. MCP bridge executes read tool in tenant-scoped context
7. checkForSecrets() on tool output → redact if secrets detected
8. recordAudit({ source: "hermes", ... }) → audit_events row inserted
9. Response returned to Hermes client
```

---

## Request Flow (Write Path)

```
1. POST /hermes/invoke  { method: "tools/call", params: { name: "write_file", ... } }
2. Auth middleware → role must be "hermes-writer"
3. Rate limiter → 5 write proposals/min (stricter than read)
4. detectPromptInjection() on all string params
5. evaluateToolPolicy({ toolName, riskLevel: "write", source: "hermes" }) → requires approval
6. createApproval({ source: "hermes", toolName, args, tenantId, checkpointId }) → returns approvalId
7. Response: 202 Accepted { approvalId, status: "pending_human_review" }
8. Human approves via /studio/mcp/approvals UI
9. POST /mcp/write/apply { approvalId, toolName, args } → applyApprovedWrite()
10. recordAudit({ source: "hermes", approvalId, outcome: "applied" })
```

Write calls never complete synchronously. The 202 response ensures humans remain in the loop.

---

## Tenant Isolation

- Every DB query issued during a Hermes request must include `WHERE tenant_id = $1`.
- RLS policies on `tasks`, `phases`, `project_plans`, `agent_sessions`, and all tenant-scoped tables enforce this at the PostgreSQL layer.
- The `tenantId` extracted from the API key is the single authoritative source. Any `tenantId` in the request body is ignored; the key-derived value always wins.
- Cross-tenant queries are structurally impossible: no query joins across tenant boundaries.
- Hermes API keys must not carry cross-tenant scopes; the `hermes_api_keys` schema must enforce a single `tenant_id NOT NULL` column.

---

## Rate Limiting

| Scope | Limit | Enforcement |
|-------|-------|-------------|
| Per Hermes client (API key) | 60 req/min | Middleware — rate-limiter.ts |
| Per tenant (all Hermes clients combined) | 300 req/min | Middleware |
| Write proposals (per client) | 5 req/min | Middleware — write path only |
| Tool calls per session | 20 total | In-session budget counter |

Rate limit state is stored in-process (same as existing rateLimiter middleware). For multi-instance deployments, this must move to Redis — tracked as a P12 prerequisite.

---

## Prompt Injection Defense

All string-valued parameters in the Hermes request body are passed through `detectPromptInjection()` from `learning-governance.ts` (23 regex patterns) before any tool call executes.

If injection is detected:
- Request is rejected with 400 and `{ error: "prompt_injection_detected" }`.
- Audit event recorded with `outcome: "injection_blocked"`.
- No tool call is initiated.

Memory facts injected into Hermes prompt context must pass through `sanitizeForPrompt()` before inclusion.

---

## Secret Guard

All Hermes response payloads pass through `redactForAudit()` (25+ patterns) before being returned to the Hermes client. If `checkForSecrets()` detects secrets in a tool output, the output is replaced with `"[REDACTED — secret detected]"` and an audit event is emitted.

Environment variables are never included in prompts assembled for Hermes context. The prompt-assembler must not expose `process.env` values regardless of the Hermes client's role.

---

## Audit Logging

Every Hermes invocation produces an `audit_events` row with the following fields:

| Field | Value |
|-------|-------|
| `source` | `"hermes"` |
| `tenant_id` | From API key resolution |
| `actor_id` | SHA-256 hash of the API key (never the raw key) |
| `action` | `tools/call:<toolName>` |
| `resource` | `projectId` if applicable |
| `outcome` | `"allowed"` / `"denied"` / `"pending_approval"` / `"injection_blocked"` |
| `metadata` | `{ clientId, role, durationMs }` |
| `created_at` | UTC timestamp |

Denied and injection-blocked events must be audited regardless of whether the request reaches tool execution.

---

## Per-Session Tool Call Budget

Each Hermes session (identified by a `session_id` in the request or generated server-side) carries a tool call budget of 20 calls. The counter is incremented before each tool execution. If the budget is exhausted:

- Request rejected with 429 and `{ error: "tool_budget_exhausted" }`.
- Session must be re-initiated to receive a fresh budget.
- Budget state is in-memory for now; persisted sessions tracked in `hermes_sessions` table (P12 schema migration required).

This prevents cascading amplification attacks where a single malicious prompt triggers dozens of downstream tool calls.

---

## Required DB Schema (P12 Migration)

```sql
CREATE TABLE IF NOT EXISTS hermes_api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    client_id   TEXT NOT NULL,
    key_hash    TEXT NOT NULL UNIQUE,     -- SHA-256 of raw key
    role        TEXT NOT NULL CHECK (role IN ('hermes-reader', 'hermes-writer')),
    rate_limit  INT NOT NULL DEFAULT 60,  -- req/min
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS hermes_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    client_id       TEXT NOT NULL,
    tool_calls_used INT NOT NULL DEFAULT 0,
    tool_call_budget INT NOT NULL DEFAULT 20,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expired         BOOLEAN NOT NULL DEFAULT FALSE
);
```

---

## Preconditions for P12 Implementation

All of the following must be verified before P12 implementation begins:

1. Approval flow persists correctly for new projects (P9 regression fully resolved).
2. Secret guard has 25+ patterns covering all major credential types (P10-J complete).
3. All write routes carry authentication middleware — `OSCORPEX_DEV_NO_AUTH` bypass must not exist in production builds.
4. RLS enforced on `tasks`, `phases`, `project_plans`, `agent_sessions`, `audit_events`.
5. `audit_events` populated for every mutation route end-to-end.
6. Rate limiting middleware deployed across all existing routes.
7. `resolveAndValidateUrl()` applied to every URL-accepting input field.
8. `detectPromptInjection()` integrated into a reusable middleware layer (not only inline in learning-governance).
9. `checkForSecrets()` / `redactForAudit()` applied on all outbound payloads (can be verified via existing secret-guard tests).
10. `evaluateToolPolicy()` gates all tool calls in the MCP bridge execution path.
11. `hermes_api_keys` and `hermes_sessions` tables exist in the schema (migration applied).
12. Per-session tool call budget counter implemented and tested.

---

## Explicit No-Go Criteria

Implementation MUST NOT proceed to P12 if any of the following is true:

- `OSCORPEX_DEV_NO_AUTH=true` can reach production environments.
- RLS not active on any tenant-scoped table.
- Rate limiting middleware is missing from the Hermes gateway route group.
- Audit log is not populating `audit_events` for denied requests.
- Approval flow is not persisting for new projects in staging.
- Secret guard redaction is not applied to tool output before returning to Hermes client.
- `evaluateToolPolicy()` is not wired into the Hermes tool execution path.
- `detectPromptInjection()` is not applied to all string params in the Hermes request.
- Hermes bridge can execute more than 20 tool calls per session without budget enforcement.
- API key resolution does not enforce single-tenant scoping.
- Any Hermes client can be granted the `admin`, `operator`, or `service` role.

---

## Out of Scope for P12

- Autonomous write operations without human approval (deferred indefinitely — see Phase 4 in P10-L).
- Slack / Discord integration (separate design required — see P10-L entry point risks).
- Multi-instance rate limit coordination via Redis (tracked separately; in-process is acceptable for single-node staging).
- Hermes client SDK or CLI tooling.
- Streaming tool responses via SSE or WebSocket.

---

## Testing Requirements

Before P12 ships:

- Unit tests for API key resolution (valid, expired, revoked, wrong tenant).
- Unit tests for tool call budget enforcement (under budget, at budget, over budget).
- Unit tests for prompt injection detection on Hermes request params.
- Integration test: read tool call succeeds end-to-end through the gateway.
- Integration test: write tool call returns 202 with `approvalId`.
- Integration test: injection-bearing request returns 400 and audit event recorded.
- Integration test: budget exhaustion returns 429 after 20 calls.
- Coverage target: Hermes bridge module >= 80% (lines, functions, branches).
