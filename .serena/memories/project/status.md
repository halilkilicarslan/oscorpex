# Oscorpex — Status

## Current: v2.5 — Security, GitHub PR, Token Analytics, Budget

### Session 2026-04-12 — Gap Closure (Faz 1-3)

**Faz 1 — Security Layer:**
- `capability-resolver.ts`: role-based tool restrictions, DB capabilities → CLI allowedTools
- `secret-vault.ts`: AES-256-GCM API key encryption (OSCORPEX_VAULT_KEY env)
- `command-policy.ts`: prompt-level command restrictions per agent role

**Faz 2 — PR Workflow:**
- `github-integration.ts`: Octokit PR creation, SSH/HTTPS remote parsing
- Routes: POST configure, POST create-pr, GET status
- `markCompleted()` → `tryCreatePR()` fire-and-forget, emits `git:pr-created`

**Faz 3 — Modularity:**
- Cache token tracking: `cache_creation_tokens`, `cache_read_tokens` in token_usage
- Per-agent budget: `getAgentCostSummary()`, agent-level check in `startTask()`
- `middleware/policy-middleware.ts`: `budgetGuard()` on execution routes (403 on exceeded)

**New files:** capability-resolver.ts, secret-vault.ts, command-policy.ts, github-integration.ts, middleware/policy-middleware.ts
**Tests:** 74 new (67 unit + 7 integration)

## Previous: v2.4 — Preview System Fixes + Port Conflict Resolution

### Session 2026-04-10 — Preview System + Port Conflicts

**Preview iframe fix:**
- iframe uses direct URL (not proxy) — proxy breaks ES module imports in inline scripts
- API-only detection uses proxy with one-time viewMode setting (apiDetectedOnce ref)
- Service switching: inline badges, backend switchPreviewService() changes proxy target

**Port conflict resolution:**
- `isPortInUse()` via `lsof` + `resolvePort()` in app-runner and runtime-analyzer
- Fixed autoDetect/analyzeProject to always scan root directory
- Port conflict resolution in both startFromConfig (Strategy 1) and startApp (Strategy 2)

**Cross-service API routing:**
- Frontend receives `API_TARGET` env var pointing to backend after port resolution
- IMPORTANT: Only API_TARGET (Vite proxy target), NOT VITE_API_URL (causes CORS)

### Files Modified
- `src/studio/app-runner.ts` — port conflict, API_TARGET env, switchPreviewService, root detection
- `src/studio/runtime-analyzer.ts` — port conflict, root detection fix
- `src/studio/routes.ts` — base tag injection, switch-preview endpoint
- `console/src/pages/studio/LivePreview.tsx` — direct URL iframe, service badges
- `console/src/lib/studio-api.ts` — switchPreviewService API client

### Previous Versions
- **v2.0**: ✅ 12-agent Scrum, DAG pipeline, review loop, drag-drop builder
- **v2.1**: ✅ Runtime system, preview proxy, crash detection, port auto-detect
- **v2.2**: ✅ API Explorer, auto-migration, monorepo workspaces, TS fix, 42 new tests
- **v2.3**: ✅ Review loop fixes — await race conditions, review task stage placement, revision auto-restart
- **v2.4**: ✅ Preview system — direct URL iframe, port conflict resolution, API_TARGET env injection
- **v2.5**: ✅ Security layer, GitHub PR workflow, token analytics, per-agent budget, policy middleware