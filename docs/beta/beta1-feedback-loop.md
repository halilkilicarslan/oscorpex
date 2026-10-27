# Beta-1: Feedback Loop

**Version**: Beta-1.0
**Date**: 2026-05-14
**Status**: Operational

---

## 1. Feedback Channels

Beta-1 tenants can submit feedback through any of the following channels. Use
the channel that best matches the type of feedback:

| Channel | Use For | Response Time |
|---------|---------|--------------|
| GitHub Issues (private beta repo) | Bug reports, reproducible issues | 1 business day |
| Slack `#oscorpex-beta-1` | Quick questions, general feedback | Within 4 hours |
| Email `platform-beta@oscorpex.internal` | Sensitive issues, policy questions | 1 business day |
| Weekly sync meeting | Discussion, complex issues, roadmap questions | At next sync |

**GitHub repository**: `oscorpex/beta-feedback` (private; access granted at onboarding)

**Slack workspace**: `oscorpex.slack.com` (invite sent at onboarding)

---

## 2. Bug Report Template

Use this template for all bug reports submitted via GitHub Issues. Complete all
sections. Incomplete reports may be returned to the reporter for clarification
before triage begins.

```markdown
## Bug Report

**Date**: YYYY-MM-DD
**Reporter**: (your name and tenant name)
**Severity**: Critical / High / Medium / Low

### Summary
One-sentence description of the bug.

### Steps to Reproduce
1. Step one
2. Step two
3. ...

### Expected Behaviour
What you expected to happen.

### Actual Behaviour
What actually happened. Include error messages and response bodies.

### Request Details
- HTTP Method + Path: (e.g., POST /api/studio/projects)
- Request headers: (redact Authorization token)
- Request body: (redact any sensitive values)
- Response status: (e.g., 500)
- Response body: (full response if applicable)

### Environment
- API key label: (e.g., beta1-internal-1)
- Time of occurrence: (ISO 8601 with timezone)
- Any recent changes to how you are calling the API?

### Logs
If you have access to relevant log output, attach it here. Redact any secrets,
PII, or credentials before attaching.

### Workaround
If you found a workaround, describe it here. This helps us prioritise a fix.

### Additional Context
Any other information that might help us reproduce the issue.
```

---

## 3. Feature Request Template

Use this template for feature requests submitted via GitHub Issues. Label the
issue `feature-request` when creating it.

```markdown
## Feature Request

**Date**: YYYY-MM-DD
**Reporter**: (your name and tenant name)
**Priority (your assessment)**: Critical / High / Medium / Low / Nice-to-have

### Problem Statement
Describe the problem you are trying to solve. What are you unable to do today
that this feature would enable?

### Proposed Solution
Describe your proposed solution or feature. Be as specific as possible. Include
example API calls, UI mockups, or configuration examples if relevant.

### Alternatives Considered
What alternatives have you considered? Why do they not meet your needs?

### Use Case
Describe a specific scenario in which you would use this feature. Include
approximate frequency (how often would you use this per day/week?).

### Impact if Not Implemented
What will you do if this feature is not available? Will you be blocked? Can you
work around it?

### Additional Context
Any other information relevant to this request.
```

---

## 4. Weekly Sync Schedule

### 4.1 Meeting Details

- **Frequency**: Weekly, every Monday
- **Duration**: 60 minutes
- **Time**: (to be set at onboarding based on tenant timezone)
- **Format**: Video call (link shared at onboarding)
- **Facilitator**: Product Lead (rotating)
- **Notes owner**: Platform Engineering (rotating)

### 4.2 Agenda Template

```
1. [5 min]  Open — attendance, agenda review
2. [10 min] Security events and operational metrics recap
3. [15 min] Tenant feedback: bugs, feature requests, blockers
4. [10 min] Platform team updates: fixes deployed, features in progress
5. [10 min] Q&A and open discussion
6. [5 min]  Action items and decisions
7. [5 min]  Close — confirm next meeting date
```

### 4.3 Attendance Policy

- Tenant technical point of contact: required
- Product Lead: required
- On-call engineer: required (can dial in for 10 minutes if busy)
- Security Lead: optional (required if security events this week)

If a tenant cannot attend, they must send a written update to
`platform-beta@oscorpex.internal` by Sunday evening covering:
- What they tested this week
- Any bugs or issues encountered
- Any blockers for the next week

---

## 5. Feedback Triage Process

All feedback items (bugs and feature requests) go through this triage process:

### Step 1: Receipt (within 4 hours of submission)

- Acknowledge the submission in the original channel
- Apply the appropriate GitHub label: `bug`, `feature-request`, `question`, `policy`
- Assign a severity/priority label: `critical`, `high`, `medium`, `low`
- Tag the issue with the beta tenant name label

### Step 2: Initial Triage (within 1 business day)

- Engineering Lead reviews the issue
- For bugs: Can we reproduce it? Is it a Beta-1 specific issue or a pre-existing issue?
- For feature requests: Does it fit the Beta-1 scope? Is it a known backlog item?
- Assign to an engineer or escalate to the weekly review if complex

### Step 3: Investigation (timeline depends on severity)

| Severity | Investigation Start | Resolution Target |
|----------|--------------------|--------------------|
| Critical | Within 2 hours | Within 24 hours |
| High | Within 1 business day | Within 1 week |
| Medium | Within 3 business days | Next sprint |
| Low / Nice-to-have | Weekly review | Backlog |

### Step 4: Resolution and Communication

- Update the GitHub issue with findings and resolution
- If a fix was deployed, include the deployment timestamp and the Git SHA
- Request the tenant to verify the fix in their next session
- Close the issue only after the tenant confirms the fix or after 5 business days
  without a response

---

## 6. Feedback Analytics

At each weekly review, the Product Lead prepares a feedback summary covering:

- Total bugs submitted vs. resolved vs. in progress
- Top 3 feature requests by tenant vote/priority
- Recurring themes across multiple reports (signals a systemic issue)
- Feedback response time metrics (are we meeting our SLOs?)
- Tenant engagement score (are all tenants submitting feedback?)

This summary feeds directly into the weekly review template
(`beta1-weekly-review-template.md`) Section 6.

---

## 7. Feedback to Roadmap

Feature requests and pain points identified during Beta-1 feed into the product
roadmap via this process:

1. All feature requests are labelled and tracked in the beta feedback repo
2. At each weekly review, the top 3 requests are discussed
3. Items approved for the roadmap are transferred to the main product backlog
4. Items deferred for post-beta are documented in the beta final report
   (`beta1-final-report-template.md`)
5. Beta tenants are notified when their requests are accepted into the roadmap
