# Hermes Incident Response Playbook

**Version**: 1.0  
**Owner**: Platform Security  
**Last Updated**: 2026-05-14  
**Scope**: Hermes read-only MCP gateway (P12 feature set)

---

## Overview

This playbook covers incident response procedures for the Hermes MCP gateway. Hermes operates in read-only mode by default — write tools are denied by policy. However, the gateway handles sensitive project data and requires a structured response to security events.

**Severity Levels**

| Level | Label | SLO |
|-------|-------|-----|
| P0 | Critical | 15 min response |
| P1 | High | 1 hour response |
| P2 | Medium | 4 hour response |
| P3 | Low | 24 hour response |

---

## Scenario 1 — API key compromise

**Severity**: P1 High  
**Indicators**: Unexpected geographic access, anomalous request volume, requests from unknown IP ranges, concurrent sessions from disjoint locations.

**Immediate response (0–15 min)**

1. Revoke the compromised key immediately via `DELETE /api/studio/hermes/keys/:id`.
2. Pull audit trail for the key: `GET /api/studio/mcp/audit?keyId=<id>&limit=500`.
3. Note all `actorId`, `projectId`, `toolName` fields in audit records during the compromise window.
4. Invalidate all active Hermes sessions linked to the key: restart session store or flush by `apiKeyId`.
5. Notify the key owner via secure channel.

**Investigation (15 min – 2 hours)**

6. Correlate audit records with project data access — identify which read-only tools were invoked and which projects were targeted.
7. Assess whether any cross-tenant access occurred (look for `TENANT_MISMATCH` error codes alongside successful invocations with different tenant IDs).
8. Check for outbound exfiltration signals: unusually large response payloads, repeated `file.read` on credential paths, rapid sequential reads.
9. Review rate-limiting logs — a compromised key may have exhausted its 30 req/min window repeatedly.

**Remediation**

10. Issue new key to the legitimate owner with a fresh name to prevent reuse confusion.
11. Add the source IP range to the deny-list if infrastructure supports it.
12. If data exposure is confirmed, escalate to P0 and initiate data breach notification flow.
13. Document timeline, root cause, and affected resources in the incident record.

---

## Scenario 2 — Prompt injection detected

**Severity**: P1 High  
**Indicators**: `PROMPT_INJECTION` error codes in audit log, repeated denial events from a single `actorId`, unusual patterns in tool arguments.

**Immediate response (0–15 min)**

1. Identify the `actorId` responsible from audit records.
2. Revoke the API key associated with the actor: `DELETE /api/studio/hermes/keys/:id`.
3. Block the actor at the session level — terminate all active sessions for the `actorId`.
4. If the actor is an authenticated user, temporarily disable their account at the auth layer.

**Investigation**

5. Extract the raw argument strings that triggered detection from `mcp_audit_logs` (stored as `args` column or reconstructed from tool invocation logs).
6. Assess which injection patterns were matched (see `hermes/prompt-injection-guard.ts` — 23 regex patterns).
7. Determine intent: automated probe, manual attack, or buggy client sending malformed payloads.
8. Review whether any invocations succeeded before the injection guard caught subsequent attempts.

**Remediation**

9. If new injection patterns are discovered that the 23-regex set would miss, add them to `prompt-injection-guard.ts` and deploy a patch.
10. Update rate-limit thresholds for high-risk actors.
11. If the actor is an internal service (CI, automation), remediate the client code to sanitize tool arguments before invocation.
12. File a post-mortem within 48 hours if patterns reveal a systemic gap.

---

## Scenario 3 — Session budget abuse

**Severity**: P2 Medium  
**Indicators**: Repeated `SESSION_EXHAUSTED` errors in audit, rapid session creation by a single actor, anomalous tool call volume.

**Immediate response**

1. Identify the actor from audit records and note their session creation frequency.
2. Revoke the API key if automated abuse is confirmed.
3. If the actor is legitimate, contact them and advise on correct session lifecycle management.

**Investigation**

4. Check `hermes-session.ts` session map for concurrent active sessions — the in-memory store will show live sessions.
5. Confirm whether the actor is creating sessions without terminating previous ones (session leak).
6. Review `maxToolCalls` parameter — default budget may need adjustment for legitimate high-volume consumers.

**Remediation**

7. Tighten per-actor session creation rate limiting at the route level (`hermesRoutes.use("*", rateLimiter(...))`).
8. Add a per-actor concurrent session cap if not already present.
9. If the use case is legitimate, negotiate a higher `maxToolCalls` budget via a dedicated configuration path.
10. Document the session budget configuration rationale in `performance-config.ts` comments.

---

## Scenario 4 — Data exfiltration attempt

**Severity**: P0 Critical  
**Indicators**: High-frequency `file.read` on known sensitive paths (`.env`, `*.pem`, `*secret*`, `*credential*`), bulk data reads across project boundaries, large response payloads correlated with a single session.

**Immediate response (0–15 min)**

1. Disable Hermes entirely: set `HERMES_ENABLED=false` in the environment and restart the kernel.
2. Revoke all active API keys.
3. Preserve the full audit log snapshot before any log rotation: `pg_dump` or export `mcp_audit_logs` table.
4. Notify the security team and platform owner immediately.

**Investigation**

5. Reconstruct the data access timeline from audit records, sorted by `created_at`.
6. Identify which files/resources were read and whether they contain credentials, PII, or proprietary data.
7. Check secret redaction: review `hermes-service.ts` `REDACT_PATTERNS` — if any secrets passed through unredacted, treat as confirmed exfiltration.
8. Determine the attack vector: compromised key, stolen session token, or internal threat.

