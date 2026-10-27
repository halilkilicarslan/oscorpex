import { defineConfig } from "vitest/config";

// P13-M: Dedicated config for the P13 test suite — runs only p13-prefixed tests
// with their own coverage gate.  Use: vitest run --config vitest.p13.config.ts
export default defineConfig({
	test: {
		include: ["src/studio/__tests__/p13-*.test.ts"],
		environment: "node",
		globals: false,
		fileParallelism: false,

		coverage: {
			provider: "v8",
			include: [
				"src/studio/hermes/**/*.ts",
				"src/studio/gateway/**/*.ts",
			],
			exclude: ["src/**/*.test.ts", "src/**/__tests__/**"],
			reporter: ["text", "lcov"],
			// P13 hermes/gateway modules target 80% independently
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 75,
				statements: 80,
			},
		},
	},
});
