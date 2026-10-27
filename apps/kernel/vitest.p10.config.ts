import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/studio/__tests__/p10-*.test.ts"],
		environment: "node",
		globals: false,
	},
});
