import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/studio/__tests__/p1-*.test.ts"],
		environment: "node",
		globals: false,
		// No setupFiles — P1 tests are DB-independent
	},
});
