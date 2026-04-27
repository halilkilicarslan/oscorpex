# Oscorpex — Adapter Extraction Roadmap

This document outlines the plan to move provider adapter implementations from the kernel app into standalone workspace packages under `adapters/`.

## Current State

Provider adapters currently live inside the kernel app:

```
apps/kernel/src/studio/adapters/
  ├── provider-claude-code.ts   (real adapter)
  ├── provider-codex.ts         (real adapter)
  ├── provider-cursor.ts        (real adapter)
  └── cancel-behavior.ts        (behavior matrix)
```

Workspace `adapters/` directory exists but only contains stubs:

```
adapters/
  ├── provider-claude-code/     (stub)
  ├── provider-codex/           (stub)
  └── provider-cursor/          (stub)
```

## Target Architecture

```
adapters/
  ├── provider-claude-code/
  │   ├── src/
  │   │   └── index.ts          (exports ClaudeCodeAdapter)
  │   ├── package.json
  │   └── tsconfig.json
  ├── provider-codex/
  │   ├── src/
  │   │   └── index.ts          (exports CodexAdapter)
  │   ├── package.json
  │   └── tsconfig.json
  └── provider-cursor/
      ├── src/
      │   └── index.ts          (exports CursorAdapter)
      ├── package.json
      └── tsconfig.json
```

Each adapter package:
- Depends on `@oscorpex/core` and `@oscorpex/provider-sdk`
- Exports a single `ProviderAdapter` implementation
- Has its own test suite
- Has its own build pipeline

## Migration Steps

### Phase 1 — Stabilize Contracts (Done)
- [x] `ProviderAdapter` interface defined in `@oscorpex/core`
- [x] `ProviderExecutionInput` / `ProviderExecutionResult` types stable
- [x] `ProviderCapabilities` contract documented
- [x] `cancel-behavior.ts` matrix documented

### Phase 2 — Extract Cancel Behavior (Short-term)
- [ ] Move `cancel-behavior.ts` to `@oscorpex/provider-sdk`
- [ ] Update kernel to import from `@oscorpex/provider-sdk`
- [ ] Verify no behavioral changes

### Phase 3 — Extract Adapters (Medium-term)
For each adapter (claude-code → codex → cursor):

1. Create `adapters/provider-<name>/src/index.ts`
2. Copy adapter class from kernel
3. Add `package.json` with `workspace:*` deps on `@oscorpex/core` and `@oscorpex/provider-sdk`
4. Add unit tests in `adapters/provider-<name>/__tests__/`
5. Update kernel `adapters/index.ts` to re-export from workspace package
6. Remove old file from `apps/kernel/src/studio/adapters/`
7. Verify build + test pass

### Phase 4 — Kernel Cleanup (Post-extraction)
- [ ] Remove `apps/kernel/src/studio/adapters/` directory
- [ ] Update kernel imports to use `@oscorpex/provider-claude-code` etc.
- [ ] Remove `adapters/index.ts` barrel (kernel imports directly from packages)

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Adapter depends on kernel internals | Refactor to depend only on `@oscorpex/core` types |
| Tests require DB or CLI binaries | Mock CLI calls; add integration tests separately |
| Breaking change for console | Console does not import adapters directly — no impact |
| Build complexity increases | Each adapter is small; build time impact minimal |

## Acceptance Criteria

- [ ] All adapters live in `adapters/*` workspace packages
- [ ] Kernel has zero adapter implementation code
- [ ] Adapter packages build and test independently
- [ ] Kernel `pnpm test` still passes (integration via `@oscorpex/core` contracts)
- [ ] No regression in provider capabilities or cancel behavior
