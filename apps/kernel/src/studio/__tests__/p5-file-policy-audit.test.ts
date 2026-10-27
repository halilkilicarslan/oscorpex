import { describe, expect, it } from "vitest";

describe("P5-D: File policy audit", () => {
	it("docs-generator.ts uses enforceFilePolicy", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/docs-generator.ts"), "utf8");
		expect(src).toContain("enforceFilePolicy");
	});

	it("workspace-resolver.ts validates all paths with realpathSync", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/security/workspace-resolver.ts"), "utf8");
		expect(src).toContain("realpathSync");
		expect(src).toContain("WorkspaceViolationError");
	});

	it("no direct fs.writeFileSync in route handlers", async () => {
		const { readFileSync, readdirSync } = await import("node:fs");
		const { join } = await import("node:path");
		const routesDir = join(process.cwd(), "src/studio/routes");
		const files = readdirSync(routesDir).filter((f) => f.endsWith(".ts") && !f.includes("test"));
		for (const file of files) {
			const content = readFileSync(join(routesDir, file), "utf8");
			// Route handlers should not directly write files
			expect(content, `${file} must not use writeFileSync`).not.toContain("writeFileSync");
			expect(content, `${file} must not use fs.writeFile(`).not.toContain("fs.writeFile(");
		}
	});

	it("integration-routes.ts uses parseBody for webhook mutations", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/routes/integration-routes.ts"), "utf8");
		expect(src).toContain("parseBody");
	});
});
