# Hermes / HTTP Gateway — Risk Assessment

**Status**: Pre-integration assessment  
**Date**: 2026-05-14  
**Scope**: External integration readiness (Hermes bridge, HTTP gateway, Slack/Discord)  
**Classification**: Architecture Decision Record

---

## Goal

Evaluate the readiness of Oscorpex to accept external integrations via an HTTP gateway or Hermes bridge (LLM-mediated action routing). This document identifies risks, required preconditions, and a phased adoption plan before any external surface is opened.

---

## Current Safety Baseline (P0–P9)

| Sprint | Protection |
|--------|-----------|
| P0 | Sandbox path hardening, symlink resolution, scope enforcement |
| P1 | Graph invariant validation (cycle detection, duplicate edge) |
| P2 | DB-backed test isolation, deterministic test serialization |
| P3 | Checkpoint/rollback scaffolding, pipeline state DB-authoritative |
| P4 | Budget guard, cost circuit breaker, auto-pause |
| P5 | Command policy enforcement, audit log (command_audit_logs) |
| P6 | Learning governance — injection detection (23 regex), pattern scoring, promotion gates |
| P7 | Risk classifier — 6-signal weighted scorer integrated into sandbox |
| P8 | MCP bridge read-only enforcement, secret guard (13+ patterns), tool policy |
| P9 | Git commit workflow, approval persistence, checkpoint wiring |
| P10 | Secret guard expansion (25 patterns), memory pruning planner (read-only) |

---

## Threat Model

### External Actor Injection
An attacker controls input that reaches the LLM or task pipeline through an external channel (HTTP webhook, Slack message, Hermes prompt). Goals: exfiltrate data, trigger unauthorized writes, escalate privileges.

**Mitigations required**: Input sanitization, prompt injection detection, tool policy gating.

### Credential Theft
External integration leaks secrets from environment, memory facts, or task outputs to a third-party endpoint.

**Mitigations required**: Secret guard on all outbound payloads, redactForAudit() on logged data, no raw env vars in prompts.

### Tenant Cross-Access
A request authenticated as Tenant A accesses or modifies Tenant B resources.

**Mitigations required**: Row-level security on all tables, strict tenantId scoping in every query, no cross-tenant joins.

### Denial of Service
Flood of external requests exhausts DB connections, task slots, or LLM quota.

**Mitigations required**: Per-integration rate limits, adaptive concurrency semaphore, budget guard circuit breaker.

### Prompt Injection via External Content
User-supplied content in a Slack message or webhook payload contains instructions designed to hijack LLM behavior (e.g., "ignore previous instructions").

**Mitigations required**: detectPromptInjection() from learning-governance.ts applied to all external inputs, content sandboxing before prompt assembly.

---

## Entry Point Risks

### HTTP Gateway
- **Risk**: Open TCP surface; any client can POST task triggers or pipeline mutations
- **Attack vectors**: Replay attacks, SSRF via webhook URLs, injection in task description fields
- **Required controls**: JWT/API key auth, resolveAndValidateUrl() for all URL fields, request size limits, strict content-type enforcement

### Webhook Triggers
- **Risk**: Unsigned webhooks can be forged; payload may contain injection payloads
- **Attack vectors**: Payload injection, secret exfiltration via callback URL
- **Required controls**: HMAC signature verification, resolveAndValidateUrl() + DNS resolution before private IP check, secret guard on payload before processing

### Slack / Discord Commands
- **Risk**: Commands arrive as plaintext strings; slash-command handler is trivially injectable
- **Attack vectors**: Prompt injection via message text, impersonation of workspace admins
- **Required controls**: detectPromptInjection() on all message text, user identity verified against internal RBAC, workspace-to-tenant mapping enforced

### Hermes Bridge
- **Risk**: LLM-mediated routing amplifies injection surface — a single malicious prompt can trigger cascading tool calls
- **Attack vectors**: Tool abuse (LLM calls disallowed tools), privilege escalation via forged context, indirect prompt injection from memory facts
- **Required controls**: evaluateToolPolicy() gate on every tool call, approval flow for all write operations, memory facts sanitized via sanitizeForPrompt()

---

## Auth / RBAC Requirements

- Every external integration must authenticate with a scoped API key (not the global service key)
- API keys carry a `tenantId` claim enforced at route middleware level
- Role-based access: external integrations receive `integration-reader` or `integration-writer` role; never `admin` or `operator`
- Write operations require `integration-writer` role AND active approval flow
- API keys must be rotatable without service restart; stored hashed in DB

---

## Tenant Isolation

- All DB queries for external requests must include `tenant_id = $1` predicate
- RLS policies applied via direct tenant_id columns (no subquery joins — per P0 optimization)
- Cross-tenant data must be structurally impossible: no shared task/phase/project tables without RLS
- Integration tokens must not carry cross-tenant scopes

---

## Rate Limiting

| Scope | Limit |
|-------|-------|
| Per integration (API key) | 60 req/min |
| Per tenant | 300 req/min |
| Per endpoint (task trigger) | 10 req/min |
| Webhook ingest | 30 req/min per source |
| Hermes bridge actions | 5 tool calls/min |

