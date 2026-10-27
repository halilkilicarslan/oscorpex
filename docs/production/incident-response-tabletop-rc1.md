# RC1-N: Incident Response Tabletop Exercises

**Version**: 1.0
**Date**: 2026-05-14
**Scope**: 5 scenarios covering the most critical failure modes for Oscorpex RC1
**Audience**: Platform engineers, security team, on-call rotation

---

## How to Use This Document

Each scenario describes a realistic incident. During a tabletop exercise, the
facilitator reads the **Trigger** aloud. Participants walk through each phase
(Detection, Containment, Recovery, Post-Incident) before the facilitator reveals
the **Expected Outcome**.

Run tabletop exercises:
- Before RC1 production launch (all 5 scenarios)
- Quarterly thereafter (rotate 2–3 scenarios per session)
- Immediately after any real P0/P1 incident (re-run the matching scenario)

---

## Scenario 1: API Key Compromise

### Trigger

A developer reports that an Oscorpex API key has been posted publicly to a GitHub
repository. The key grants access to a production tenant. The post has been live
for approximately 2 hours.

### Detection

**Expected signals:**
- Unusual request volume from an unfamiliar IP in the rate-limit hit log
- Auth audit events with `actorId` of the compromised key accessing unexpected
  endpoints at unusual hours
- Alert: `API key brute force` fires if attacker probes limits

**Detection checklist:**
- [ ] Check `audit_events` for the compromised `actorId` over last 24h
- [ ] Check `hermes_sessions` for sessions created with this API key
- [ ] Review `mcp_audit_logs` for any write-tool invocations under this key
- [ ] Identify all tenantIds accessed by this key

### Containment

**Immediate actions (< 15 min):**

1. Revoke the API key via `DELETE /auth/api-keys/{keyId}` or direct DB update:
   ```sql
   UPDATE api_keys SET revoked = true, revoked_at = NOW()
   WHERE key_hash = '<hash_of_compromised_key>';
   ```
2. Terminate all active Hermes sessions created by this key:
   ```sql
   UPDATE hermes_sessions SET status = 'revoked', ended_at = NOW()
   WHERE api_key_id = '<key_id>' AND status = 'active';
   ```
3. Block the attacker IP at the load balancer / WAF level if identified.
4. Notify affected tenant of the compromise.
5. Check for any data accessed via read tools — assess exposure scope.

**Secondary actions (< 1 hr):**

- Review all write-tool invocations for the compromised key (should be 0 if
  write tools are disabled, but verify).
- Check if attacker created any additional API keys under the tenant.
- Rotate JWT_SECRET if the key was used to forge tokens.

### Recovery

1. Issue new API key to the legitimate tenant.
2. Update `.gitignore` and secret scanning for the affected repository.
3. Enable enhanced logging for the tenant for 7 days post-incident.
4. Confirm all scheduler jobs that ran during compromise window used correct tenant
   scoping (RLS check).

### Post-Incident Review

- **Within 24 hr**: File incident report in `#oscorpex-incidents`.
- **Within 48 hr**: Post-mortem with timeline, root cause, and remediation.
- **Action items**: Consider API key rotation reminders, automated secret scanning
  in CI, and key expiry enforcement.

### Expected Outcome

Compromise is contained within 15 minutes. No write operations executed (enforced
by policy). Attacker accessed read-only data scoped to one tenant (RLS enforced).
New API key issued; affected tenant notified.

---

## Scenario 2: Cross-Tenant Data Access

### Trigger

A customer reports seeing project data from a different organisation in their
console UI. A `tenant_mismatch` audit event has fired in the alerting system.

### Detection

**Expected signals:**
- `tenant_mismatch` audit event → P0 alert fires immediately
- Console frontend shows project names or task content not belonging to the
  reporting tenant
- DB query returns rows where `tenant_id != current_setting('app.tenant_id')`

**Detection checklist:**
- [ ] Confirm `tenant_mismatch` event details: which tenants, which endpoint
- [ ] Run RLS verification query:
  ```sql
  SELECT tablename FROM pg_policies
  WHERE qual NOT LIKE '%tenant_id%' AND schemaname = 'public';
  ```
- [ ] Check if RLS was temporarily bypassed (e.g., superuser connection used
  for application query)
- [ ] Review the specific DB query that returned cross-tenant data

### Containment

**Immediate actions (< 5 min — P0, halt service if necessary):**

1. If RLS is confirmed bypassed, immediately halt the affected route:
   - Set `OSCORPEX_MAINTENANCE_MODE=true` if available, or
   - Remove the affected route from the load balancer
2. Kill all active sessions for both affected tenants:
   ```sql
   UPDATE hermes_sessions SET status = 'revoked' WHERE tenant_id IN ('<a>', '<b>');
   ```
3. Notify both tenants of the incident (regulatory requirement).
4. If a superuser connection was used for application queries, revoke it and
   rotate credentials.

**Root cause investigation (< 1 hr):**
- Was `SET app.tenant_id` missing in the request handler?
- Was a migration run with superuser that left RLS bypassed?
- Was a new route added without the `requireAuth` middleware?

### Recovery

