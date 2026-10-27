# Beta-1: Weekly Review Template

**Version**: Beta-1.0
**Date**: 2026-05-14

---

Copy this template for each weekly review. Fill in all sections before the review
meeting. The review owner sends the completed document to all participants at
least 2 hours before the meeting.

---

## Weekly Review — Week N

**Review Date**: _______________
**Review Owner**: _______________
**Participants**: _______________
**Period Covered**: _______________ to _______________
**Beta Day**: _______________ (Day X of Beta-1)

---

## 1. Security Events Summary

*Describe any security-relevant events during the week. If none, write "No security events this week."*

| Event | Date/Time | Severity | Tenant | Resolution | Status |
|-------|-----------|----------|--------|------------|--------|
| | | | | | |

**Prompt Injection Detections**: _____ (count)
*Detail any detections with the tenant, prompt excerpt (redacted), and outcome.*

**Authentication Failures**: _____ (count)
*Were any failures anomalous? Any patterns suggesting brute force or credential stuffing?*

**Feature Flag Bypass Attempts**: _____ (count)
*Any attempts to access disabled endpoints (terminal/exec, MCP write)?*

**Overall Security Assessment**:
- [ ] No security concerns — proceed normally
- [ ] Minor concerns — noted, no action required
- [ ] Concerns requiring investigation — assign owner and ETA
- [ ] P0/P1 incident this week — see incident report [link]

---

## 2. Operational Metrics

*Pull these from Grafana for the review period.*

| Metric | Week N | Week N-1 | Target | Status |
|--------|--------|----------|--------|--------|
| Overall error rate | | | < 1% | |
| p50 response latency | | | < 500ms | |
| p99 response latency | | | < 5000ms | |
| Uptime | | | > 99% | |
| DB pool peak utilization | | | < 80% | |
| Kernel peak heap (MB) | | | < 1500 | |
| Active tenants | | | — | |
| Total API requests | | | — | |
| Agent sessions started | | | — | |
| Agent sessions completed | | | — | |
| Approval submissions | | | — | |

**Operational Assessment**:
- [ ] All metrics within target — proceed normally
- [ ] Some metrics outside target — explain and assign owner
- [ ] Critical metric threshold crossed — evaluate pause/rollback

---

## 3. Error Rate Trends

*Describe the error pattern. Are errors concentrated on specific endpoints, tenants, or time windows?*

**Top 5 Error Types This Week**:

| Error Code | Count | Endpoint | Root Cause | Fixed? |
|------------|-------|----------|------------|--------|
| | | | | |

**Error Trend**: Increasing / Stable / Decreasing *(circle one)*

**Notable Errors**:
*Describe any errors that required manual investigation or have not yet been resolved.*

---

## 4. Rate Limit Analysis

| Tenant | Hermes 429s | Gateway 429s | API 429s | Assessment |
|--------|-------------|--------------|----------|------------|
| | | | | |

**Rate Limit Assessment**:
- [ ] No unusual rate limit activity
- [ ] Limits appear too tight for legitimate usage — consider adjustment
- [ ] Limits being stressed by aggressive client — contact tenant

*If a tenant is repeatedly hitting limits, document the use case and determine
whether the limit should be adjusted or the tenant educated about backoff strategies.*

---

## 5. Prompt Injection Attempts

*Document any prompt injection events detected by the 23-regex governance layer.*

| Date/Time | Tenant | Agent/Context | Detection Pattern | Action Taken |
|-----------|--------|---------------|-------------------|--------------|
| | | | | |

**Assessment**: Were any detections false positives? Do any regex patterns need tuning?

---

## 6. Tenant Feedback Summary

*Summarize feedback received from each beta tenant this week.*

### Tenant 1: *(name)*

**Bug reports**: _____ submitted, _____ resolved, _____ in progress
**Feature requests**: _____ submitted
**Weekly report received**: Yes / No

Summary of feedback:
*...*

### Tenant 2: *(name, if applicable)*

**Bug reports**: _____ submitted, _____ resolved, _____ in progress
**Feature requests**: _____ submitted
**Weekly report received**: Yes / No

Summary of feedback:
*...*

---

## 7. Action Items

*List all action items from this week. Include items carried forward from last week.*

| # | Action | Owner | Due Date | Status |
|---|--------|-------|----------|--------|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

**Carried forward from last week**:

| # | Action | Owner | Original Due | New Due | Reason for Delay |
|---|--------|-------|-------------|---------|-----------------|
| | | | | | |

---

## 8. Go / Pause / Expand Decision

Complete this section at the end of the review meeting.

### Criteria Assessment

**Expand criteria** (from `beta1-expansion-criteria.md`):
- [ ] 14+ days without P0/P1 incident: *(days since last incident: ___)*
- [ ] Error rate < 1% for the entire week: *(actual: ____%)*
- [ ] Tenant feedback positive overall: *(assessment: ___)*
- [ ] Previous weekly review approved expansion: Yes / No / N/A

**Pause criteria**:
- [ ] P1 incident detected this week: Yes / No
- [ ] Error rate > 5% for > 10 minutes: Yes / No
- [ ] Cross-tenant data access attempt: Yes / No
- [ ] Write tool bypass detected: Yes / No

**Rollback criteria**:
- [ ] P0 incident this week: Yes / No
- [ ] RLS bypass confirmed: Yes / No
- [ ] Secret leaked to external system: Yes / No
- [ ] Uncontrolled write execution: Yes / No

### Decision

**Current Status**: GO / PAUSE / EXPAND / ROLLBACK *(circle one)*

**Rationale**:
*...*

**Next review date**: _______________

**Signed off by**:
- Engineering Lead: _______________ Date: _______________
- Security Lead: _______________ Date: _______________
- Product Lead: _______________ Date: _______________
