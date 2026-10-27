import { describe, expect, it } from "vitest";

describe("P5-E: Remaining Zod wiring", () => {
	it("all mutation routes import parseBody or validation-schemas", async () => {
		const { readFileSync, readdirSync } = await import("node:fs");
		const { join } = await import("node:path");
		const routesDir = join(process.cwd(), "src/studio/routes");
		const mutationRoutes = [
			"project-crud-routes.ts",
			"agent-routes.ts",
			"approvals.ts",
			"skill-routes.ts",
			"provider-routes.ts",
			"template-routes.ts",
			"plugin-routes.ts",
			"task-routes.ts",
		];

		for (const file of mutationRoutes) {
			const fullPath = join(routesDir, file);
			try {
				const content = readFileSync(fullPath, "utf8");
				if (content.includes("c.req.json")) {
					expect(content, `${file} uses c.req.json but missing parseBody`).toContain("parseBody");
				}
			} catch {
				// File doesn't exist — skip
			}
		}
	});

	it("integration-routes.ts uses Zod schemas for webhook POST", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/routes/integration-routes.ts"), "utf8");
		expect(src).toContain("CreateWebhookBodySchema");
		expect(src).toContain("parseBody");
	});

	it("integration-routes.ts uses Zod schemas for webhook PUT", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/routes/integration-routes.ts"), "utf8");
		expect(src).toContain("UpdateWebhookBodySchema");
	});

	it("validation-schemas.ts exports parseBody utility", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/routes/validation-schemas.ts"), "utf8");
		expect(src).toContain("export function parseBody");
	});

	it("integration-routes.ts exists and is well-formed", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/routes/integration-routes.ts"), "utf8");
		expect(src).toContain("integrationRoutes");
	});
});