1. Fix the root cause (missing `SET app.tenant_id`, missing middleware, etc.).
2. Deploy fix to staging; verify RLS with the policy verification query.
3. Deploy to production.
4. Confirm affected data scope: which rows were accessible; assess GDPR/SOC2
  notification obligations.
5. Re-enable affected routes.

### Post-Incident Review

- **Within 4 hr**: Draft breach notification if personal data was accessed.
- **Within 24 hr**: Full post-mortem; add RLS coverage test for the affected table.
- **Action items**: Automated RLS audit in CI (`SELECT` on `pg_policies` as
  regression test).

### Expected Outcome

Cross-tenant access is detected within seconds by the P0 alert. Service is
partially halted. Root cause identified as missing middleware on a new route.
Fix deployed; both tenants notified. No personal data persisted by attacker.

---

## Scenario 3: Prompt Injection Attack

### Trigger

The Hermes metrics endpoint shows a spike in `injectionDetections`. Review of
audit logs reveals repeated attempts to bypass the read-only guard using novel
encoding techniques (Unicode homoglyphs). One attempt may have reached the tool
invocation layer.

### Detection

**Expected signals:**
- Alert: `Prompt injection spike` fires (> 10 detections in 1 hr)
- Hermes audit events with `injection_detected: true` in rapid succession
- Same `actorId` or IP generating the attempts

**Detection checklist:**
- [ ] Pull injection audit events for the last hour:
  ```sql
  SELECT * FROM mcp_audit_logs
  WHERE payload_hash IS NOT NULL AND action = 'deny'
  AND created_at > NOW() - INTERVAL '1 hour'
  ORDER BY created_at DESC;
  ```
- [ ] Check if any `action = 'allow'` events followed injection attempts
  (would indicate bypass)
- [ ] Review the raw tool arguments for novel encoding patterns

### Containment

**Immediate actions:**

1. If bypass confirmed (allow event after injection attempt):
   - Disable `OSCORPEX_ENABLE_HERMES` immediately.
   - File P0 incident.
2. If no bypass confirmed (all attempts correctly denied):
   - Block the attacker IP / revoke their API key.
   - Increase logging verbosity for Hermes: add raw argument logging temporarily.
3. Extract the novel encoding pattern used.

**Pattern update (within 4 hr if bypass occurred):**

Add the new pattern to `hermes-routes.ts` and `learning-governance.ts`:
```typescript
// Example: Unicode homoglyph pattern
/[іі]gnor[еe]\s+[рp]rev[іi]ous/i,  // Cyrillic i/e variants
```

Deploy updated pattern to staging, run injection test suite, then production.

### Recovery

1. Re-enable Hermes after pattern fix is deployed and tested.
2. Run the full injection test suite (`hermes.test.ts`) in staging.
3. Monitor injection detection rate for 24 hr post-fix.
4. Update `prompt-injection-review-rc1.md` with new pattern.

### Post-Incident Review

- **Within 48 hr**: Document the novel encoding technique.
- **Action items**: Add Unicode normalization (NFD/NFC) to the injection scanner
  as a pre-processing step before pattern matching. Prioritise LLM secondary
  classifier evaluation.

### Expected Outcome

If no bypass: attack contained by existing guard; attacker blocked; new pattern
added. If bypass occurred: Hermes disabled, P0 incident filed, pattern fixed and
redeployed within 4 hr, no persistent data mutation (write tools blocked at policy
layer regardless).

---

## Scenario 4: Service Outage

### Trigger

PagerDuty fires: `DB connectivity failure` alert. `/health/db` is returning 503.
Multiple pipelines are in-flight. The kernel process is alive but cannot reach
PostgreSQL.

### Detection

**Expected signals:**
- `GET /health/db` → `503 Service Unavailable`
- `GET /health` → `{ status: "degraded" }`
- Error logs: `db_connection_error` from all repo modules
- Task execution retries failing immediately (no queue wait, DB error)

**Detection checklist:**
- [ ] Check PostgreSQL server status (container, cloud instance, or managed DB)
- [ ] Check DB connection string (`DATABASE_URL`) is correct
- [ ] Check if DB connection pool is exhausted (pool exhaustion vs server down)
- [ ] Verify network path from kernel to DB (DNS, firewall, VPC routing)

### Containment

**Immediate actions:**

1. Stop accepting new pipeline starts (`/projects/{id}/start` → 503 response).
2. Active in-flight tasks will fail with retry — retry-policy will attempt
   backoff (up to 3 retries, configurable).
3. Notify users: status page update "Database maintenance in progress".

**If DB server is down:**
- Escalate to infrastructure on-call.
- If managed DB (RDS/Cloud SQL): check cloud console for DB instance health.
- If Docker: `docker restart oscorpex-postgres` (development/staging only).

**If pool exhaustion:**
- Check `PGPOOL_MAX` env var.
- Identify long-running queries holding connections:
  ```sql
  SELECT pid, now() - pg_stat_activity.query_start AS duration, query
  FROM pg_stat_activity
  WHERE state = 'active' ORDER BY duration DESC LIMIT 10;
  ```
