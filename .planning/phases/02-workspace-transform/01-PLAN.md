---
phase: 02-workspace-transform
plan: 01
type: execute
wave: 1
depends_on: ["01-prep-inventory"]
files_modified:
  - pnpm-workspace.yaml
  - package.json
  - tsconfig.json
  - packages/core/package.json
  - packages/core/tsconfig.json
  - packages/event-schema/package.json
  - packages/event-schema/tsconfig.json
  - packages/provider-sdk/package.json
  - packages/provider-sdk/tsconfig.json
autonomous: true
requirements:
  - WS-01
  - WS-02
  - WS-03

must_haves:
  truths:
    - "pnpm workspace is configured and recognizes apps/, packages/, adapters/ directories"
    - "Shared tsconfig has proper references for all workspace packages"
    - "Three new packages exist with valid package.json and tsconfig.json but no implementation yet"
  artifacts:
    - path: "pnpm-workspace.yaml"
      provides: "Workspace package discovery"
      min_lines: 5
    - path: "packages/core/package.json"
      provides: "@oscorpex/core package manifest"
      min_lines: 10
    - path: "packages/event-schema/package.json"
      provides: "@oscorpex/event-schema package manifest"
      min_lines: 10
    - path: "packages/provider-sdk/package.json"
      provides: "@oscorpex/provider-sdk package manifest"
      min_lines: 10
  key_links:
    - from: "pnpm-workspace.yaml"
      to: "packages/*"
      via: "workspace package discovery"
      pattern: "packages/\\*"
---

<objective>
Convert the single-package repository into a pnpm monorepo workspace. Create the directory structure (apps/, packages/, adapters/) and scaffold the three initial packages (core, event-schema, provider-sdk) with proper package.json and tsconfig.json.

Purpose: Establish the monorepo foundation before any code extraction happens. This is purely structural — no behavior change, no code moves yet.

Output: A working pnpm workspace where `pnpm install` succeeds and the existing backend/frontend build identically to before.
</objective>

<execution_context>
@/Users/iamhk/.config/opencode/get-shit-done/workflows/execute-plan.md
@/Users/iamhk/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@package.json
@biome.json
@tsconfig.json
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create monorepo workspace structure and scaffold packages</name>
  <files>
    pnpm-workspace.yaml
    package.json
    tsconfig.json
    tsconfig.base.json
    packages/core/package.json
    packages/core/tsconfig.json
    packages/core/src/index.ts
    packages/event-schema/package.json
    packages/event-schema/tsconfig.json
    packages/event-schema/src/index.ts
    packages/provider-sdk/package.json
    packages/provider-sdk/tsconfig.json
    packages/provider-sdk/src/index.ts
  </files>
  <action>
    **Step 1: Create pnpm-workspace.yaml**

    Create `pnpm-workspace.yaml` at project root:
    ```yaml
    packages:
      - "apps/*"
      - "packages/*"
      - "adapters/*"
    ```

    **Step 2: Create directory structure**

    ```bash
    mkdir -p apps packages/core/src packages/event-schema/src packages/provider-sdk/src adapters
    ```

    Create `.gitkeep` in `adapters/` to preserve the empty directory.

    **Step 3: Create shared tsconfig.base.json**

    Create `tsconfig.base.json` at project root with shared compiler options:
    ```json
    {
      "compilerOptions": {
        "target": "ES2022",
        "module": "ES2022",
        "moduleResolution": "bundler",
        "esModuleInterop": true,
        "forceConsistentCasingInFileNames": true,
        "strict": true,
        "skipLibCheck": true,
        "declaration": true,
        "declarationMap": true,
        "sourceMap": true
      }
    }
    ```

    **Step 4: Update root tsconfig.json**

    Keep the root tsconfig.json pointing to `src` (the existing backend). Do NOT change it yet — we'll move the backend to apps/kernel in Plan 02.

    **Step 5: Create packages/core/package.json**

    ```json
    {
      "name": "@oscorpex/core",
      "version": "0.0.1",
      "type": "module",
      "main": "./dist/index.js",
      "types": "./dist/index.d.ts",
      "exports": {
        ".": {
          "import": "./dist/index.js",
          "types": "./dist/index.d.ts"
        }
      },
      "scripts": {
        "build": "tsdown",
        "typecheck": "tsc --noEmit",
        "lint": "biome check ./src"
      },
      "devDependencies": {
        "typescript": "^5.7.0",
        "tsdown": "^0.12.0",
        "@biomejs/biome": "^1.9.0"
      }
    }
    ```

    Create `packages/core/tsconfig.json` extending the base:
    ```json
    {
      "extends": "../../tsconfig.base.json",
      "compilerOptions": {
        "outDir": "./dist",
        "rootDir": "./src"
      },
      "include": ["src"]
    }
    ```

    Create `packages/core/src/index.ts` as empty placeholder:
    ```ts
    // @oscorpex/core — Provider-agnostic execution kernel
    // Domain types, contracts, state machines, and kernel façade will be added in Phase 3.
    export {};
    ```

    **Step 6: Create packages/event-schema/package.json**

    Same structure as core but named `@oscorpex/event-schema`. Empty `src/index.ts` placeholder.

    **Step 7: Create packages/provider-sdk/package.json**

    Same structure as core but named `@oscorpex/provider-sdk`. Empty `src/index.ts` placeholder.

    **Step 8: Update root package.json**

    Add workspace script targets (keep all existing scripts). Add:
    ```json
    "scripts": {
      ...existing scripts...,
      "build:core": "pnpm --filter @oscorpex/core build",
      "build:event-schema": "pnpm --filter @oscorpex/event-schema build",
      "build:provider-sdk": "pnpm --filter @oscorpex/provider-sdk build",
      "build:packages": "pnpm -r --filter './packages/*' build"
    }
    ```

    **Step 9: Run pnpm install**

    ```bash
    pnpm install
    ```

    This will resolve the workspace and create symlinks.

    **Step 10: Verify the workspace**

    ```bash
    pnpm list --depth 0 --filter @oscorpex/core
    pnpm list --depth 0 --filter @oscorpex/event-schema
    pnpm list --depth 0 --filter @oscorpex/provider-sdk
    ```

    **CRITICAL**: Do NOT move any existing code yet. This is purely structural. The existing backend stays in `src/` and console stays in `console/`. Both must continue to build and run identically.

    **IMPORTANT**: Use `tsdown` (not `tsup`) as the build tool since the existing project uses `tsdown` in its build script. Check the version currently used in root package.json and use the same major version.
  </action>
  <verify>
    <automated>pnpm install && pnpm build:packages && test -f packages/core/dist/index.js && test -f packages/event-schema/dist/index.js && test -f packages/provider-sdk/dist/index.js</automated>
  </verify>
  <done>pnpm workspace configured with apps/, packages/, adapters/ directories. Three empty packages (core, event-schema, provider-sdk) build successfully. Existing backend/frontend unaffected.</done>
</task>

</tasks>

<verification>
1. `pnpm-workspace.yaml` exists with correct package patterns
2. `pnpm install` succeeds without errors
3. `pnpm build:packages` succeeds (three empty packages build)
4. `pnpm build` (root) still works — existing code unaffected
5. `pnpm typecheck` still passes — existing code unaffected
6. Three packages appear in `pnpm list --depth 0`
7. No existing code was moved or modified
</verification>

<success_criteria>
- pnpm workspace recognizes apps/, packages/, adapters/
- Three scaffolded packages build successfully
- Root build and typecheck pass unchanged
- No behavioral regression from structural changes
</success_criteria>

<output>
After completion, create `.planning/phases/02-workspace-transform/01-SUMMARY.md`
</output>