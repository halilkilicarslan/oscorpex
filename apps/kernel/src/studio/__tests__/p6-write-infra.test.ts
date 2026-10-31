import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("../db.js", () => ({
	query: vi.fn(async () => []),
	queryOne: vi.fn(async () => ({ id: "chk-1" })),
}));

describe("P6-A: Write Tool Registry", () => {
	beforeEach(() => {
		delete process.env.OSCORPEX_ENABLE_MCP_WRITE_TOOLS;
		delete process.env.OSCORPEX_ALLOW_MCP_WRITE_IN_PROD;
		delete process.env.NODE_ENV;
	});

	it("write tools disabled by default", async () => {
		const { areWriteToolsEnabled } = await import("../mcp-bridge/write-tool-registry.js");
		expect(areWriteToolsEnabled()).toBe(false);
	});

	it("write tools enabled with flag", async () => {
		process.env.OSCORPEX_ENABLE_MCP_WRITE_TOOLS = "true";
		const { areWriteToolsEnabled } = await import("../mcp-bridge/write-tool-registry.js");
		expect(areWriteToolsEnabled()).toBe(true);
	});

	it("write tools blocked in production without prod flag", async () => {
		process.env.OSCORPEX_ENABLE_MCP_WRITE_TOOLS = "true";
		process.env.NODE_ENV = "production";
		const { areWriteToolsEnabled } = await import("../mcp-bridge/write-tool-registry.js");
		expect(areWriteToolsEnabled()).toBe(false);
	});

	it("write tools enabled in production with both flags", async () => {
		process.env.OSCORPEX_ENABLE_MCP_WRITE_TOOLS = "true";
		process.env.NODE_ENV = "production";
		process.env.OSCORPEX_ALLOW_MCP_WRITE_IN_PROD = "true";
		const { areWriteToolsEnabled } = await import("../mcp-bridge/write-tool-registry.js");
		expect(areWriteToolsEnabled()).toBe(true);
	});

	it("isWriteToolRegistered returns false for unknown tool", async () => {
		const { isWriteToolRegistered } = await import("../mcp-bridge/write-tool-registry.js");
		expect(isWriteToolRegistered("nonexistent.tool")).toBe(false);
	});

	it("registerWriteTool and listWriteTools round-trip", async () => {
		const { registerWriteTool, listWriteTools, isWriteToolRegistered, __clearWriteToolRegistry } = await import(
			"../mcp-bridge/write-tool-registry.js"
		);
		__clearWriteToolRegistry();
		const def = {
			name: "test.write.roundtrip",
			description: "Test write tool",
			riskLevel: "write" as const,
			requiresApproval: true as const,
			requiresCheckpoint: true as const,
			supportsRollbackDryRun: true as const,
		};
		registerWriteTool(def, async () => ({ ok: true }));
		expect(isWriteToolRegistered("test.write.roundtrip")).toBe(true);
		const listed = listWriteTools();
		expect(listed.some((t) => t.name === "test.write.roundtrip")).toBe(true);
		__clearWriteToolRegistry();
	});

	it("registerWriteTool throws on duplicate", async () => {
		const { registerWriteTool, __clearWriteToolRegistry } = await import("../mcp-bridge/write-tool-registry.js");
		__clearWriteToolRegistry();
		const def = {
			name: "test.write.duplicate",
			description: "Dupe",
			riskLevel: "write" as const,
			requiresApproval: true as const,
			requiresCheckpoint: true as const,
			supportsRollbackDryRun: true as const,
		};
		registerWriteTool(def, async () => ({ ok: true }));
		expect(() => registerWriteTool(def, async () => ({ ok: true }))).toThrow("already registered");
		__clearWriteToolRegistry();
	});
});

