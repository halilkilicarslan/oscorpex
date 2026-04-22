---
phase: 02-workspace-transform
plan: 02
type: execute
wave: 2
depends_on: ["02-workspace-transform-01"]
files_modified:
  - apps/kernel/package.json
  - apps/kernel/tsconfig.json
  - apps/console/package.json
  - apps/console/tsconfig.json
  - package.json
autonomous: false
requirements:
  - WS-04
  - WS-05
  - WS-06

must_haves:
  truths:
    - "Backend code runs from apps/kernel and builds identically to before"
    - "Console code runs from apps/console and builds identically to before"
    - "Root pnpm install and build succeed with the new workspace structure"
  artifacts:
    - path: "apps/kernel/package.json"
      provides: "Kernel app manifest pointing to src/"
      min_lines: 15
    - path: "apps/console/package.json"
      provides: "Console app manifest"
      min_lines: 15
  key_links:
    - from: "apps/kernel/package.json"
      to: "apps/kernel/src/"
      via: "main field pointing to dist/index.js"
      pattern: "dist/index.js"
    - from: "apps/console/package.json"
      to: "apps/console/"
      via: "Vite dev server config"
      pattern: "vite"
---

<objective>
Move the existing backend (`src/`) to `apps/kernel/` and the console (`console/`) to `apps/console/` within the monorepo workspace. Update all import paths, package references, and configuration so both apps build and run identically to before the move.

Purpose: Complete the workspace transformation by putting apps in their monorepo homes. After this plan, the repo structure matches the target architecture.

Output: Fully functional monorepo where `apps/kernel` is the backend and `apps/console` is the frontend, both building and running unchanged.

IMPORTANT: This is a checkpoint task because the migration must be verified manually — tests alone may miss runtime issues like incorrect import resolution, missing assets, or broken WebSocket connections.
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
</context>

<tasks>

