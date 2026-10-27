# P6 Selective Write MCP Tools Report

**Date:** 2026-05-15
**Branch:** master
**Scope:** 11 P6 phases — Write tool registry, approval gate, checkpoint before write, file.write, docs.generate, task tools, git.createBranch, rollback dry-run, audit, secret guard, frontend a11y

---

## 1. Summary

P6 delivered selective write MCP tools with the full safety chain: schema validation → policy enforcement → secret guard → checkpoint → approval gate. 5 write tools implemented (file.write, docs.generate, task.comment, task.updateMetadata, git.createBranch), all requiring approval before execution. Write tools are disabled by default and require explicit flags.

**Combined P0-P6: 303 tests, all passing.**

---

## 3. Tools Added

| Tool | Risk | Approval | Checkpoint | Rollback | Status |
|------|------|----------|-----------|----------|--------|
| `file.write` | write | Required | filesystem+git | dry-run | Implemented |
| `docs.generate` | write | Required | filesystem | dry-run | Implemented |
| `task.comment` | write | Required | task-state | dry-run | Implemented |
| `task.updateMetadata` | write | Required | task-state | dry-run | Implemented |
| `git.createBranch` | write | Required | git | dry-run | Implemented |

## 4. Tools Explicitly Denied

```
file.delete, shell.run, git.commit, git.push, git.reset, git.checkout,
network.fetch, container.run, db.mutate, credential.read, deploy.run
```

---

## 6. Code Changes

| File | Change |
|------|--------|
| `mcp-bridge/write-tool-registry.ts` | NEW — write tool registry + areWriteToolsEnabled() |
| `mcp-bridge/secret-guard.ts` | NEW — 13 secret patterns + checkForSecrets + redactForAudit |
| `mcp-bridge/write-tools.ts` | NEW — 5 write tool handlers with Zod schemas |
| `mcp-bridge/mcp-bridge.ts` | invokeMcpWriteTool + write tool listing |
| `mcp-bridge/protocol/json-rpc.ts` | Write tool routing in tools/call |
| `vitest.p6.config.ts` | NEW — P6 test config |
| `.github/workflows/ci.yml` | P6 test suite added |

---

## 7-11. Impact Summary

| Area | Status |
|------|--------|
| **Checkpoint** | Every write creates checkpoint before execution |
| **Approval** | Every write returns REQUIRES_APPROVAL — no auto-execute |
| **Rollback** | Checkpoint enables rollback dry-run for all write tools |
| **Policy** | enforceToolPolicy() called before every write |
| **Secret Guard** | 13 patterns block API keys, tokens, private keys in content |
| **Audit** | recordMcpAudit for allow/deny/approval decisions |

---

## 12. Frontend Accessibility

**Status:** Deferred to P7
- 153 focus:outline-none remain
- 11 alert() calls remain
- Backend security priority maintained through P0-P6

---

## 13. Tests

| Suite | Tests |
|-------|-------|
| P0 | 12 |
| P1 | 57 |
| P2 | 76 |
| P3 | 14 |
| P4 | 34 |
| P5 | 23 |
| P6 | 64 |
| Policy-kit | 23 |
| **Total** | **303** |

---

## 14. Commands

```
pnpm typecheck  # OK
pnpm build      # OK (4905 KB, 96 files)
P0-P6 + PK      # 303/303 passed
```

---

## Final Decision

1. **Safer?** YES
2. **Write tools with full chain?** YES — validate → policy → secret guard → checkpoint → approval
3. **Write tools disabled by default?** YES — requires OSCORPEX_ENABLE_MCP_WRITE_TOOLS=true
4. **Production blocked?** YES — requires additional OSCORPEX_ALLOW_MCP_WRITE_IN_PROD=true
5. **Unknown write tools denied?** YES
6. **Secret content blocked?** YES — 13 patterns
7. **All writes checkpointed?** YES
8. **All writes require approval?** YES — no auto-execution
9. **Rollback available?** YES — via checkpoint
10. **Can full MCP protocol start?** YES — read-only stable + selective write with approval
11. **Can Hermes/gateway start?** CAUTIOUSLY — write tools need production testing first
12. **Top 10 next:** Frontend a11y, production testing, write approval UI, Hermes evaluation, coverage 55%, deployment guide, monitoring, memory pruning, DinD, per-project volumes
