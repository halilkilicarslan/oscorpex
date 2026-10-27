# P0 Verification Notes

## Confirmed
- SEC-001: `execSync(command)` in terminal-routes.ts:67 — raw user command
- SEC-002: "terminal" not in route-permissions.ts — falls to catch-all
- SEC-003: `extractCliCommands()` → `execSync(cmd)` in task-runners.ts:68,159
- SEC-004: Heredoc `<< 'ENVEOF'` in container-pool.ts:392 — ENVEOF escape
- SEC-006: `authType="none"` bypass in auth-middleware.ts:108-114
- SEC-007: `"oscorpex-dev-secret-change-in-production"` in jwt.ts:15
- DB-001: 17 `tenant_id IS NULL OR` in init.sql RLS policies
- DB-003: `cost_usd REAL` in 4 tables
- DB-004: 14 ENABLE RLS, 0 FORCE RLS
- ARCH-01: 6 `/* subscriber error — ignore */` in event-bus.ts
- VER-001: `strictness === "strict" && hasFileFail` in execution-gates.ts:98

## Not Found / Already Fixed
- Silent catch blocks in kernel (only 1 file: runtime-analyzer/index.ts)
- `as any` count already reduced from 85→19 in prior sprint

## Unclear
- credential-vault.ts — read blocked by Serena hook, could not inspect
- Docker socket mount — infrastructure issue, not code-fixable

## Files inspected
- apps/kernel/src/studio/routes/terminal-routes.ts
- apps/kernel/src/studio/task-runners.ts
- apps/kernel/src/studio/container-pool.ts
- apps/kernel/src/studio/auth/jwt.ts
- apps/kernel/src/studio/auth/auth-middleware.ts
- apps/kernel/src/studio/auth/rbac.ts
- apps/kernel/src/studio/auth/route-permissions.ts
- apps/kernel/src/studio/auth/tenant-context.ts
- apps/kernel/src/studio/event-bus.ts
- apps/kernel/src/studio/execution-gates.ts
- apps/kernel/src/studio/db/project-repo.ts
- apps/kernel/src/studio/db/memory-repo.ts
- apps/kernel/scripts/init.sql
- docker-compose.yml
- .github/workflows/ci.yml
- biome.json
- vitest.config.ts