**Remediation**

9. Rotate all potentially exposed secrets immediately: API keys, DB passwords, OAuth tokens.
10. Patch the redaction patterns if any secrets escaped detection.
11. Re-enable Hermes only after root cause is confirmed and mitigated.
12. Conduct a security review of the `HERMES_ALLOWED_TOOLS` set — consider removing `file.read` if the use case does not require it.
13. Initiate external forensics if PII or customer data was accessed.

---

## Scenario 5 — Cross-tenant access attempt

**Severity**: P0 Critical  
**Indicators**: `TENANT_MISMATCH` error codes, requests with a `sessionId` that belongs to a different tenant, or evidence of tenant ID spoofing in request headers.

**Immediate response (0–15 min)**

1. Identify the `actorId` and `tenantId` pair from the audit record showing the mismatch.
2. Revoke the actor's API key immediately.
3. Verify RLS (Row-Level Security) is enforced on all DB queries downstream of Hermes tool invocations.
4. Check `tasks`, `phases`, `projects` tables — confirm `tenant_id` column is present and indexed (see `scripts/init.sql`).

**Investigation**

5. Determine whether the tenant mismatch was logged before any successful tool invocation — confirm the guard in `hermes-service.ts` fired correctly.
6. If any tool invocation succeeded before the mismatch check (e.g., race condition), treat as confirmed cross-tenant data access — escalate to P0.
7. Review all sessions created by the actor across tenants.
8. Check whether the session store allows session IDs to be guessed or brute-forced (UUIDs from `randomUUID()` should be sufficient entropy).

**Remediation**

9. If cross-tenant data was accessed, notify the affected tenant immediately.
10. Verify RLS policies are applied correctly with a test query: attempt to read another tenant's data with the affected tenant's DB role.
11. Add tenant binding to session creation: store and verify `tenantId` at both session create and invoke time (already implemented — confirm it was not bypassed).
12. Consider adding a secondary check at the DB layer: pass `tenantId` as a parameterized filter on all hermes tool queries.

---

## Scenario 6 — Gateway DDoS / rate limit exhaustion

**Severity**: P1 High  
**Indicators**: Sustained high request volume, rate-limiter denials dominating audit log, kernel CPU/memory spike, legitimate users unable to invoke tools.

**Immediate response (0–15 min)**

1. Identify source IPs from access logs (Hono/reverse proxy logs).
2. Block identified IPs at the reverse proxy or infrastructure level (nginx, Cloudflare, AWS WAF).
3. Temporarily lower the rate limit window: reduce `rateLimiter({ windowMs, max })` in `hermes-routes.ts` and restart.
4. If the attack is distributed, enable circuit breaker mode: return 503 for all Hermes requests until pressure drops.

**Investigation**

5. Determine whether the attack is targeting Hermes specifically or the entire kernel API surface.
6. Check whether the attacker holds valid API keys (amplified attack) or is hitting unauthenticated routes.
7. Review request patterns for tool preference — if targeting expensive tools, prioritize those in the deny-list temporarily.

**Remediation**

8. Implement IP-level rate limiting at the infrastructure boundary (not just in-process).
9. Add CAPTCHA or proof-of-work for unauthenticated session creation endpoints.
10. Enable request body size limits if not already set on the Hono server.
11. Consider moving Hermes behind an API gateway with DDoS protection (e.g., Cloudflare, AWS API Gateway).

---

## Scenario 7 — Secret leaked in Hermes response

**Severity**: P0 Critical  
**Indicators**: Audit records or response logs containing plaintext secrets (API keys, passwords, tokens) not matching any redaction pattern, user reports of secrets in tool output.

**Immediate response (0–15 min)**

1. Disable Hermes immediately: `HERMES_ENABLED=false` + kernel restart.
2. Rotate the exposed secret(s) immediately — do not wait for investigation.
3. Identify the tool invocation that produced the leak from audit records.
4. Revoke the API key of the actor who received the response.

**Investigation**

5. Determine which regex in `REDACT_PATTERNS` failed to match the secret format.
6. Check whether the secret was embedded in a structured response (JSON, YAML) that the current string-based redaction missed.
7. Assess how many invocations returned the unredacted secret.

**Remediation**

8. Add the new secret pattern to `REDACT_PATTERNS` in `hermes-service.ts`.
9. Add a corresponding unit test to `p12-hermes.test.ts` covering the new pattern.
10. Consider switching from string-based redaction to structured deep-scan for known secret key names (e.g., any JSON key containing `password`, `token`, `secret`, `key`).
11. Re-enable Hermes only after the patch is deployed and tested.
12. Notify the affected actor and advise them to rotate any credentials they may have received.

---

## Post-Incident Checklist

After any P0 or P1 incident:

- [ ] Timeline documented (first detection → containment → resolution)
- [ ] Root cause identified and documented
- [ ] Affected resources inventoried (keys, sessions, data, tenants)
- [ ] Remediation steps verified in staging before production re-enable
- [ ] Patch deployed (if code change required)
- [ ] Affected parties notified (users, tenants, security team)
- [ ] Post-mortem written within 48 hours (P0) or 5 days (P1)
- [ ] Follow-up tasks created in backlog
- [ ] Playbook updated if new scenario discovered

---

## Contacts

| Role | Contact |
|------|---------|
| Platform Security Lead | security@oscorpex.internal |
| On-call Engineer | oncall@oscorpex.internal |
| Data Protection Officer | dpo@oscorpex.internal |

---

*This playbook is a living document. Update it after every incident where a gap or improvement is identified.*
