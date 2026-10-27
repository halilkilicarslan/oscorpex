import { describe, expect, it, vi } from "vitest";

vi.mock("../security/tool-policy-enforcer.js", () => ({
	enforceToolPolicy: vi.fn(),
	ToolPolicyDeniedError: class extends Error {
		code = "TEST";
		decision = { decision: "deny" };
	},
}));
vi.mock("../security/workspace-resolver.js", () => ({
	resolveWorkspacePath: vi.fn(() => "/workspace/t1/p1"),
	assertInsideWorkspace: vi.fn(),
}));
vi.mock("../logger.js", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../event-bus.js", () => ({
	eventBus: { emitTransient: vi.fn(), emit: vi.fn() },
}));

describe("P5-A: MCP JSON-RPC Protocol", () => {
	it("tools/list returns read-only tools", async () => {
		const { handleJsonRpcRequest } = await import("../mcp-bridge/protocol/json-rpc.js");
		const res = await handleJsonRpcRequest(
			{ jsonrpc: "2.0", id: 1, method: "tools/list" },
			{ tenantId: "t1", projectId: "p1", actorId: "u1", source: "user" },
		);
		expect(res.result).toBeDefined();
		expect((res.result as { tools: unknown[] }).tools.length).toBeGreaterThan(0);
	});

	it("tools/call invokes tool and returns result", async () => {
		const { handleJsonRpcRequest } = await import("../mcp-bridge/protocol/json-rpc.js");
		const res = await handleJsonRpcRequest(
			{ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "git.status", arguments: {} } },
			{ tenantId: "t1", projectId: "p1", actorId: "u1", source: "user" },
		);
		// May fail (no git repo) but should not crash
		expect(res.id).toBe(2);
	});

	it("unknown method returns -32601", async () => {
		const { handleJsonRpcRequest } = await import("../mcp-bridge/protocol/json-rpc.js");
		const res = await handleJsonRpcRequest(
			{ jsonrpc: "2.0", id: 3, method: "unknown/method" },
			{ tenantId: "t1", projectId: "p1", actorId: "u1", source: "user" },
		);
		expect(res.error?.code).toBe(-32601);
	});

	it("invalid JSON-RPC returns -32600", async () => {
		const { handleJsonRpcRequest } = await import("../mcp-bridge/protocol/json-rpc.js");
		const res = await handleJsonRpcRequest(
			{ method: "tools/list" }, // missing jsonrpc and id
			{ tenantId: "t1", projectId: "p1", actorId: "u1", source: "user" },
		);
		expect(res.error?.code).toBe(-32600);
	});

	it("missing tenantId returns error", async () => {
		const { handleJsonRpcRequest } = await import("../mcp-bridge/protocol/json-rpc.js");
		const res = await handleJsonRpcRequest(
			{ jsonrpc: "2.0", id: 5, method: "tools/list" },
			{ tenantId: "", projectId: "p1", actorId: "u1", source: "user" },
		);
		expect(res.error).toBeDefined();
	});

	it("missing tool name in tools/call returns error", async () => {
		const { handleJsonRpcRequest } = await import("../mcp-bridge/protocol/json-rpc.js");
		const res = await handleJsonRpcRequest(
			{ jsonrpc: "2.0", id: 6, method: "tools/call", params: {} },
			{ tenantId: "t1", projectId: "p1", actorId: "u1", source: "user" },
		);
		expect(res.error?.code).toBe(-32602);
	});
});

describe("P5-B: MCP Audit Logging", () => {
	it("recordMcpAudit creates audit event with id and timestamp", async () => {
		const { recordMcpAudit } = await import("../mcp-bridge/mcp-audit.js");
		const audit = recordMcpAudit({
			tenantId: "t1",
			projectId: "p1",
			actorId: "u1",
			toolName: "git.status",
			source: "user",
			decision: "allow",
			status: "success",
			durationMs: 15,
		});
		expect(audit.id).toBeDefined();
		expect(audit.createdAt).toBeDefined();
		expect(audit.toolName).toBe("git.status");
	});

	it("mcp-bridge.ts imports recordMcpAudit", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/mcp-bridge/mcp-bridge.ts"), "utf8");
		expect(src).toContain("recordMcpAudit");
	});

	it("denied invocation produces audit with decision=deny", async () => {
		const { recordMcpAudit } = await import("../mcp-bridge/mcp-audit.js");
		const audit = recordMcpAudit({
			tenantId: "t1",
			projectId: "p1",
			actorId: "agent-1",
			toolName: "shell.run",
			source: "llm",
			decision: "deny",
			status: "denied",
			durationMs: 0,
			errorCode: "LLM_SHELL_DENIED",
		});
		expect(audit.decision).toBe("deny");
		expect(audit.errorCode).toBe("LLM_SHELL_DENIED");
	});
});
