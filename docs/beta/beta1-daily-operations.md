# Beta-1: Daily Operations Template

**Version**: Beta-1.0
**Date**: 2026-05-14
**Owner**: On-Call Engineer

---

## Purpose

This template defines the daily operational tasks for the Beta-1 period. The on-call
engineer completes this checklist each day and posts a brief status summary to
`#oscorpex-beta-1` by end of business.

Use one copy of this template per day. Archive completed copies in the beta
tracking folder for the weekly review.

---

## Daily Operations Log — [YYYY-MM-DD]

**On-Call Engineer**: _______________
**Shift Start**: _______________
**Beta Day**: _______________ (Day X of Beta-1)

---

## Morning Check (complete by 09:00 local time)

### Health and Availability

- [ ] Kernel health check: `curl http://localhost:3141/healthz` → HTTP 200
- [ ] Database connectivity: `psql $DATABASE_URL -c "SELECT 1"` → returns 1
- [ ] Console reachable: `curl http://localhost:5161` → HTTP 200
- [ ] WebSocket port responsive: `curl http://localhost:3142` → expected response

**Health status**: Healthy / Degraded / Down

*If degraded or down, open a P1 incident and follow `beta1-alert-escalation.md`.*

### Overnight Alerts Review

Review PagerDuty and Slack `#oscorpex-incidents` for any overnight alerts:

- [ ] No P0 alerts fired overnight
- [ ] No P1 alerts fired overnight
- [ ] P2 and P3 alerts reviewed and documented below

**Overnight alerts (if any)**:

| Alert | Time | Severity | Resolved? | Action |
|-------|------|----------|-----------|--------|
| | | | | |

### Security Check (Morning)

- [ ] Review authentication failure count from last 24 hours (Grafana → Security Dashboard)
  - Count: _____ (threshold: < 20/min per tenant before alerting)
- [ ] Review prompt injection detections from last 24 hours
  - Count: _____ (any detection requires Security Lead notification)
- [ ] Confirm feature flags still at correct values (sample check):
  ```bash
  curl -s http://localhost:3141/api/studio/terminal/exec | jq '.error'
  # Expected: "not found" or "feature disabled"
  ```
- [ ] No unusual entries in audit_events table from overnight

---

## Midday Check (complete between 12:00–14:00 local time)

### Performance Metrics

Pull from Grafana for the current day (00:00 to now):

| Metric | Current Value | Target | Status |
|--------|--------------|--------|--------|
| Error rate | | < 1% | OK / WARNING / CRITICAL |
| p50 latency | | < 500ms | OK / WARNING / CRITICAL |
| p99 latency | | < 5000ms | OK / WARNING / CRITICAL |
| DB pool utilization | | < 80% | OK / WARNING / CRITICAL |
| Heap memory | | < 1.5 GB | OK / WARNING / CRITICAL |

**Performance status**: Normal / Degraded *(if degraded, document below)*

### Active Tenant Activity

- [ ] Check tenant activity in Grafana (API calls per tenant for today)
- [ ] Any tenant showing unusual activity patterns? (sudden spike or complete silence)
- [ ] All active tenants' rate limits within normal range (no 429 spikes)

**Tenant activity notes**:
*...*

### Midday Agent Pipeline Review

- [ ] No pipelines stuck in RUNNING state for > 2 hours without progress
- [ ] Task completion rate: _____ tasks completed since midnight
- [ ] No budget guard circuit breaker trips
- [ ] No watchdog timeout events

---

## End-of-Day Check (complete by 18:00 local time)

### Daily Metrics Summary

Complete these metrics for the full day (pull from Grafana):

| Metric | Today | Yesterday | Delta |
|--------|-------|-----------|-------|
| Total API requests | | | |
| Error rate | | | |
| Agent sessions started | | | |
| Agent sessions completed | | | |
| Rate limit hits | | | |
| Auth failures | | | |
| Prompt injection detections | | | |
| Approval submissions | | | |

### Security End-of-Day Review

- [ ] Audit event stream active (check for events in last 60 minutes)
- [ ] No cross-tenant data access attempts logged
- [ ] No write tool endpoint access attempts
- [ ] Prompt injection detections reviewed and cleared (or escalated to Security Lead)
- [ ] All active beta API keys confirmed valid and not compromised

### Tenant Check

For each active beta tenant, confirm:

- [ ] Tenant 1: API key active, last request within expected timeframe
- [ ] Tenant 2 (if applicable): API key active, last request within expected timeframe
- [ ] Tenant 3 (if applicable): API key active, last request within expected timeframe
- [ ] Any feedback submissions today → triaged and acknowledged

### Log Review

Scan kernel logs for today (Loki query: `{app="oscorpex-kernel"} | level="error" | level="warn"`):

- [ ] No ERROR entries that were not caught by an alert
- [ ] No WARN entries indicating systemic issues
- [ ] No unexpected entries from modules: `sandbox-manager`, `rls-guard`, `budget-guard`

**Notable log entries today**:
*...*

---

## End-of-Day Status Post

Post the following to `#oscorpex-beta-1` Slack channel:

```
[Beta-1 Daily Status — YYYY-MM-DD — Day X]

Health: [Healthy / Degraded]
Error rate: [X.X%]
Incidents: [None / P2: description / P1: description]
Tenant activity: [Normal / Notable: description]
Alerts: [None / describe any alerts triggered]

Action items for tomorrow: [None / list items]
```

---

## Shift Handoff

Complete before handing off to the next on-call engineer:

- [ ] Status post sent to `#oscorpex-beta-1`
- [ ] Any open incidents documented with current status
- [ ] Any in-progress investigations handed off with context notes
- [ ] Tomorrow's on-call engineer notified of any watchpoints
- [ ] This daily log archived in the beta tracking folder

**Handoff notes for next on-call**:
*...*

---

## Weekly Metrics Accumulator

*Keep a running tally here for the weekly review. Update after each end-of-day check.*

| Day | Error Rate | API Requests | Incidents | Notable |
|-----|-----------|-------------|-----------|---------|
| Day 1 | | | | |
| Day 2 | | | | |
| Day 3 | | | | |
| Day 4 | | | | |
| Day 5 | | | | |
| Day 6 | | | | |
| Day 7 | | | | |
| **Week Total** | | | | |
