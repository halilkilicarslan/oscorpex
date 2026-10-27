import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/studio/__tests__/beta05-*.test.ts"],
		environment: "node",
		globals: false,
		fileParallelism: false,
	},
});
