import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "./src/index.ts",
		migrate: "./src/bin/migrate.ts",
		"admin-grant": "./src/bin/admin-grant.ts",
	},
	sourcemap: true,
	outDir: "dist",
});