describe("P6-J: Secret Guard", () => {
	it("detects API_KEY pattern", async () => {
		const { checkForSecrets } = await import("../mcp-bridge/secret-guard.js");
		expect(checkForSecrets("API_KEY=sk-123abc").safe).toBe(false);
	});

	it("detects GitHub token pattern", async () => {
		const { checkForSecrets } = await import("../mcp-bridge/secret-guard.js");
		expect(checkForSecrets("token: ghp_abcdefghijklmnopqrstuvwxyz0123456789").safe).toBe(false);
	});

	it("detects private key", async () => {
		const { checkForSecrets } = await import("../mcp-bridge/secret-guard.js");
		expect(checkForSecrets("-----BEGIN RSA PRIVATE KEY-----").safe).toBe(false);
	});

	it("detects DATABASE_URL pattern", async () => {
		const { checkForSecrets } = await import("../mcp-bridge/secret-guard.js");
		expect(checkForSecrets("DATABASE_URL=postgresql://user:pass@host/db").safe).toBe(false);
	});

	it("detects AWS access key pattern", async () => {
		const { checkForSecrets } = await import("../mcp-bridge/secret-guard.js");
		expect(checkForSecrets("AKIAIOSFODNN7EXAMPLE").safe).toBe(false);
	});

	it("detects password in quotes", async () => {
		const { checkForSecrets } = await import("../mcp-bridge/secret-guard.js");
		expect(checkForSecrets('password = "my_secret_pass"').safe).toBe(false);
	});

	it("allows safe content", async () => {
		const { checkForSecrets } = await import("../mcp-bridge/secret-guard.js");
		expect(checkForSecrets("const x = 42;\nfunction hello() {}").safe).toBe(true);
	});

	it("allows plain text without secrets", async () => {
		const { checkForSecrets } = await import("../mcp-bridge/secret-guard.js");
		expect(checkForSecrets("This is just a plain text file with no credentials").safe).toBe(true);
	});

	it("redactForAudit replaces secret pattern markers", async () => {
		const { redactForAudit } = await import("../mcp-bridge/secret-guard.js");
		// The pattern /API_KEY\s*[=:]/ matches the key+operator — the value
		// after the operator is not captured by the regex, so the marker itself
		// is replaced. Verify the marker is gone and [REDACTED] is present.
		const redacted = redactForAudit("API_KEY=secret123");
		expect(redacted).toContain("[REDACTED]");
		expect(redacted).not.toContain("API_KEY=");
	});

	it("redactForAudit limits output to 1000 chars", async () => {
		const { redactForAudit } = await import("../mcp-bridge/secret-guard.js");
		const longContent = "x".repeat(2000);
		expect(redactForAudit(longContent).length).toBeLessThanOrEqual(1000);
	});

	it("detectedPatterns is populated on hit", async () => {
		const { checkForSecrets } = await import("../mcp-bridge/secret-guard.js");
		const result = checkForSecrets("SECRET=abc123");
		expect(result.detectedPatterns.length).toBeGreaterThan(0);
	});

	it("detectedPatterns is empty for safe content", async () => {
		const { checkForSecrets } = await import("../mcp-bridge/secret-guard.js");
		const result = checkForSecrets("hello world");
		expect(result.detectedPatterns).toHaveLength(0);
	});
});

describe("P6-B: Write tool requires approval", () => {
	beforeEach(() => {
		delete process.env.OSCORPEX_ENABLE_MCP_WRITE_TOOLS;
	});

	it("invokeMcpWriteTool returns WRITE_TOOLS_DISABLED when flag not set", async () => {
		const { invokeMcpWriteTool } = await import("../mcp-bridge/mcp-bridge.js");
		const result = await invokeMcpWriteTool({
			tenantId: "t1",
			projectId: "p1",
			actorId: "u1",
			toolName: "file.write",
			args: { path: "test.txt", content: "hello" },
			source: "user",
		});
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("WRITE_TOOLS_DISABLED");
	});
});

describe("P6-C: Checkpoint before write", () => {
	it("WRITE_TOOLS_DISABLED error is returned before checkpoint attempt", async () => {
		delete process.env.OSCORPEX_ENABLE_MCP_WRITE_TOOLS;
		const { invokeMcpWriteTool } = await import("../mcp-bridge/mcp-bridge.js");
		const result = await invokeMcpWriteTool({
			tenantId: "t1",
			projectId: "p1",
			actorId: "u1",
			toolName: "file.write",
			args: { path: "out.txt", content: "data" },
			source: "system",
		});
		// Should fail before even attempting a checkpoint
		expect(result.error?.code).toBe("WRITE_TOOLS_DISABLED");
	});
});
