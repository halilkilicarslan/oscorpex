# P5 Read-Only MCP Protocol Server Report

**Date:** 2026-05-15
**Branch:** master
**Scope:** 7 P5 phases — MCP protocol server, audit logging, graph checkpoint, file audit, Zod completion, coverage ratchet, frontend a11y plan

---

## 1. Summary

P5 delivered a fully operational read-only MCP protocol server with JSON-RPC 2.0 support, audit logging, graph-coordinator checkpoint wiring, file policy audit validation, integration route Zod wiring, and coverage threshold ratchet to 50%.

**Combined test count P0-P5: 239 tests, all passing.**

---

## 3. Issues Fixed

### P5-A: MCP Protocol Server
- **Status:** Fixed
- **Files:** `mcp-bridge/protocol/json-rpc.ts` (NEW), `routes/mcp-routes.ts` (NEW), `routes/index.ts`
- **Tests:** 6 protocol tests
- **Behavior:** `POST /mcp/invoke` accepts JSON-RPC 2.0, supports `tools/list` + `tools/call`. `GET /mcp/tools` convenience endpoint. Rate limited 100 req/min. Tenant/project scoped via headers.

### P5-B: MCP Audit Logging
- **Status:** Fixed
- **Files:** `mcp-bridge/mcp-audit.ts` (NEW), `mcp-bridge/mcp-bridge.ts`
- **Tests:** 3 audit tests
- **Behavior:** Every MCP invocation produces `McpAuditEvent` with UUID, structured log, and event bus emission. Denied invocations also audited.

### P5-C: Graph Coordinator Checkpoint
- **Status:** Fixed
- **Files:** `graph-coordinator.ts`
- **Tests:** 2 source inspection tests
- **Behavior:** `createCheckpoint()` called before insertNode, splitTask, addEdge mutations. Non-blocking with try/catch.

### P5-D: File Policy Audit
- **Status:** Fixed
- **Tests:** 3 source inspection + 1 route audit test
- **Behavior:** docs-generator uses enforceFilePolicy. No route handler directly writes files. workspace-resolver validates all paths.

### P5-E: Remaining Zod Wiring
- **Status:** Fixed
- **Files:** `routes/integration-routes.ts`
- **Tests:** 5 schema validation tests
- **Behavior:** Webhook POST/PUT in integration-routes now use strict Zod schemas. All critical mutation routes now protected.

### P5-F: Coverage Threshold
- **Status:** Fixed
- **Files:** `vitest.config.ts`
- **Behavior:** Thresholds ratcheted from 45% → 50% (lines/functions/statements) and 40% → 45% (branches).

### P5-G: Frontend Accessibility
- **Status:** Not Fixed (deferred to P6)
- **Reason:** Backend security sprint priority. 153 focus:outline-none + 11 alert() remain.

---

## 13-14. Tests & Commands

| Suite | Tests |
|-------|-------|
| P0 | 12 |
| P1 | 57 |
| P2 | 76 |
| P3 | 14 |
| P4 | 34 |
| P5 | 23 |
| Policy-kit | 23 |
| **Total** | **239** |

```
pnpm typecheck  # OK
pnpm build      # OK (4889 KB, 96 files)
All P0-P5 + PK  # 239/239 passed
```

---

## Final Decision

1. **Safer?** YES
2. **MCP protocol server?** YES — JSON-RPC 2.0 over HTTP
3. **Transports?** HTTP JSON-RPC (stdio deferred)
4. **All tools read-only?** YES
5. **Unknown tools denied?** YES
6. **All invocations policy-gated?** YES
7. **All invocations audited?** YES
8. **File paths workspace-scoped?** YES
9. **Write-capable tools?** NO
10. **Graph checkpointed?** YES — insertNode, splitTask, addEdge
11. **File write paths policy-gated?** YES — critical paths
12. **Zod complete?** YES — all critical mutation routes
13. **Coverage 50%?** YES — threshold set
14. **Selective write MCP next?** YES — with checkpoint + approval
15. **Hermes/gateway/scheduler?** NOT YET — checkpoint coverage needs broadening
16. **Top 10:** Selective write MCP tools, frontend a11y, memory pruning, secret guard, Hermes evaluation, coverage 55%, deployment guide, DinD, per-project volumes, production hardening guide
