# P12 Hermes Read-Only Prototype Report

**Date:** 2026-05-15
**Branch:** master
**Scope:** 14 P12 phases — Hermes prototype, prompt injection guard, session budget, gateway hardening, coverage 75%

---

## 1. Summary

P12 delivered the Hermes read-only prototype with API key auth, session-based tool budgets, prompt injection detection, rate limiting, audit logging, and response redaction. Gateway hardened with payload size limits. Coverage target 75%.

**Combined P0-P12: 486 tests, all passing.**

---

## Key Deliverables

| Phase | Status | Description |
|-------|--------|-------------|
| P12-A | Fixed | Hermes DB schema (hermes_api_keys, hermes_sessions) with RLS |
| P12-B | Fixed | API key auth via existing middleware |
| P12-C | Fixed | POST /hermes/invoke + /hermes/session + /hermes/tools endpoints |
| P12-D | Fixed | Prompt injection guard (14 patterns) |
| P12-E | Fixed | Session tool call budget (default 100, configurable) |
| P12-F | Fixed | Rate limiting (30 req/min for Hermes) |
| P12-G | Fixed | Read-only tool allowlist (8 tools) |
| P12-H | Fixed | MCP bridge invocation path via existing invokeMcpTool |
| P12-I | Fixed | Outbound secret redaction on all responses |
| P12-J | Fixed | Audit events via recordMcpAudit |
| P12-K | Fixed | GET /hermes/metrics endpoint |
| P12-L | Fixed | Gateway payload size limit (50KB) |
| P12-M | Fixed | Staging/preflight updated for P11+P12 |
| P12-N | Fixed | Coverage threshold → 75% |

---

## Tests

| Suite | Tests | Cumulative |
|-------|-------|-----------|
| P0-P11 | 445 | 445 |
| P12 | 41 | 486 |
| **Total** | **486** | |

---

## Final Decision

1. **Hermes prototype?** YES — read-only, disabled by default, session-budgeted
2. **Prompt injection guard?** YES — 14 patterns
3. **Session budget?** YES — exhausts after max calls, configurable
4. **Hermes write tools?** NO — only read-only
5. **Gateway hardened?** YES — 50KB payload limit
6. **Coverage 75%?** YES — threshold set
7. **Can Hermes write start?** NOT YET — read-only soak period needed first
