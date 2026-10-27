# P1 Verification Notes

## Confirmed
- Docker socket mounted at docker-compose.yml:50 — `/var/run/docker.sock:/var/run/docker.sock`
- 20 files spread `...process.env` to child processes (grep confirmed)
- Shared `repos` volume across backend + agent-1 + agent-2
- Agent network `internal: false` at docker-compose.yml:192
- Only 4 rate-limit rules in routes/index.ts:117-120
- Zero Zod usage in route handlers (only JSON.parse)
- No pre-execution tool policy — command-policy.ts is post-audit only
- No evaluateToolPolicy function existed before this sprint

## Already Fixed (P0)
- Terminal exec gated with allowlist (P0-1)
- LLM-to-shell blocked (P0-2)
- Container heredoc injection fixed (P0-3)
- JWT fallback removed (P0-4)
- Auth bypass explicit (P0-5)
- RLS NULL escape removed (P0-6)
- FORCE RLS added (P0-7)
- REAL→NUMERIC money columns (P0-9)
- Event bus logging (P0-10)
- Verification hard gate (P0-11)

## Not Found
- No existing Zod schemas in routes
- No existing env sanitizer utility
- No existing workspace resolver utility

## Unclear
- credential-vault.ts — Serena hook blocked file read
- Whether DinD is a viable replacement for Docker socket in this architecture

## Files inspected
- docker-compose.yml
- apps/kernel/src/studio/routes/index.ts
- apps/kernel/src/studio/middleware/rate-limiter.ts
- apps/kernel/src/studio/routes/project-crud-routes.ts
- apps/kernel/src/studio/routes/agent-routes.ts
- apps/kernel/src/studio/container-pool.ts
- apps/kernel/src/studio/app-runner/starter.ts
- apps/kernel/src/studio/app-runner/process-manager.ts
- apps/kernel/src/studio/agent-runtime.ts
- apps/kernel/src/studio/task-runners.ts
- apps/kernel/src/studio/routes/terminal-routes.ts
- packages/policy-kit/src/index.ts
- packages/policy-kit/src/tool-policy.ts
- packages/control-plane/src/policy/index.ts
- packages/core/src/domain/policy.ts