- Kill runaway queries: `SELECT pg_terminate_backend(<pid>);`

### Recovery

1. Once DB is reachable, `/health/db` returns 200 automatically.
2. In-flight tasks resume from retry-policy backoff.
3. Tasks that exhausted retries (3 attempts) will remain in `failed` state —
   manual re-trigger required via `POST /tasks/{id}/retry`.
4. Pipelines paused by budget-guard (if cost circuit fired) need manual resume.
5. Confirm all scheduler jobs that were mid-run completed successfully.

### Post-Incident Review

- **Within 24 hr**: RCA for DB outage cause.
- **Action items**: Consider read replica for non-critical reads; PgBouncer for
  connection pooling; connection pool health metric in Grafana.

### Expected Outcome

Outage is detected in < 60s by `/health/db` probe. No data corruption. In-flight
tasks retry automatically. Manual re-trigger for exhausted tasks. Recovery time
objective (RTO): < 10 min for a transient DB restart.

---

## Scenario 5: Secret Leak

### Trigger

A Hermes invocation returns a response that contains what appears to be a real API
key. A developer reviewing an audit log has spotted `sk-ant-api03-...` in a tool
response field that should have been redacted. The `secret_leak_detected` P0 alert
fires.

### Detection

**Expected signals:**
- P0 alert: `Secret leak detected` (canary audit miss or manual discovery)
- Raw audit log shows unredacted secret in `response_payload`
- Pattern that should have matched did not (new key format, encoding variant)

**Detection checklist:**
- [ ] Identify which tool invocation leaked the secret (session ID, tool name)
- [ ] Confirm the secret is real (does it authenticate?) — do NOT test in
  production; rotate immediately
- [ ] Identify which secret-guard pattern should have caught it
- [ ] Determine if the same response was delivered to the end user

### Containment

**Immediate actions (< 5 min):**

1. **Revoke the leaked secret immediately** — this is the single most important
   action. Contact the secret's issuing service (Anthropic, GitHub, AWS, etc.)
   and revoke before anything else.
2. Disable the Hermes/Gateway endpoint that produced the leak:
   ```bash
   # Hermes
   OSCORPEX_ENABLE_HERMES=false  # restart kernel
   # Gateway
   OSCORPEX_ENABLE_GATEWAY=false
   ```
3. Purge the leaked secret from audit logs (overwrite with `[REVOKED]`) if
   possible — note this may interfere with forensic investigation; balance with
   legal guidance.
4. Notify the affected tenant immediately.

**Pattern fix (within 2 hr):**

1. Identify why the pattern did not match (new prefix variant, encoding, format
   change).
2. Add the new pattern to `secret-guard.ts`.
3. Deploy to staging with canary test; verify match.
4. Deploy to production.
5. Re-enable the affected endpoint.

### Recovery

1. Confirm the leaked secret has been revoked at the source.
2. Assess scope: how many responses contained the leaked secret? (Check audit log
   `response_payload` for the pattern.)
3. Notify all users who received responses containing the secret.
4. GDPR/SOC2 notification assessment: if the secret granted access to personal
   data, breach notification may be required.
5. Re-run the full secret-guard test suite in staging before re-enabling
   production endpoints.

### Post-Incident Review

- **Within 4 hr**: Confirm secret revoked and endpoint re-enabled.
- **Within 24 hr**: Draft breach notification if required.
- **Within 48 hr**: Full post-mortem; update `secret-redaction-review-rc1.md`.
- **Action items**: Implement canary secret audit mode (inserts known fake secrets
  and verifies redaction) to catch pattern regressions before they reach production.

### Expected Outcome

Leaked secret revoked within 5 minutes. Endpoint disabled within 5 minutes. Pattern
fix deployed within 2 hours. Endpoint re-enabled. Affected tenant notified.
Regulatory notification assessment completed within 24 hr.

---

## Tabletop Facilitator Guide

### Before the Exercise

1. Select 2–3 scenarios appropriate for the team's current sprint.
2. Prepare realistic sample audit log snippets for each scenario.
3. Ensure all participants have read the runbook pointers.

### During the Exercise

1. Read the **Trigger** aloud. Do not reveal the **Expected Outcome**.
2. Ask: "What's the first thing you do?" — look for alert acknowledgement.
3. Walk through Detection → Containment → Recovery → Post-Incident.
4. Note: gaps in knowledge, slow decisions, unclear ownership.

### After the Exercise

1. Compare participant responses to Expected Outcomes.
2. Document gaps as action items.
3. Update this document if runbook steps were unclear or incomplete.

---

## Quick Reference: Escalation Contacts

| Role | Responsibility | Contact Method |
|------|---------------|----------------|
| On-call Engineer | First responder for all P0/P1 | PagerDuty |
| Platform Security | P0 security incidents | `#oscorpex-security` Slack + direct |
| Platform Owner | P0 business decisions (halt service, notifications) | Direct |
| Legal/Compliance | Breach notifications | Email |
| Infrastructure | DB, network, cloud issues | PagerDuty infra team |

---

*Next tabletop exercise scheduled: prior to RC1 production launch.
Subsequent: quarterly. Document owner: Platform Security.*
