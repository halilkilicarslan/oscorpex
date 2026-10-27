import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../security/tool-policy-enforcer.js", () => ({
	enforceToolPolicy: vi.fn(),
	ToolPolicyDeniedError: class extends Error {
		code = "TEST";
	},
}));
vi.mock("../logger.js", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../event-bus.js", () => ({
	eventBus: { emitTransient: vi.fn() },
}));
vi.mock("../db.js", () => ({
	query: vi.fn(async () => []),
	queryOne: vi.fn(async () => ({ id: "chk-1" })),
}));

describe("P7-B: Approval Apply Flow", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it("returns denied when write tools disabled", async () => {
		delete process.env.OSCORPEX_ENABLE_MCP_WRITE_TOOLS;
		const { applyApprovedWrite } = await import("../mcp-bridge/approval-apply.js");
		const result = await applyApprovedWrite({
			approvalId: "a1",
			checkpointId: "c1",
			tenantId: "t1",
			projectId: "p1",
			actorId: "u1",
			toolName: "file.write",
			args: {},
			source: "user",
		});
		expect(result.status).toBe("denied");
	});

	it("returns denied when secret detected in args", async () => {
		process.env.OSCORPEX_ENABLE_MCP_WRITE_TOOLS = "true";
		const { applyApprovedWrite } = await import("../mcp-bridge/approval-apply.js");
		const result = await applyApprovedWrite({
			approvalId: "a1",
			checkpointId: "c1",
			tenantId: "t1",
			projectId: "p1",
			actorId: "u1",
			toolName: "file.write",
			args: { content: "API_KEY=secret123" },
			source: "user",
		});
		expect(result.status).toBe("denied");
	});

	it("returns failed for unknown tool", async () => {
		process.env.OSCORPEX_ENABLE_MCP_WRITE_TOOLS = "true";
		const { applyApprovedWrite } = await import("../mcp-bridge/approval-apply.js");
		const result = await applyApprovedWrite({
			approvalId: "a1",
			checkpointId: "c1",
			tenantId: "t1",
			projectId: "p1",
			actorId: "u1",
			toolName: "shell.run",
			args: {},
			source: "user",
		});
		expect(result.status).toBe("failed");
	});

	it("production readiness checklist exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/production/production-readiness-checklist.md"))).toBe(true);
	});

	it("DinD decision document exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(existsSync(join(process.cwd(), "../../docs/architecture/container-runtime-isolation-decision.md"))).toBe(true);
	});
});
