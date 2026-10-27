# Beta-1: Usage Policy

**Version**: Beta-1.0
**Date**: 2026-05-14
**Effective**: Upon tenant onboarding
**Applies to**: All Beta-1 tenants and their users

---

## 1. Overview

This policy defines what Beta-1 tenants may and may not do during the controlled
beta period. The policy is designed to enable meaningful product validation while
maintaining security, stability, and data integrity. Violations may result in
immediate key revocation.

By accepting a Beta-1 API key, the tenant agrees to this policy in full.

---

## 2. Permitted Activities

### 2.1 Read-Only MCP Tools

MCP read tools are available and unrestricted within rate limits. Tenants may:

- List available MCP tools and their schemas
- Execute read-only MCP operations (file listing, directory inspection, search)
- Query agent capabilities and available integrations
- Review MCP tool execution logs and outputs

**Rate limit**: Subject to the general API rate limit of 200 requests/minute.

### 2.2 Project and Pipeline Operations

- Create new projects (subject to rate limits)
- Trigger pipeline execution on a project
- Monitor pipeline progress, task status, and agent sessions
- Review PM-generated plans, task breakdowns, and phase summaries
- Submit approvals for proposed agent actions (owner role only)
- Cancel running pipelines or individual tasks

### 2.3 Agent Session Review

- Inspect agent session logs, step records, and episode history
- Review prompt-response pairs in agent sessions (via the agent session inspector)
- Analyse agent performance metrics and cost breakdowns
- Download session artifacts (read-only)

### 2.4 Git Commit (with approval chain)

Git commit operations are available in Beta-1 with the full approval chain enforced:

1. Agent proposes a commit (task type: `git_commit`)
2. The approval gate fires — the commit is held pending review
3. An `owner`-role user reviews and explicitly approves the commit
4. Only after approval does the commit execute

Direct git commit execution without the approval gate is not possible in Beta-1.
Attempts to bypass the approval gate will be logged and may result in key revocation.

---

## 3. Restricted and Prohibited Activities

### 3.1 Write Tools — Disabled in Beta-1

MCP write tools are disabled in Beta-1 by design. This is a deliberate read-only
first approach. The following operations are unavailable:

- File creation, modification, or deletion via MCP
- Shell command execution via MCP
- Environment variable injection
- Package installation commands via MCP

Attempting to access write tool endpoints will result in a 404 or "feature disabled"
response. Attempting to reverse-engineer or bypass this restriction is a policy
violation and a potential P0 security incident.

### 3.2 Terminal Execution — Disabled

The `/terminal/exec` endpoint is disabled in Beta-1. Interactive terminal access
is not available regardless of role. This endpoint is a P0 RCE vector and will
remain disabled for all beta tenants.

### 3.3 Container Runtime — Disabled

Container execution (Docker-based sandboxing) is not available in Beta-1. The
container pool is not provisioned and the Docker socket is not accessible from
the kernel process.

### 3.4 Production Data Prohibition

Tenants must not submit any of the following via the API:

- Real customer names, emails, or personally identifiable information (PII)
- Financial data, payment card information, or banking credentials
- Healthcare records or medical information
- Login credentials, passwords, or authentication tokens
- API keys or secrets belonging to third-party systems
- Confidential business data from non-beta production systems

**Only synthetic or test data should be used in Beta-1.** If production data is
accidentally submitted, the tenant must notify the beta team within 1 hour so that
the data can be purged from the audit log and database.

### 3.5 Prohibited Behaviours

The following behaviours are explicitly prohibited and will result in immediate
key revocation:

- Attempting to access another tenant's data or workspace
- Fuzzing, penetration testing, or load testing without prior written approval
- Attempting to reproduce or exploit security vulnerabilities beyond reporting them
- Submitting prompts designed to exfiltrate system prompts, configuration, or secrets
- Attempting to force the approval gate to approve without a human review
- Sharing the beta API key with parties who have not signed the consent form
- Automating feedback submissions or synthetic activity to inflate usage metrics

