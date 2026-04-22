import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run only TypeScript test files under src/
    include: ["src/**/*.test.ts"],

    // ESM-compatible environment (Node is the default and works for ESM)
    environment: "node",

    // Globals: false — explicit imports keep the code traceable under strict TS
    globals: false,

    // Use temp DB for studio tests
    setupFiles: ["src/studio/__tests__/setup.ts"],

    // Studio tests share a single PostgreSQL database. Parallel test files
    // race on broad DELETEs in beforeAll hooks → wipe each other's rows.
    // Serialize files to keep DB-backed assertions deterministic.
    fileParallelism: false,

    coverage: {
      // Use the V8 built-in coverage provider (no Babel transform required)
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/__tests__/**"],
      reporter: ["text", "lcov", "html"],
    },
  },
});
