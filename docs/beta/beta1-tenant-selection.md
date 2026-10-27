# Beta-1: Tenant Selection Guide

**Version**: Beta-1.0
**Date**: 2026-05-14
**Status**: Operational

---

## 1. Purpose

This document defines the criteria, process, and checklist for selecting Beta-1
tenants. Beta-1 is a controlled rollout targeting 1-3 internal or trusted tenants
before any public release. The goal is to validate operational stability, security
controls, and developer experience under real (but low-risk) workloads.

---

## 2. Selection Criteria

### 2.1 Eligibility Requirements

| Criterion | Requirement |
|-----------|-------------|
| User profile | Internal team member or trusted partner with prior API experience |
| Technical literacy | Comfortable reading JSON API responses and reporting structured bugs |
| Data posture | Uses synthetic or test-only data — no production data, no real customer PII |
| Workload risk | Non-critical experiments only; no CI/CD pipelines that block shipping |
| Availability | Can respond to feedback requests within 24 hours |
| Consent | Signed explicit beta consent (see Section 4) |
| Jurisdiction | Same jurisdiction as data residency policy (EU or US depending on deployment) |

### 2.2 Preferred Profile

- **Internal tenants (highest preference)**: Platform engineering team members, QA leads,
  or product managers with direct access to the Slack incident channel.
- **Trusted partners (secondary)**: Integration partners who have previously reviewed
  security documentation and whose use case involves read-heavy workflows.
- **Maximum tenants in Beta-1**: 3. Expanding beyond 3 requires a formal go decision
  from the weekly review (see `beta1-weekly-review-template.md`).

### 2.3 Disqualifying Conditions

The following automatically disqualify a candidate from Beta-1:

- Requires write MCP tools (disabled in Beta-1 by design)
- Expects SLA guarantees (Beta-1 has no SLA)
- Plans to run production traffic through the beta endpoint
- Has not completed the onboarding consent form
- Operates in a regulated environment requiring compliance certification (SOC2, HIPAA)

---

## 3. Risk Assessment Checklist

Complete this checklist for each candidate tenant before approval.

### 3.1 Low-Risk Verification

- [ ] Tenant uses synthetic or test data only
- [ ] No production pipelines depend on the beta endpoint
- [ ] Tenant workload is read-heavy (projects, task inspection, agent session review)
- [ ] Tenant has reviewed the Beta Usage Policy (`beta1-usage-policy.md`)
- [ ] Tenant understands write tools are disabled and will not attempt bypass
- [ ] Tenant has an internal escalation path (not relying on Oscorpex support alone)

### 3.2 Quick Feedback Verification

- [ ] Tenant can participate in weekly sync (see `beta1-weekly-review-template.md`)
- [ ] Tenant has a designated technical point of contact
- [ ] Tenant can submit structured bug reports using the provided template
- [ ] Tenant agrees to respond to urgent queries within 4 business hours

### 3.3 Logging Consent Verification

- [ ] Tenant has been informed that all API calls are logged for analysis
- [ ] Tenant has been informed that prompt content may be retained for up to 30 days
- [ ] Tenant has signed the beta consent form acknowledging logging scope
- [ ] Tenant has reviewed data isolation guarantees (strict RLS, per-tenant workspace)
- [ ] Tenant does not plan to submit any personal data or credentials via the API

---

## 4. Consent Process

### 4.1 Required Consent Acknowledgements

The tenant must explicitly acknowledge:

1. Beta-1 operates without an SLA. Downtime is possible at any time.
2. All operations are logged for security and product analysis.
3. Write tools (MCP write, container execution, Docker socket) are disabled.
4. The platform is in pre-production state; data loss risk exists.
5. The tenant will not attempt to circumvent feature flags or access controls.
6. Feedback participation (weekly sync + bug reports) is expected, not optional.

### 4.2 Consent Format

Consent can be collected via:
- Email confirmation to `platform-beta@oscorpex.internal` with the text
  "I acknowledge the Beta-1 terms outlined in beta1-usage-policy.md"
- GitHub issue comment on the private beta tracking issue
- Signed PDF if the tenant is an external partner

---

## 5. Onboarding Steps

### Step 1: API Key Creation

```bash
# Create a tenant-scoped API key via the admin CLI
# Replace TENANT_ID with the tenant's UUID
pnpm --filter @oscorpex/kernel tsx src/scripts/create-api-key.ts \
  --tenant-id <TENANT_ID> \
  --label "beta1-<tenant-name>" \
  --expires-in 30d \
  --scopes "read:projects,read:tasks,read:agents,write:approvals"
```

Record the generated key ID in the beta tracking spreadsheet. The key itself
is delivered to the tenant via a secure channel (1Password shared vault or
encrypted email).

### Step 2: Rate Limit Configuration

Apply the Beta-1 rate limit profile to the tenant's API key:

| Endpoint group | Limit | Window |
|---------------|-------|--------|
| Hermes sessions | 20 requests | 1 minute |
| Gateway requests | 60 requests | 1 minute |
| General API | 200 requests | 1 minute |
| Auth endpoints | 10 requests | 1 minute |

```bash
# Set rate limit overrides for the tenant
pnpm --filter @oscorpex/kernel tsx src/scripts/set-rate-limits.ts \
  --tenant-id <TENANT_ID> \
  --profile beta1
```

### Step 3: Monitoring Setup

Before the tenant makes their first API call:

- [ ] Verify tenant ID appears in the Grafana tenant filter dropdown
- [ ] Create a tenant-specific Loki log stream filter: `{tenant_id="<TENANT_ID>"}`
- [ ] Set an alert for >10 errors/min from this tenant (escalates to on-call)
- [ ] Add tenant to the beta Slack channel (`#oscorpex-beta-1`)
- [ ] Share the feedback channel and weekly sync calendar invite

### Step 4: First API Call Validation

After onboarding, ask the tenant to run the smoke test:

```bash
# Tenant runs this with their API key
curl -H "Authorization: Bearer <API_KEY>" \
  https://beta.oscorpex.internal/api/studio/projects \
  | jq '.total'
```

Expected: HTTP 200 with a valid JSON response. If this fails, do not proceed.
Investigate before allowing further access.

### Step 5: Feedback Channel Confirmation

- [ ] Tenant has posted a message in `#oscorpex-beta-1` Slack channel
- [ ] Weekly sync calendar invite accepted
- [ ] Tenant has cloned the feedback issue template into their tracking system

---

## 6. Tenant Registry

Maintain this registry as tenants are onboarded:

| Tenant Name | Tenant ID | API Key ID | Onboarded | Contact | Status |
|-------------|-----------|------------|-----------|---------|--------|
| *(pending)* | — | — | — | — | — |

---

## 7. Offboarding

If a tenant exits Beta-1 (by choice, policy violation, or program end):

1. Revoke the API key immediately: `src/scripts/revoke-api-key.ts --key-id <KEY_ID>`
2. Archive tenant logs to cold storage (retain for 90 days minimum)
3. Send offboarding survey
4. Remove from beta Slack channel and monitoring dashboards
5. Update the tenant registry above with "Offboarded" status and date
