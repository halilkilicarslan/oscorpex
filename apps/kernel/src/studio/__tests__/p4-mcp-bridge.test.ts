import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../security/tool-policy-enforcer.js", () => {
	class ToolPolicyDeniedError extends Error {
		code: string;
		decision: unknown;
		constructor(d: { decision: string; reason: string; code: string }) {
			super(d.reason);
			this.name = "ToolPolicyDeniedError";
			this.code = d.code;
			this.decision = d;
		}
	}
	return {
		enforceToolPolicy: vi.fn(),
		ToolPolicyDeniedError,
	};
});

vi.mock("../security/workspace-resolver.js", () => ({
	resolveWorkspacePath: vi.fn((_scope: unknown, rel?: string) => `/workspace/t1/p1${rel ? `/${rel}` : ""}`),
	assertInsideWorkspace: vi.fn(),
}));

vi.mock("../logger.js", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe("P4-6: MCP Bridge Read-Only Skeleton", () => {
	it("lists only read-only tools", async () => {
		const { listMcpTools } = await import("../mcp-bridge/index.js");
		const tools = listMcpTools();
		expect(tools.length).toBeGreaterThan(0);
		for (const t of tools) {
			expect(t.riskLevel).toBe("read");
		}
	});

	it("does not register write tools", async () => {
		const { listMcpTools } = await import("../mcp-bridge/index.js");
		const tools = listMcpTools();
		const names = tools.map((t) => t.name);
		expect(names).not.toContain("file.write");
		expect(names).not.toContain("file.delete");
		expect(names).not.toContain("shell.run");
		expect(names).not.toContain("git.commit");
		expect(names).not.toContain("git.push");
		expect(names).not.toContain("git.reset");
	});

	it("invocation calls enforceToolPolicy", async () => {
		const { enforceToolPolicy } = await import("../security/tool-policy-enforcer.js");
		const { invokeMcpTool } = await import("../mcp-bridge/index.js");
		await invokeMcpTool({
			tenantId: "t1",
			projectId: "p1",
			actorId: "user-1",
			toolName: "git.status",
			args: {},
			source: "user",
		});
		expect(vi.mocked(enforceToolPolicy)).toHaveBeenCalled();
	});

	it("unknown tool returns UNKNOWN_TOOL error", async () => {
		const { invokeMcpTool } = await import("../mcp-bridge/index.js");
		const result = await invokeMcpTool({
			tenantId: "t1",
			projectId: "p1",
			actorId: "user-1",
			toolName: "shell.run",
			args: { command: "rm -rf /" },
			source: "llm",
		});
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("UNKNOWN_TOOL");
	});

	it("policy denial blocks invocation and returns error", async () => {
		const { enforceToolPolicy, ToolPolicyDeniedError } = await import("../security/tool-policy-enforcer.js");
		vi.mocked(enforceToolPolicy).mockImplementationOnce(() => {
			throw new ToolPolicyDeniedError({ decision: "deny", reason: "test deny", code: "TEST_DENY" });
		});
		const { invokeMcpTool } = await import("../mcp-bridge/index.js");
		const result = await invokeMcpTool({
			tenantId: "t1",
			projectId: "p1",
			actorId: "agent-1",
			toolName: "repo.listFiles",
			args: {},
			source: "llm",
		});
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("TEST_DENY");
	});

	it("repo.readFile uses workspace resolver for path", async () => {
		const { resolveWorkspacePath } = await import("../security/workspace-resolver.js");
		const { invokeMcpTool } = await import("../mcp-bridge/index.js");
		await invokeMcpTool({
			tenantId: "t1",
			projectId: "p1",
			actorId: "user-1",
			toolName: "repo.readFile",
			args: { path: "src/index.ts" },
			source: "user",
		});
		expect(vi.mocked(resolveWorkspacePath)).toHaveBeenCalled();
	});

	it("all registered tools have riskLevel read", async () => {
		const { listMcpTools } = await import("../mcp-bridge/index.js");
		for (const tool of listMcpTools()) {
			expect(tool.riskLevel).toBe("read");
		}
	});

	it("registered tool names include expected read-only tools", async () => {
		const { listMcpTools } = await import("../mcp-bridge/index.js");
		const names = listMcpTools().map((t) => t.name);
		expect(names).toContain("repo.listFiles");
		expect(names).toContain("repo.readFile");
		expect(names).toContain("repo.search");
		expect(names).toContain("git.status");
		expect(names).toContain("git.diff");
	});
});