---

## 4. Hermes Subsystem Policy

Hermes is available in Beta-1 with the following constraints:

- **Mode**: Read-only. Hermes may read files, inspect code, and answer questions.
  It may not write files, execute commands, or modify the repository.
- **Session budget**: 50 tool calls per session. Sessions that exhaust the budget
  are terminated gracefully. The tenant is notified via the API response.
- **Rate limit**: 20 Hermes session requests per minute per API key.
- **Prompt content**: All prompts submitted to Hermes are logged for security
  analysis. Do not submit credentials, secrets, or PII in Hermes prompts.

---

## 5. Gateway Subsystem Policy

The Gateway is available in Beta-1 with the following constraints:

- **Mode**: Read-only. Gateway proxies read requests to registered backends.
  Write-through operations are blocked at the Gateway layer.
- **Rate limit**: 60 Gateway requests per minute per API key.
- **Target validation**: Gateway will only proxy to pre-registered backend URLs.
  The tenant cannot register new backend URLs during Beta-1.

---

## 6. Scheduler Policy

The Scheduler is available in Beta-1 for pipeline execution testing:

- Scheduled pipelines are subject to the same rate limits as on-demand pipelines
- Schedules must not run more frequently than once per 15 minutes per project
- Tenants may inspect their schedule configurations but may not modify them via
  the API in Beta-1 (modification requires admin action during this phase)

---

## 7. Logging and Data Retention

### 7.1 What Is Logged

All operations performed by a beta tenant are logged, including:

- Every API request (method, path, status, tenant ID, timestamp)
- The content of every prompt submitted to an agent or Hermes
- Every agent decision, tool call, and tool result
- Every approval submission and outcome
- Every rate limit hit, authentication failure, and access denial

### 7.2 Log Retention

Logs are retained for 90 days. After 90 days, logs are archived to cold storage
and retained for an additional 2 years. Tenants may request a copy of their
own logs by contacting the beta team.

### 7.3 Log Analysis

Platform engineering may analyse beta logs to:

- Identify and fix bugs
- Improve rate limiting and budget policies
- Train and tune the PM agent and other AI components
- Prepare the weekly review report

Log analysis is conducted on anonymised or pseudonymised data where possible.
Prompt content analysis requires explicit approval from the Security Lead.

---

## 8. Feedback Expectations

Participation in feedback activities is expected, not optional. At minimum:

- **Weekly sync**: Attend or send a written update if attendance is not possible
- **Bug reports**: Submit a structured bug report for any reproducible issue
  (template in `beta1-feedback-loop.md`) within 3 business days of discovering it
- **Feature requests**: Submit feature requests via the provided template
- **Weekly report**: Provide a brief weekly usage summary (what was tested, what
  worked, what did not) by end of day every Friday

Tenants who do not engage in feedback for 2 consecutive weeks may have their
beta access paused pending a check-in call.

---

## 9. Policy Violations

### 9.1 Minor Violations

Minor violations (accidental policy misunderstanding, one-time rate limit abuse)
result in:
- A warning message in the beta Slack channel
- Logged in the beta tenant registry

### 9.2 Serious Violations

Serious violations (repeated policy breaches, attempted security bypass, PII
submission) result in:
- Immediate API key revocation
- Notification sent to the tenant's organization
- Incident logged in the audit trail

### 9.3 Critical Violations

Critical violations (deliberate security research without consent, RCE attempt,
cross-tenant data probe) result in:
- Immediate key revocation and tenant suspension
- Potential P0 incident declaration
- Legal review as appropriate

---

## 10. Policy Changes

This policy may be updated during the beta period. Tenants will be notified of
material changes via the `#oscorpex-beta-1` Slack channel with at least 24 hours
notice. Continued use of the beta API after a policy update constitutes acceptance
of the updated terms.
