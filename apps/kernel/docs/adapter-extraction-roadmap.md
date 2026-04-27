# Oscorpex — Adapter Extraction Roadmap

This document outlines the plan to move provider adapter implementations from the kernel app into standalone workspace packages under `adapters/`.

## Current State

Provider adapters currently live inside the kernel app:

```
apps/kernel/src/studio/adapters/
  ├── provider-claude-code.ts   (real adapter)
  ├── provider-codex.ts         (real adapter)
  ├── provider-cursor.ts        (real adapter)
```

`cancel-behavior.ts` has been extracted to `@oscorpex/provider-sdk`.

## Sprint Plan

### ✅ Sprint 0 — Stabilize Contracts (Done)
- [x] `ProviderAdapter` interface defined in `@oscorpex/core`
- [x] `ProviderExecutionInput` / `ProviderExecutionResult` types stable
- [x] `ProviderCapabilities` contract documented
- [x] `cancel-behavior.ts` extracted to `@oscorpex/provider-sdk`

### ✅ Sprint 1 — Claude Adapter Extraction (Done)
- [x] Create `adapters/provider-claude/package.json`
- [x] Create `adapters/provider-claude/tsconfig.json`
- [x] Create `adapters/provider-claude/src/index.ts` (ClaudeCodeAdapter)
- [x] Add unit tests in `adapters/provider-claude/__tests__/`
- [x] Update kernel `adapters/index.ts` to re-export from workspace package
- [x] Verify build + test pass

### ✅ Sprint 2 — Codex Adapter Extraction (Done)
- [x] Create `adapters/provider-codex/package.json`
- [x] Create `adapters/provider-codex/tsconfig.json`
- [x] Create `adapters/provider-codex/src/index.ts` (CodexAdapter)
- [x] Update kernel re-exports

### ✅ Sprint 3 — Cursor Adapter Extraction (Done)
- [x] Create `adapters/provider-cursor/package.json`
- [x] Create `adapters/provider-cursor/tsconfig.json`
- [x] Create `adapters/provider-cursor/src/index.ts` (CursorAdapter)
- [x] Update kernel re-exports

### ✅ Sprint 4 — Kernel Cleanup (Done)
- [x] Remove kernel-local adapter implementation files
- [x] Update kernel imports to use `@oscorpex/provider-claude` etc.
- [x] Barrel re-exports from workspace packages
- [x] Provider registry imports from workspace packages via barrel

## Target Architecture

```
adapters/
  ├── provider-claude/
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
