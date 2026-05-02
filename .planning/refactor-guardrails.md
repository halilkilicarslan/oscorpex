# Refactor Guardrails

## Rules

1. **No new features** — refactor only. No new dashboards, providers, agent roles, or product workflows.
2. **No DB semantic changes** without a migration note documenting old/new behavior.
3. **No provider behavior change** without tests confirming preserved behavior.
4. **No destructive git operations** in tests or runtime code.
5. **No removal of legacy exports** until all callers are confirmed migrated (use `rg` to verify).
6. **Preserve runtime behavior** — every behavioral change must document:
   - Reason
   - Old behavior
   - New behavior
   - Risk
   - Validation
7. **DB remains source of truth** — runtime caches are performance helpers only.
8. **Small PRs** — 1 architectural concern, 3-8 files, tests included.
9. **Kernel contracts as stable boundary** — reduce direct cross-module coupling.
10. **No `as any` additions** — reduce existing count, don't increase.
