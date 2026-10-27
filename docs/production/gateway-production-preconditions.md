# Gateway Production Preconditions

Version: P11 — Read-Only Gateway Prototype
Status: Draft — must be fully satisfied before production traffic is routed to the gateway.

---

## 1. Activation Gate

**Precondition**: Gateway is disabled by default and MUST remain disabled until all items in this
document are satisfied and signed off.

- Environment variable `OSCORPEX_ENABLE_GATEWAY` must be set to `"true"` explicitly.
- Deployment pipeline must gate on a separate "gateway-enabled" feature flag in addition to the
  env var, so it can be toggled without a redeploy.
- Rollback procedure: set `OSCORPEX_ENABLE_GATEWAY=false` and redeploy within 5 minutes.

---

## 2. Authentication (P11-B)

**No-go if any item is missing.**

- [ ] All `/gateway/*` endpoints require a valid API key in `Authorization: Bearer <key>` header.
- [ ] API keys are scoped to a single tenant; cross-tenant key reuse is impossible.
- [ ] API keys have an expiry (default: 90 days) and must be rotated before expiry.
- [ ] Revoked keys are rejected within 30 seconds (no long-lived caches for revoked state).
- [ ] Key issuance is logged in the audit log with the issuing actor, tenant, and creation time.
- [ ] A machine-readable key inventory endpoint exists so operators can audit active keys.

---

## 3. Tenant Isolation (P11-C)

**No-go if any item is missing.**

- [ ] Every gateway request carries `x-tenant-id` and `x-project-id` headers (or equivalent).
- [ ] The kernel enforces that the API key's tenant matches the `x-tenant-id` header; mismatch
  returns 403.
- [ ] MCP tool handlers enforce workspace scoping via `assertInsideWorkspace()` — verified by
  integration test.
- [ ] Cross-tenant data leakage scenario tested: tool invocation with mismatched tenant returns
  empty result or 403, never data from another tenant.
- [ ] Rate limits are applied per tenant, not globally (see Section 5).

---

## 4. Role-Based Access Control / Policy (P11-D)

**No-go if any item is missing.**

- [ ] `enforceToolPolicy()` is called before every tool invocation inside `handleGatewayRequest`.
- [ ] Policy engine must be in production mode (not test-permissive mode) when gateway is live.
- [ ] Policy decisions are audited in the structured log with `decision`, `tool`, `actorId`, and
  `tenantId` fields.
- [ ] There is a deny-by-default fallback: unknown tools that are not on the allowlist return
  `TOOL_NOT_ALLOWED` regardless of policy decision.
- [ ] `ToolPolicyApprovalRequiredError` is handled and returns a structured error (not 500).

---

## 5. Rate Limiting (P11-E)

- [ ] Gateway rate limit defaults to 60 requests per minute per API key.
- [ ] Limit is overridable via `OSCORPEX_GATEWAY_RATE_LIMIT` env var (integer, req/min).
- [ ] Rate limit is enforced per tenant (not global) in production — current in-memory
  implementation must be replaced with a Redis-backed or DB-backed counter before
  multi-instance deployment.
- [ ] Rate limit response headers (`X-RateLimit-Remaining`, `X-RateLimit-Reset`) are returned on
  every gateway response.
- [ ] `429 Too Many Requests` is returned with `Retry-After` header when limit is exceeded.
- [ ] Burst allowance (e.g. 10 requests above limit for 5 seconds) is documented and tested.

**Known limitation (single-instance only)**: The current `rate-limiter.ts` implementation uses
an in-memory sliding window. It does not synchronize across multiple kernel instances. Before
horizontal scaling, replace with a shared counter (Redis `INCR`/`EXPIRE` or PostgreSQL advisory
lock pattern).

---

## 6. Read-Only Enforcement (P11-A)

- [ ] Allowlist of read-only tools is defined in `gateway-config.ts` and is the single source of
  truth. No tool outside this list can be invoked via the gateway under any circumstances.
- [ ] Allowlist reviewed and approved by a second engineer before enabling in production.
- [ ] A test exists that attempts to invoke each write tool and asserts `TOOL_NOT_ALLOWED`.
- [ ] Adding a new tool to the allowlist requires a code review and must not include any tool with
  `riskLevel !== "read"`.

Current allowlist (8 tools):
```
repo.listFiles
repo.readFile
repo.search
git.status
git.diff
project.getTaskState
project.getPipelineState
docs.search
```

---

## 7. Audit Logging (P11-F)

- [ ] Every gateway invocation — allow and deny — is recorded by `recordMcpAudit()`.
- [ ] Audit record includes: `tenantId`, `projectId`, `actorId`, `toolName`, `decision`,
  `status`, `durationMs`, `errorCode` (when applicable).
