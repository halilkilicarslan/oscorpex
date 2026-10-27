# P2 Verification Notes

## Confirmed
- evaluateToolPolicy() only in test file — zero runtime usage before P2
- 16 process.env spreads in 11 files (grep confirmed)
- 30+ routes use raw c.req.json() without Zod validation
- CI has no PostgreSQL service, no coverage thresholds
- No checkpoint/rollback design or implementation
- Zero direct unit tests for event-bus, execution-gates, stage-advance

## Already Fixed (P0+P1)
- Terminal exec allowlisted (P0-1)
- LLM-to-shell blocked (P0-2)
- Container injection fixed (P0-3)
- JWT secret ephemeral (P0-4)
- Auth bypass explicit (P0-5)
- RLS hardened (P0-6/7)
- NUMERIC money (P0-9)
- Event bus logged (P0-10)
- Verification hard gate (P0-11)
- Docker socket removed (P1-1)
- 4 critical env paths sanitized (P1-2)
- Workspace resolver (P1-3)
- Agent network internal (P1-4)
- Global rate limiting (P1-5)
- Zod project+agent schemas (P1-6)
- evaluateToolPolicy created (P1-7)

## Not Found
- No existing tool-policy-enforcer.ts (created in P2-1)
- No existing execution pipeline unit tests (created in P2-2)
- No existing checkpoint design (created in P2-6)

## Unclear
- credential-vault.ts — Serena hook blocked read throughout all sprints

## Files inspected
- packages/policy-kit/src/tool-policy.ts
- packages/policy-kit/src/index.ts
- apps/kernel/src/studio/execution/task-executor.ts
- apps/kernel/src/studio/routes/terminal-routes.ts
- apps/kernel/src/studio/webhook-sender.ts
- apps/kernel/src/studio/app-runner/starter.ts
- apps/kernel/src/studio/container-pool.ts
- apps/kernel/src/studio/event-bus.ts
- apps/kernel/src/studio/execution-gates.ts
- apps/kernel/src/studio/pipeline/stage-advance-service.ts
- apps/kernel/src/studio/security/env-sanitizer.ts
- apps/kernel/src/studio/security/workspace-resolver.ts
- apps/kernel/src/studio/routes/validation-schemas.ts
- .github/workflows/ci.yml
- apps/kernel/vitest.config.ts
- 11 files with process.env spreads (see P2-3 agent report)