<task type="auto">
  <name>Task 1: Move backend to apps/kernel and console to apps/console</name>
  <files>
    apps/kernel/package.json
    apps/kernel/tsconfig.json
    apps/console/package.json
    apps/console/tsconfig.json
    apps/console/vite.config.ts
    apps/console/tailwind.config.ts
    apps/kernel/src/index.ts
    package.json
  </files>
  <action>
    **CRITICAL: Use git mv for all file moves to preserve history.**

    **Step 1: Move backend src/ to apps/kernel/src/**

    ```bash
    mkdir -p apps/kernel
    git mv src apps/kernel/src
    ```

    Do NOT move `dist/`, `.voltagent/`, `coverage/`, or other generated directories.

    **Step 2: Move console/ to apps/console/**

    ```bash
    git mv console apps/console
    ```

    **Step 3: Create apps/kernel/package.json**

    Copy the relevant parts from root package.json into apps/kernel/package.json:

    ```json
    {
      "name": "@oscorpex/kernel",
      "version": "0.1.0",
      "type": "module",
      "main": "./dist/index.js",
      "types": "./dist/index.d.ts",
      "scripts": {
        "dev": "tsx watch ./src",
        "build": "tsdown",
        "start": "node dist/index.js",
        "lint": "biome check ./src",
        "lint:fix": "biome check --write ./src",
        "typecheck": "tsc --noEmit",
        "test": "vitest run",
        "test:watch": "vitest",
        "test:coverage": "vitest run --coverage"
      },
      "dependencies": {
        ...all current dependencies from root package.json...
      },
      "devDependencies": {
        ...all current devDependencies from root package.json...
      }
    }
    ```

    **Step 4: Update apps/kernel/tsconfig.json**

    Point rootDir and outDir to the new location:
    ```json
    {
      "compilerOptions": {
        "target": "ES2022",
        "module": "ES2022",
        "moduleResolution": "bundler",
        "esModuleInterop": true,
        "forceConsistentCasingInFileNames": true,
        "strict": true,
        "outDir": "./dist",
        "skipLibCheck": true
      },
      "include": ["src"],
      "exclude": ["node_modules", "dist"]
    }
    ```

    **Step 5: Update apps/console/package.json**

    Keep the existing console package.json but update any workspace references.

    **Step 6: Update root package.json**

    The root becomes a workspace orchestrator. Modify root package.json to:

    1. Remove all direct dependencies (they move to apps/kernel/package.json)
    2. Keep workspace-level scripts:
    ```json
    {
      "name": "oscorpex",
      "private": true,
      "type": "module",
      "scripts": {
        "dev": "pnpm --filter @oscorpex/kernel dev",
        "dev:console": "pnpm --filter @oscorpex/console dev",
        "build": "pnpm -r build",
        "build:kernel": "pnpm --filter @oscorpex/kernel build",
        "build:console": "pnpm --filter @oscorpex/console build",
        "build:packages": "pnpm -r --filter './packages/*' build",
        "lint": "biome check ./apps/kernel/src",
        "lint:fix": "biome check --write ./apps/kernel/src",
        "typecheck": "pnpm -r typecheck",
        "test": "pnpm --filter @oscorpex/kernel test",
        "docker:up": "docker compose up -d",
        "docker:down": "docker compose down"
      },
      "devDependencies": {
        "typescript": "^5.7.0",
        "@biomejs/biome": "^1.9.0",
        "tsdown": "^0.12.0",
        "vitest": "^3.0.0"
      }
    }
    ```

    **Step 7: Move config files that belong to kernel**

    Move these root-level config files to apps/kernel/:
    - `biome.json` → keep at root (workspace-level lint)
    - `tsconfig.json` → move to apps/kernel/
    - `Dockerfile` → move to apps/kernel/
    - `docker-compose.yml` → keep at root (workspace-level)

    **Step 8: Update all import paths in apps/kernel/src/**

    All .js import extensions should still work because the source files are now at `apps/kernel/src/` but imports like `from "./db.js"` remain the same (relative). No import changes needed within the same source tree.

    **Step 9: Move test files**

    ```bash
    git mv src/studio/__tests__ apps/kernel/src/studio/__tests__ 2>/dev/null || true
    git mv src/__tests__ apps/kernel/src/__tests__ 2>/dev/null || true
    ```

    **Step 10: Move scripts/**

    ```bash
    git mv scripts apps/kernel/scripts
    ```

    **Step 11: Update vite.config.ts in apps/console**

    Any proxy or API URLs pointing to port 3141 should remain unchanged since the backend still runs on port 3141.

    **Step 12: Install and verify**

    ```bash
    pnpm install
    pnpm build:kernel
    pnpm build:console
    pnpm typecheck
    pnpm test
    ```

    **IMPORTANT CAVEATS**:
    - The `.env` file should stay at root (workspace-level) or be symlinked
    - The `.voltagent/` directory should stay at root (it's runtime data)
    - The `coverage/` and `dist/` directories should be regenerated, not moved
    - Git history is preserved by using `git mv`
  </action>
  <verify>
    <automated>cd /Users/iamhk/development/personal/oscorpex && pnpm install && pnpm build:kernel && pnpm test</automated>
  </verify>
  <done>Backend code moved to apps/kernel/, console moved to apps/console/. Both apps build successfully. Root workspace orchestrator coordinates builds. All tests pass.</done>
</task>

<task type="checkpoint:human-verify">
  <what-built>
Complete workspace transformation — backend in apps/kernel/, frontend in apps/console/, three empty packages in packages/, adapters/ directory ready.
  </what-built>
  <how-to-verify>
1. Run `pnpm install` — should resolve all workspace packages
2. Run `pnpm build:kernel` — backend should build
3. Run `pnpm build:console` — frontend should build
4. Run `pnpm typecheck` — no type errors
5. Run `pnpm test` — all existing tests pass
6. Start backend: `pnpm dev` — should start on port 3141
7. Start frontend: `pnpm dev:console` — should start on port 5173
8. Open browser to http://localhost:5173 — should connect to backend
9. Create a project and verify the pipeline execution flow works
10. Check WebSocket connection in browser console

Key things to verify:
- No 404 errors on API calls
- WebSocket connection established (3142)
- Agent dispatch works
- Event bus delivers events
- Database queries succeed
  </how-to-verify>
  <resume-signal>Type "approved" if workspace transformation works, or describe any issues found</resume-signal>
</task>

</tasks>

<verification>
1. `pnpm install` succeeds with workspace packages
2. `pnpm build:kernel` produces dist/ output
3. `pnpm build:console` produces Vite output
4. `pnpm typecheck` passes with no errors
5. `pnpm test` passes (same count as before migration)
6. All existing source files are in apps/kernel/src/ (git mv preserved)
7. Console works from apps/console/
8. No behavioral regression
</verification>

<success_criteria>
- Backend runs from apps/kernel/ on port 3141
- Console runs from apps/console/ on port 5173
- All existing tests pass
- No import resolution errors
- WebSocket, API, and database connections work
- pnpm workspace structure is correct
</success_criteria>

<output>
After completion, create `.planning/phases/02-workspace-transform/02-SUMMARY.md`
</output>