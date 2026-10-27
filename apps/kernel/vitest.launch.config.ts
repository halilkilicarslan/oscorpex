import { defineConfig } from "vitest/config";
export default defineConfig({
	test: {
		include: ["src/studio/__tests__/beta*.test.ts", "src/studio/__tests__/rc1-*.test.ts"],
		environment: "node",
		globals: false,
	},
});