Rate limits must be enforced in middleware before business logic executes.

---

## Approval Requirements

- All write operations initiated from external integrations must pass through the approval flow
- Approval records must be persisted in the `approvals` table with `source: "external-integration"`
- No auto-approve for external requests; human-in-the-loop required for writes
- Read-only operations (status checks, artifact downloads) may bypass approval

---

## Tool Policy

- All integrations are subject to evaluateToolPolicy() before any tool call executes
- Denied tools: filesystem writes outside workspace, shell exec without approval, secret reads
- Hermes bridge tool calls must pass policy even if the LLM insists they are safe
- Policy violations are logged to command_audit_logs with source tagged as `hermes` or `gateway`

---

## Memory and Secret Risks

- Memory facts must never be returned verbatim to external integrations; they must pass through sanitizeForPrompt() and secret-guard redactForAudit()
- Task outputs sent to external systems (webhooks, Slack) must pass checkForSecrets() before transmission; blocked if `safe: false`
- Environment variables must never be included in prompts assembled for external callers
- LLM responses forwarded externally must have secrets redacted via redactForAudit()

---

## Audit Requirements

- Every external invocation (HTTP, webhook, Slack, Hermes) must produce an audit_events record
- Audit fields: `source`, `tenantId`, `actorId` (API key hash), `action`, `resource`, `outcome`, `timestamp`
- Failed authentication attempts must also be audited
- Audit log must be append-only; no external integration may delete or modify audit records

---

## Gateway-Specific Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Open HTTP endpoint without auth | Critical | API key required on all routes |
| SSRF via task description URL | High | resolveAndValidateUrl() before processing |
| Large payload DoS | Medium | Request body size limit (1 MB) |
| Header injection | Medium | Strict header parsing, no passthrough |
| Path traversal in resource IDs | High | UUID validation on all ID parameters |

---

## Hermes-Specific Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Prompt injection via user content | Critical | detectPromptInjection() on all inputs |
| Tool abuse (LLM calls disallowed tools) | High | evaluateToolPolicy() gate |
| Indirect injection from memory facts | High | sanitizeForPrompt() on all memory reads |
| Cascading tool calls (amplification) | High | Per-session tool call budget (max 20) |
| Context window stuffing | Medium | Prompt size cap enforced by prompt-assembler |
| Autonomous write without approval | Critical | Approval flow mandatory for writes |

---

## Required Preconditions Before Opening External Surface

The following conditions must be verified (not merely planned) before any external integration is activated:

1. Approval flow is stable and persists correctly for new projects (P9 regression fixed)
2. Secret guard has 25+ patterns covering all major credential types (P10-J complete)
3. All write routes have authentication middleware (not just `OSCORPEX_DEV_NO_AUTH` bypass)
4. RLS policies active on all tenant-scoped tables
5. Audit log (audit_events) populated for every mutation route
6. Rate limiting middleware deployed (not just planned)
7. resolveAndValidateUrl() applied to all URL-accepting fields
8. detectPromptInjection() integrated into the external request handler
9. checkForSecrets() applied before any outbound payload transmission
10. evaluateToolPolicy() gates all tool calls from external contexts

---

## Recommended Phased Adoption

### Phase 1: Read-Only Gateway (Safe to begin)
- Status endpoints only: project status, task progress, artifact metadata
- No pipeline mutations, no task creation
- API key auth with tenantId scoping
- Full audit logging
- Rate limits active

### Phase 2: Write with Mandatory Approval (After preconditions verified)
- External triggers can propose tasks (task_proposals table)
- Every proposal requires human approval before execution
- Webhook ingest with HMAC verification
- Secret guard on all inbound payloads

### Phase 3: Hermes Bridge (After Phase 2 stable for 2+ weeks)
- LLM-mediated routing enabled for pre-approved action sets
- Tool call budget per session (max 20 calls)
- All Hermes actions subject to the same approval flow as Phase 2
- Hermes prompt templates reviewed and locked; no dynamic system prompt injection

### Phase 4: Autonomous Scope (NEVER for P11 — deferred indefinitely)
- Autonomous write operations without human approval
- This phase must not be implemented until the full governance framework (roles, policies, audit, circuit breakers) has been validated in production for a minimum of 30 days

---

## Explicit No-Go Criteria

Integration MUST NOT be activated if any of the following is true:

- No authentication on external routes (`OSCORPEX_DEV_NO_AUTH=true` in production)
- RLS not enforced on tasks, phases, or project_plans tables
- No rate limiting middleware deployed
- Audit log not populating for mutations
- Approval flow not persisting for new projects
- Secret guard not applied to outbound payloads
- evaluateToolPolicy() not wiring into the execution path for external calls
- detectPromptInjection() not applied to external text inputs
- Hermes bridge enabled without per-session tool call budget

---

## Summary

Oscorpex has strong layered defenses through P10, but opening an external surface requires explicit wiring of auth, rate limiting, and outbound secret guard that are currently not connected to external entry points. The recommended path is Phase 1 (read-only) first, validated in staging, before any write operations are exposed externally.