- [ ] Audit records are persisted to a durable store (database or append-only log); in-memory
  event bus emission alone is not sufficient for production.
- [ ] Audit records are retained for at least 90 days per compliance requirement.
- [ ] Audit log is tamper-evident (append-only, no UPDATE/DELETE).
- [ ] An operator dashboard or query endpoint exists to search audit records by tenant, actor,
  tool, and time range.
- [ ] `auditId` is returned in every gateway response so clients can correlate logs.

---

## 8. Response Redaction (P11-G)

- [ ] `redactResponse()` is applied to all successful tool results before the response is sent.
- [ ] Redaction pattern coverage includes at minimum:
  - Anthropic API keys (`sk-...`)
  - GitHub PATs (`ghp_...`, `github_pat_...`)
  - AWS access key IDs (`AKIA...`)
  - GitLab PATs (`glpat-...`)
  - Stripe keys (`sk_live_...`, `sk_test_...`)
  - Google API keys (`AIza...`)
  - PEM private key headers
  - Generic `password=`, `secret=`, `token=`, `key=` assignments
- [ ] Redaction is tested with a corpus of known secret formats (unit test covering each pattern).
- [ ] Redacted content is never logged at any level (not even DEBUG).
- [ ] Binary file reads: binary content that cannot be reliably redacted should return a
  structured error (`BINARY_CONTENT_NOT_SUPPORTED`) rather than raw bytes.

---

## 9. Input Validation

- [ ] `toolName` is validated against the allowlist (already enforced).
- [ ] `args` object is validated per-tool against a JSON Schema before being forwarded to the
  MCP bridge. Unknown/excess fields are stripped.
- [ ] Maximum request body size is capped at 64 KB; larger requests return 413.
- [ ] `actorId` is validated as a non-empty string (no control characters).
- [ ] `tenantId` and `projectId` are validated as UUID v4 format in production.

---

## 10. Transport Security

- [ ] Gateway endpoints are only reachable over HTTPS/TLS 1.2+ in production.
- [ ] HSTS header with `max-age=31536000; includeSubDomains` is set.
- [ ] HTTP→HTTPS redirect enforced at the load balancer level.
- [ ] TLS certificate rotation is automated (e.g. Let's Encrypt or ACM).

---

## 11. Observability

- [ ] `gateway-routes.ts` emits structured logs for every request (tool, tenant, actor, duration).
- [ ] A Prometheus/OpenTelemetry counter `gateway_invocations_total{tool, status}` is emitted.
- [ ] A histogram `gateway_invocation_duration_ms{tool}` is emitted.
- [ ] An alert fires if error rate exceeds 5% over 5 minutes.
- [ ] An alert fires if p99 latency exceeds 2000 ms.
- [ ] Gateway health endpoint `GET /gateway/health` is polled by the load balancer.

---

## 12. No-Go Criteria

The gateway MUST NOT be enabled in production if ANY of the following is true:

| # | Condition |
|---|-----------|
| 1 | Authentication (Section 2) is not fully implemented — API key validation is stub/no-op. |
| 2 | Tenant isolation test is failing or skipped. |
| 3 | Rate limiting is in-memory only AND kernel runs more than one instance. |
| 4 | Audit records are not being persisted to a durable store. |
| 5 | Any write tool is reachable through the gateway (allowlist bypass). |
| 6 | Response redaction unit tests are not passing. |
| 7 | TLS is not enforced on the ingress path. |
| 8 | `OSCORPEX_ENABLE_GATEWAY` is `"true"` in any environment without completing this checklist. |

---

## 13. Sign-Off Checklist

All items below must be checked and signed by the named role before gateway traffic is enabled.

| Role | Item | Signed | Date |
|------|------|--------|------|
| Engineering Lead | All code review PRs merged and tests green | | |
| Security | Threat model reviewed; no-go criteria cleared | | |
| QA | Integration tests passing in staging environment | | |
| Ops | Monitoring alerts configured and tested | | |
| Product | Allowlist of tools approved | | |

---

## 14. Related Files

- `apps/kernel/src/studio/gateway/gateway-config.ts` — tool allowlist and env var config
- `apps/kernel/src/studio/gateway/gateway-service.ts` — core auth, policy, audit, redact logic
- `apps/kernel/src/studio/routes/gateway-routes.ts` — Hono route handlers
- `apps/kernel/src/studio/middleware/rate-limiter.ts` — sliding window rate limiter
- `apps/kernel/src/studio/mcp-bridge/mcp-audit.ts` — audit record emitter
- `apps/kernel/src/studio/mcp-bridge/secret-guard.ts` — secret pattern definitions
- `apps/kernel/src/studio/__tests__/p11-gateway.test.ts` — gateway unit tests
