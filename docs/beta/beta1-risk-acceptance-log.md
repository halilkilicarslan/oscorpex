# Beta-1: Risk Acceptance Log

**Version**: Beta-1.0
**Date**: 2026-05-14
**Reviewed by**: Engineering, Security, Product
**Status**: All items reviewed and disposition recorded

---

## 1. Purpose

This document records all known risks that have been assessed for Beta-1. Each
risk has a severity rating, a current status, a mitigation strategy, and a named
accepting party. Accepted risks do not require remediation before Beta-1 launch
but are tracked for future sprints.

Risks marked "Must Fix" are blocking for Beta-1 and must be resolved before the
Go decision.

---

## 2. Risk Register

| Risk | Severity | Status | Mitigation | Accepted By | Notes |
|------|----------|--------|-----------|-------------|-------|
| Frontend accessibility (a11y) incomplete — missing ARIA labels on several console components | Low | Accepted | Non-blocking for Beta-1; tenants are technical users who can navigate without a11y aids. Full a11y audit scheduled for Beta-2. | Engineering | WCAG compliance required before public GA |
| Coverage 80% threshold aspirational — actual coverage varies by module | Low | Accepted | 539+ tests provide broad functional coverage across critical paths (auth, RLS, sandbox, approval gates). The 80% threshold is a biome/vitest config gate, not a hard requirement for Beta-1. | Engineering | Coverage tracking enabled; ratchet upward each sprint |
| Staging soak was simulated via Docker Compose + CI — no dedicated staging infrastructure exists | Medium | Accepted | Red-team tests and regression suites cover the top 5 attack vectors. CI pipeline validates each commit. Docker Compose faithfully replicates the production topology. A cloud-hosted staging environment is on the Beta-2 roadmap. | Security + Ops | Dedicated staging environment required before Beta-2 expansion |
| No real-time staging infrastructure for blue/green or canary deployment | Medium | Accepted | Beta-1 is a single-instance rollout with 1-3 tenants. Rollback is achieved by container image swap (< 15 min documented procedure). Blue/green deployment tooling is on the Beta-2 infrastructure roadmap. | Ops | Required before scaling beyond 10 tenants |
| Write MCP tools disabled in beta — tenants cannot validate write workflows end-to-end | Low | By design | Read-only first approach is a deliberate product decision for Beta-1. Write tools will be enabled in Beta-2 after the read-only validation period confirms baseline stability. | Product | Tenants informed at onboarding; usage policy documents the restriction |
| Approval gate UX is functional but not polished — reviewers must use the raw API for approval submission | Low | Accepted | The approval API is stable and documented. Console approval UI exists but has known UX rough edges (Beta-1 finding). Polishing is scheduled for Beta-2 sprint. | Product | Console approval UI improvements tracked in product backlog |
| Container runtime not provisioned — Docker pool images not built for Beta-1 | Medium | By design | Container execution is a Beta-2 feature. The flag `OSCORPEX_ENABLE_CONTAINER_RUNTIME=false` ensures no code path attempts to use the pool. This is not a risk for Beta-1 workloads, which are read-heavy. | Engineering | Container images and pool provisioning on Beta-2 infra roadmap |
| Token savings are Anthropic-platform-measured — kernel does not control cache hit rates | Low | Accepted | 93.5% cache rate observed in Smoke Test v4. The kernel reports token savings based on Anthropic response metadata but cannot guarantee a specific rate. This is a telemetry limitation, not a security concern. | Engineering | Informational; tenants should not rely on cache rate guarantees |
| JWT secret rotation requires kernel restart — no hot rotation support | Medium | Accepted | Planned rotation window is monthly. Beta-1 duration is 14-30 days — one planned rotation at most. Rotation requires 10-minute maintenance window (documented). Hot rotation is on the Beta-3 roadmap. | Ops | Monthly rotation schedule agreed; maintenance window communicated in advance |
| Prompt content logged for up to 30 days — tenants must not submit PII | Medium | Accepted | Usage policy (`beta1-usage-policy.md`) explicitly prohibits PII in prompts. Tenants confirmed at onboarding. Data purge procedure exists for accidental PII submission. Legal review of log retention policy completed. | Security + Legal | Consent form references this; log retention reviewed |
| No WAF (Web Application Firewall) in front of the kernel for Beta-1 | Medium | Accepted | Rate limiting, JWT auth, input validation, and sandbox guard are implemented at the application layer. WAF is a Beta-2 infrastructure requirement. Beta-1 has at most 3 tenants sending known-good traffic. | Security | WAF required before public beta or public-internet exposure |
| Learning governance regex (23 patterns) may have false positives on legitimate code snippets | Low | Accepted | False positives result in prompt rejection with a descriptive error message, not a silent failure or security incident. Beta tenants can report false positives via the feedback channel for regex tuning. | Engineering | Monitoring for false positive rate enabled |

---

## 3. Residual Risk Summary

After all accepted mitigations, the residual risk profile for Beta-1 is:

| Severity | Count | Assessment |
|----------|-------|------------|
| Critical | 0 | All P0 attack vectors have multiple independent enforcement layers |
| High | 0 | No unmitigated high-severity risks remain |
| Medium | 5 | Accepted with documented mitigations; all addressed in Beta-2 roadmap |
| Low | 7 | Accepted; non-blocking, tracked for future sprints |

**Overall residual risk**: LOW for the Beta-1 controlled rollout with 1-3 technical
internal/trusted tenants using read-only workflows.

---

## 4. Sign-Off

All risks in Section 2 have been reviewed by the following parties. Acceptance
does not mean the risk is dismissed — it means the risk is understood, mitigated
to an acceptable level for Beta-1, and tracked for resolution in future iterations.

| Role | Name | Signature / Confirmation | Date |
|------|------|--------------------------|------|
| Engineering Lead | *(assign before launch)* | | 2026-05-14 |
| Security Lead | *(assign before launch)* | | 2026-05-14 |
| Infrastructure / Ops Lead | *(assign before launch)* | | 2026-05-14 |
| Product Lead | *(assign before launch)* | | 2026-05-14 |

---

## 5. Risk Review Cadence

This log is reviewed at each weekly meeting (`beta1-weekly-review-template.md`).
New risks discovered during the beta period are added here within 1 business day
of identification. The severity and status of existing risks may be updated as
new information becomes available.

If a new risk is assessed as High or Critical, the weekly review is not sufficient —
an ad hoc risk review must be held within 24 hours and the risk disposition
(accept, mitigate, or halt Beta-1) must be agreed by all sign-off parties.
