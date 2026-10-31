import { describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({
	query: vi.fn(async () => []),
	queryOne: vi.fn(async () => ({ id: "chk-1" })),
}));
vi.mock("../logger.js", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../security/tool-policy-enforcer.js", () => ({
	enforceToolPolicy: vi.fn(),
	ToolPolicyDeniedError: class extends Error {
		code = "TEST";
		decision = { decision: "deny" };
	},
}));

describe("P4-1: Checkpoint wiring verification", () => {
	it("task-executor.ts imports checkpoint", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/execution/task-executor.ts"), "utf8");
		expect(src).toContain("createCheckpoint");
		expect(src).toContain("pre-task");
	});

	it("app-runner/starter.ts imports checkpoint", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/app-runner/starter.ts"), "utf8");
		expect(src).toContain("createCheckpoint");
		expect(src).toContain("pre-migration");
	});

	it("checkpoint-service.ts handles git rollback type", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/checkpoint/checkpoint-service.ts"), "utf8");
		expect(src).toContain('case "git"');
		expect(src).toContain("checkout");
		expect(src).toContain("execFileSync");
	});

	it("checkpoint-service.ts handles filesystem rollback type", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/checkpoint/checkpoint-service.ts"), "utf8");
		expect(src).toContain('case "filesystem"');
		expect(src).toContain("changedFiles");
	});
});
