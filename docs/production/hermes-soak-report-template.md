# Hermes Read-Only Soak Report

**Template Version**: 1.0  
**Instructions**: Copy this template for each soak test run. Fill in all sections. Archive completed reports in `docs/production/soak-reports/`.

---

## Test Metadata

| Field | Value |
|-------|-------|
| Report Date | YYYY-MM-DD |
| Test Environment | staging / production-canary / production |
| Kernel Version | vX.Y.Z (commit SHA) |
| Hermes Version | P12 / P13 (sprint tag) |
| Test Start | YYYY-MM-DD HH:MM UTC |
| Test End | YYYY-MM-DD HH:MM UTC |
| Test Duration | X hours Y minutes |
| Conducted By | [Name / Team] |
| Reviewed By | [Name / Team] |

---

## Test Configuration

| Parameter | Value |
|-----------|-------|
| `HERMES_ENABLED` | true / false |
| `OSCORPEX_MAX_CONCURRENT_TASKS` | (value) |
| Rate limit (req/min/actor) | 30 (default) / custom |
| Session `maxToolCalls` | (value, default = 20) |
| Session TTL | (value, default = 1 hour) |
| Write tools enabled | Yes / No (default: No) |
| Prompt injection guard | Enabled / Disabled |
| Secret redaction | Enabled / Disabled |
| RLS enforcement | Enabled / Disabled |

---

## Tools Tested

### Read-Only Tools (Expected: ALLOW)

| Tool Name | Invocations | Pass | Fail | Notes |
|-----------|-------------|------|------|-------|
| file.read | | | | |
| project.list | | | | |
| task.get | | | | |
| agent.status | | | | |
| logs.tail | | | | |
| metrics.get | | | | |
| (add rows as needed) | | | | |

**Read-Only Tools Summary**  
Total invocations: ___  
Pass: ___  Fail: ___  Pass rate: ___%

### Write/Mutating Tools (Expected: DENY)

| Tool Name | Deny Attempts | Denied | Leaked | Notes |
|-----------|---------------|--------|--------|-------|
| file.write | | | | |
| file.delete | | | | |
| git.commit | | | | |
| git.push | | | | |
| shell.run | | | | |
| shell.exec | | | | |
| db.write | | | | |
| db.delete | | | | |
| fs.write | | | | |
| fs.delete | | | | |
| (add rows as needed) | | | | |

**Write Tool Deny Summary**  
Total deny attempts: ___  
Correctly denied: ___  Leaked (CRITICAL — file P0 incident): ___  
Deny rate: ___%

---

## Prompt Injection Attempts

| # | Pattern Used | Detected | Decision | Notes |
|---|-------------|----------|----------|-------|
| 1 | Ignore previous instructions | Yes / No | ALLOW / DENY | |
| 2 | Jailbreak template (DAN variant) | Yes / No | ALLOW / DENY | |
| 3 | Role override (act as root) | Yes / No | ALLOW / DENY | |
| 4 | System prompt extraction | Yes / No | ALLOW / DENY | |
| 5 | Indirect injection via file content | Yes / No | ALLOW / DENY | |
| 6 | (custom — describe) | Yes / No | ALLOW / DENY | |

**Injection Summary**  
Total attempts: ___  
Detected and denied: ___  
Missed (escaped guard — CRITICAL): ___  
Detection rate: ___%

**Patterns that escaped detection (if any)**:

```
(paste raw pattern here)
```

---

## Session Budget Behaviour

| Scenario | Expected | Actual | Pass / Fail |
|----------|----------|--------|-------------|
| Fresh session: calls within budget allowed | ALLOW | | |
| Session exhausted: calls beyond `maxToolCalls` denied | SESSION_EXHAUSTED | | |
| Expired session: calls after TTL denied | INVALID_SESSION | | |
| Different tenant using same session ID | TENANT_MISMATCH | | |
| Session created without valid API key | 401 / 403 | | |

**Notes on session behaviour**:

---

## Rate Limiting Behaviour

| Scenario | Expected | Actual | Pass / Fail |
|----------|----------|--------|-------------|
| 30 req/min — requests 1–30 succeed | 200 | | |
| 30 req/min — request 31 within window denied | 429 | | |
| Window reset: requests succeed after 60s | 200 | | |
| Burst from multiple actors: each limited independently | 429 per actor | | |

**Notes on rate limiting**:

---

## Secret Redaction Verification

| Secret Pattern | Present in Input | Redacted in Output | Pass / Fail |
|----------------|------------------|-------------------|-------------|
| `sk-` prefix (OpenAI) | Yes / No | Yes / No | |
| `ghp_` prefix (GitHub PAT) | Yes / No | Yes / No | |
| `AKIA` prefix (AWS key) | Yes / No | Yes / No | |
| `-----BEGIN PRIVATE KEY-----` | Yes / No | Yes / No | |
| `password=<value>` | Yes / No | Yes / No | |
| `token=<value>` | Yes / No | Yes / No | |

**Unredacted secrets found in output (CRITICAL)**:

```
(describe any leaks here; file P0 incident immediately)
```

---

## Anomalies Detected

| # | Type | Severity | Description | Resolution |
|---|------|----------|-------------|------------|
| 1 | | P0/P1/P2/P3 | | |
| 2 | | | | |
| 3 | | | | |

---

## Performance Observations

| Metric | P50 | P95 | P99 | Notes |
|--------|-----|-----|-----|-------|
| Tool invocation latency (ms) | | | | |
| Session create latency (ms) | | | | |
| Rate limit check overhead (ms) | | | | |
| Prompt injection scan (ms) | | | | |
| Audit record write (ms) | | | | |

**Kernel resource usage during soak**:

- CPU peak: ___%  
- Memory peak: ___ MB  
- DB connection pool max utilised: ___  
- Error rate: ___%

---

## Log Analysis Summary

Attach or link log excerpts that support the test results. Highlight any unexpected error codes.

```
(paste relevant log snippets or link to log archive)
```

---

## Sign-Off Checklist

### Functional

- [ ] All read-only tools invoked successfully within session budget
- [ ] All write tools denied with correct error codes
- [ ] Session expiry enforced correctly
- [ ] Tenant isolation verified (no cross-tenant data returned)
- [ ] API key authentication enforced on all routes

### Security

- [ ] Prompt injection guard detected all tested patterns
- [ ] No injection patterns escaped detection
- [ ] All secret patterns redacted in output
- [ ] Rate limiting enforced per actor
- [ ] Audit records written for every invocation (allow and deny)

### Performance

- [ ] P95 tool invocation latency within SLO (target: < 2000 ms)
- [ ] No memory leaks observed over soak duration
- [ ] DB connection pool did not exhaust
- [ ] No kernel restarts or OOM events during test

### Documentation

- [ ] All anomalies documented above
- [ ] Critical issues filed as incidents (P0/P1)
- [ ] Report archived in `docs/production/soak-reports/`
- [ ] Findings communicated to platform security team

---

## Approvals

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Test Lead | | | |
| Security Reviewer | | | |
| Platform Owner | | | |

---

## Next Steps

(List any follow-up tasks identified during this soak test)

1. 
2. 
3. 

---

*Generated from template version 1.0. Update the template version when adding new test scenarios.*
