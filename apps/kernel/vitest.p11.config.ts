// ---------------------------------------------------------------------------
// Oscorpex — P11 Coverage Configuration
// Stricter thresholds for P11 coverage sprint validation.
// Run with: pnpm vitest run --config vitest.p11.config.ts
// ---------------------------------------------------------------------------

import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		environment: "node",
		globals: false,
		setupFiles: ["src/studio/__tests__/setup.ts"],

		// Serialize to avoid DB-backed test race conditions
		fileParallelism: false,

		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts", "src/**/__tests__/**"],
			reporter: ["text", "lcov", "html", "json-summary"],

			// P11-M: Target thresholds — 70/70/65/70
			thresholds: {
				lines: 70,
				functions: 70,
				branches: 65,
				statements: 70,
			},

			// Dedicated output for P11 coverage run
			reportsDirectory: "./coverage-p11",
		},

		// P11-specific reporter for CI output
		reporter: ["verbose", "json"],
		outputFile: "./test-results-p11.json",
	},
});
