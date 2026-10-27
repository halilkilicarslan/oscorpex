import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/studio/__tests__/p0-hardening.test.ts"],
		environment: "node",
		globals: false,
		// No setupFiles — P0 tests are DB-independent
	},
});
