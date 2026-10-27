# P3 Verification Notes

## Confirmed
- No checkpoint implementation before P3 (only design doc)
- No rollback mechanism before P3
- git-manager operations not policy-gated
- Zod schemas defined but only 2 route groups wired
- Coverage threshold at 35%
- No MCP bridge design or implementation

## Already Fixed (P0+P1+P2)
- All P0 security fixes intact (terminal, LLM-shell, container, JWT, auth, RLS, money, event-bus, verification)
- All P1 infrastructure fixes intact (Docker socket, env sanitizer, workspace, network, rate limiting, Zod, tool-policy)
- All P2 runtime enforcement intact (policy wiring 5 paths, 76 execution tests, env cleanup, Zod schemas, CI, coverage)

## Not Found
- No existing checkpoint tables in init.sql before P3
- No existing git-file-policy.ts before P3
- No MCP bridge package or design

## Unclear
- credential-vault.ts still blocked by Serena hook
- Exact coverage percentage without running full suite with DB

## Files inspected
- docs/architecture/checkpoint-rollback-p3-plan.md
- apps/kernel/scripts/init.sql (for table insertion point)
- apps/kernel/src/studio/checkpoint/ (all 4 files created)
- apps/kernel/src/studio/security/git-file-policy.ts (created)
- apps/kernel/src/studio/routes/validation-schemas.ts
- apps/kernel/src/studio/routes/approvals.ts
- apps/kernel/src/studio/routes/skill-routes.ts
- apps/kernel/src/studio/routes/settings-routes.ts
- apps/kernel/src/studio/routes/provider-routes.ts
- apps/kernel/vitest.config.ts
- .github/workflows/ci.yml
