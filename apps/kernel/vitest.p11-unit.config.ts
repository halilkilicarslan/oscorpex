import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/studio/__tests__/p11-*.test.ts"],
		environment: "node",
		globals: false,
		// No DB setup — P11 unit tests are DB-independent
	},
});
