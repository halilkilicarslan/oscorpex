import { describe, expect, it } from "vitest";
import {
	CreateTemplateSchema,
	UpdatePluginSchema,
	UpdateTaskSchema,
	UpdateWebhookSchema,
	parseBody,
} from "../routes/validation-schemas.js";

describe("P4-2: Git manager policy wiring", () => {
	it("git-manager.ts imports enforceGitPolicy", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/git-manager.ts"), "utf8");
		expect(src).toContain("enforceGitPolicy");
	});

	it("git-manager.ts calls enforceGitPolicy in commit method", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/git-manager.ts"), "utf8");
		// Should appear multiple times (commit, commitFiles, commitChanges, checkout, merge, revertCommit)
		const matches = src.match(/enforceGitPolicy\(/g);
		expect(matches).not.toBeNull();
		expect((matches ?? []).length).toBeGreaterThanOrEqual(5);
	});
});

describe("P4-3: File policy wiring", () => {
	it("task-output-handler.ts or docs-generator.ts imports enforceFilePolicy", async () => {
		const { readFileSync, existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		// Check at least one file write path has policy
		const paths = [
			"src/studio/execution/task-output-handler.ts",
			"src/studio/docs-generator.ts",
		];
		const hasPolicy = paths.some((p) => {
			const full = join(process.cwd(), p);
			if (!existsSync(full)) return false;
			return readFileSync(full, "utf8").includes("enforceFilePolicy");
		});
		expect(hasPolicy).toBe(true);
	});

	it("docs-generator.ts contains enforceFilePolicy calls", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/docs-generator.ts"), "utf8");
		const matches = src.match(/enforceFilePolicy\(/g);
		expect(matches).not.toBeNull();
		expect((matches ?? []).length).toBeGreaterThanOrEqual(2);
	});
});

describe("P4-5: Remaining Zod schemas", () => {
	it("UpdateTaskSchema rejects unknown fields", () => {
		expect(parseBody(UpdateTaskSchema, { status: "done", tenant_id: "evil" }).success).toBe(false);
	});

	it("UpdateTaskSchema accepts valid status", () => {
		expect(parseBody(UpdateTaskSchema, { status: "done" }).success).toBe(true);
	});

	it("UpdateTaskSchema rejects invalid status", () => {
		expect(parseBody(UpdateTaskSchema, { status: "hacked" }).success).toBe(false);
	});

	it("UpdateTaskSchema accepts valid assignedAgent update", () => {
		expect(parseBody(UpdateTaskSchema, { assignedAgent: "agent-42" }).success).toBe(true);
	});

	it("UpdateTaskSchema accepts valid priority update", () => {
		expect(parseBody(UpdateTaskSchema, { priority: 50 }).success).toBe(true);
	});

	it("UpdateTaskSchema rejects out-of-range priority", () => {
		expect(parseBody(UpdateTaskSchema, { priority: 999 }).success).toBe(false);
	});

	it("CreateTemplateSchema rejects missing name", () => {
		expect(parseBody(CreateTemplateSchema, { description: "test" }).success).toBe(false);
	});

	it("CreateTemplateSchema accepts valid template", () => {
		expect(parseBody(CreateTemplateSchema, { name: "my-template" }).success).toBe(true);
	});

	it("CreateTemplateSchema accepts template with optional fields", () => {
		expect(
			parseBody(CreateTemplateSchema, {
				name: "my-template",
				description: "A test template",
				category: "backend",
			}).success,
		).toBe(true);
	});

	it("CreateTemplateSchema rejects empty name", () => {
		expect(parseBody(CreateTemplateSchema, { name: "" }).success).toBe(false);
	});

	it("UpdatePluginSchema accepts valid update", () => {
		expect(parseBody(UpdatePluginSchema, { enabled: true }).success).toBe(true);
	});

	it("UpdatePluginSchema rejects unknown fields", () => {
		expect(parseBody(UpdatePluginSchema, { enabled: true, apiKey: "secret" }).success).toBe(false);
	});

	it("UpdatePluginSchema accepts configJson update", () => {
		expect(parseBody(UpdatePluginSchema, { configJson: { timeout: 30 } }).success).toBe(true);
	});

	it("UpdatePluginSchema accepts empty body", () => {
		expect(parseBody(UpdatePluginSchema, {}).success).toBe(true);
	});

	it("UpdateWebhookSchema accepts valid URL update", () => {
		expect(parseBody(UpdateWebhookSchema, { url: "https://example.com/hook" }).success).toBe(true);
	});

	it("UpdateWebhookSchema rejects invalid URL", () => {
		expect(parseBody(UpdateWebhookSchema, { url: "not-a-url" }).success).toBe(false);
	});

	it("UpdateWebhookSchema accepts enabled flag", () => {
		expect(parseBody(UpdateWebhookSchema, { enabled: false }).success).toBe(true);
	});

	it("UpdateWebhookSchema rejects unknown fields", () => {
		expect(parseBody(UpdateWebhookSchema, { url: "https://example.com", secret: "leak" }).success).toBe(false);
	});
});
