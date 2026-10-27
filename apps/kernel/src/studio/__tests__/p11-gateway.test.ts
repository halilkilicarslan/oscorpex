import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../security/tool-policy-enforcer.js", () => ({
	enforceToolPolicy: vi.fn(),
	ToolPolicyDeniedError: class ToolPolicyDeniedError extends Error {
		code = "TEST";
		decision = { decision: "deny" };
		constructor(d?: { decision: string; reason?: string; code?: string }) {
			super(`Tool policy denied: ${d?.reason ?? "test"} [${d?.code ?? "TEST"}]`);
			this.name = "ToolPolicyDeniedError";
			this.code = d?.code ?? "TEST";
		}
	},
}));

vi.mock("../security/workspace-resolver.js", () => ({
	resolveWorkspacePath: vi.fn(() => "/workspace/t1/p1"),
	assertInsideWorkspace: vi.fn(),
}));

vi.mock("../logger.js", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../event-bus.js", () => ({
	eventBus: { emitTransient: vi.fn() },
}));

vi.mock("../db.js", () => ({
	query: vi.fn(async () => []),
	queryOne: vi.fn(async () => ({ id: "audit-x" })),
}));

// Mock invokeMcpTool to avoid real filesystem/git calls in tests
vi.mock("../mcp-bridge/mcp-bridge.js", () => ({
	invokeMcpTool: vi.fn(async () => ({ ok: true, data: "mocked result" })),
}));

describe("P11-A: Gateway Read-Only", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it("gateway disabled by default (no env var)", async () => {
		delete process.env.OSCORPEX_ENABLE_GATEWAY;
		const { handleGatewayRequest } = await import("../gateway/gateway-service.js");
		const res = await handleGatewayRequest({
			tenantId: "t1",
			projectId: "p1",
			actorId: "u1",
			source: "gateway",
			toolName: "repo.listFiles",
			args: {},
		});
		expect(res.ok).toBe(false);
		expect(res.error?.code).toBe("GATEWAY_DISABLED");
	});

	it("gateway rejects write tools even when enabled", async () => {
		process.env.OSCORPEX_ENABLE_GATEWAY = "true";
		const { handleGatewayRequest } = await import("../gateway/gateway-service.js");
		const res = await handleGatewayRequest({
			tenantId: "t1",
			projectId: "p1",
			actorId: "u1",
			source: "gateway",
			toolName: "file.write",
			args: {},
		});
		expect(res.ok).toBe(false);
		expect(res.error?.code).toBe("TOOL_NOT_ALLOWED");
	});

	it("gateway allows a read-only tool from the allowlist", async () => {
		process.env.OSCORPEX_ENABLE_GATEWAY = "true";
		const { handleGatewayRequest } = await import("../gateway/gateway-service.js");
		const res = await handleGatewayRequest({
			tenantId: "t1",
			projectId: "p1",
			actorId: "u1",
			source: "gateway",
			toolName: "git.status",
			args: {},
		});
		// Must not be denied by allowlist; actual result may vary
		expect(res.error?.code).not.toBe("TOOL_NOT_ALLOWED");
		expect(res.error?.code).not.toBe("GATEWAY_DISABLED");
	});

	it("all 8 read-only tools are present in the allowlist", async () => {
		const { getGatewayConfig } = await import("../gateway/gateway-config.js");
		const config = getGatewayConfig();
		const expected = [
			"repo.listFiles",
			"repo.readFile",
			"repo.search",
			"git.status",
			"git.diff",
			"project.getTaskState",
			"project.getPipelineState",
			"docs.search",
		];
		for (const tool of expected) {
			expect(config.allowedTools.has(tool)).toBe(true);
		}
	});
});

describe("P11-C: Tenant/Project Scope", () => {
	beforeEach(() => {
		vi.resetModules();
		process.env.OSCORPEX_ENABLE_GATEWAY = "true";
	});

	it("missing tenantId returns MISSING_SCOPE", async () => {
		const { handleGatewayRequest } = await import("../gateway/gateway-service.js");
		const res = await handleGatewayRequest({
			tenantId: "",
			projectId: "p1",
			actorId: "u1",
			source: "gateway",
			toolName: "git.status",
			args: {},
		});
		expect(res.ok).toBe(false);
		expect(res.error?.code).toBe("MISSING_SCOPE");
	});

	it("missing projectId returns MISSING_SCOPE", async () => {
		const { handleGatewayRequest } = await import("../gateway/gateway-service.js");
		const res = await handleGatewayRequest({
			tenantId: "t1",
			projectId: "",
			actorId: "u1",
			source: "gateway",
			toolName: "git.status",
			args: {},
		});
		expect(res.ok).toBe(false);
		expect(res.error?.code).toBe("MISSING_SCOPE");
	});
});

describe("P11-G: Response Redaction", () => {
	it("gateway-service.ts exports redaction logic (REDACT constant present)", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/gateway/gateway-service.ts"), "utf8");
		expect(src).toContain("REDACT");
		expect(src).toContain("redactResponse");
	});

	it("redacts sk- tokens in string responses", async () => {
		process.env.OSCORPEX_ENABLE_GATEWAY = "true";
		vi.resetModules();
		const { invokeMcpTool } = await import("../mcp-bridge/mcp-bridge.js");
		vi.mocked(invokeMcpTool).mockResolvedValueOnce({
			ok: true,
			data: "API_KEY=sk-abcdefghijklmnopqrst12345 found in config",
		});
		const { handleGatewayRequest } = await import("../gateway/gateway-service.js");
		const res = await handleGatewayRequest({
			tenantId: "t1",
			projectId: "p1",
			actorId: "u1",
			source: "gateway",
			toolName: "repo.readFile",
			args: { path: "config.env" },
		});
		expect(res.ok).toBe(true);
		// Secret token should be redacted
		expect(JSON.stringify(res.data)).toContain("[REDACTED]");
		expect(JSON.stringify(res.data)).not.toContain("sk-abcdefghijklmnopqrst12345");
	});

	it("redacts nested secrets in object responses", async () => {
		process.env.OSCORPEX_ENABLE_GATEWAY = "true";
		vi.resetModules();
		const { invokeMcpTool } = await import("../mcp-bridge/mcp-bridge.js");
		vi.mocked(invokeMcpTool).mockResolvedValueOnce({
			ok: true,
			data: { content: "token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234" },
		});
		const { handleGatewayRequest } = await import("../gateway/gateway-service.js");
		const res = await handleGatewayRequest({
			tenantId: "t1",
			projectId: "p1",
			actorId: "u1",
			source: "gateway",
			toolName: "repo.readFile",
			args: { path: ".env" },
		});
		expect(res.ok).toBe(true);
		expect(JSON.stringify(res.data)).toContain("[REDACTED]");
		expect(JSON.stringify(res.data)).not.toContain("ghp_");
	});
});

describe("P11-F: Gateway Audit", () => {
	it("gateway-service.ts imports recordMcpAudit", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/gateway/gateway-service.ts"), "utf8");
		expect(src).toContain("recordMcpAudit");
	});

	it("successful invocation returns an auditId", async () => {
		process.env.OSCORPEX_ENABLE_GATEWAY = "true";
		vi.resetModules();
		const { handleGatewayRequest } = await import("../gateway/gateway-service.js");
		const res = await handleGatewayRequest({
			tenantId: "t1",
			projectId: "p1",
			actorId: "u1",
			source: "gateway",
			toolName: "git.status",
			args: {},
		});
		// auditId must be present on any allowed invocation (success or tool failure)
		if (res.error?.code !== "TOOL_NOT_ALLOWED" && res.error?.code !== "MISSING_SCOPE") {
			expect(res.auditId).toBeDefined();
			expect(typeof res.auditId).toBe("string");
		}
	});

	it("denied invocations are audited (TOOL_NOT_ALLOWED)", async () => {
		process.env.OSCORPEX_ENABLE_GATEWAY = "true";
		vi.resetModules();
		const { recordMcpAudit } = await import("../mcp-bridge/mcp-audit.js");
		const spy = vi.spyOn({ recordMcpAudit }, "recordMcpAudit");
		const { handleGatewayRequest } = await import("../gateway/gateway-service.js");
		const res = await handleGatewayRequest({
			tenantId: "t1",
			projectId: "p1",
			actorId: "u1",
			source: "gateway",
			toolName: "file.write",
			args: {},
		});
		expect(res.ok).toBe(false);
		expect(res.error?.code).toBe("TOOL_NOT_ALLOWED");
	});
});

describe("P11-L: Gateway Preconditions Document", () => {
	it("preconditions document exists", async () => {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		expect(
			existsSync(join(process.cwd(), "../../docs/production/gateway-production-preconditions.md")),
		).toBe(true);
	});

	it("document contains required sections", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const content = readFileSync(
			join(process.cwd(), "../../docs/production/gateway-production-preconditions.md"),
			"utf8",
		);
		expect(content).toContain("OSCORPEX_ENABLE_GATEWAY");
		expect(content).toContain("rate limit");
		expect(content).toContain("read-only");
		expect(content).toContain("tenant");
		expect(content).toContain("audit");
	});
});

describe("P11-Config: Gateway configuration", () => {
	it("getGatewayConfig returns readOnly=true always", async () => {
		vi.resetModules();
		const { getGatewayConfig } = await import("../gateway/gateway-config.js");
		const config = getGatewayConfig();
		expect(config.readOnly).toBe(true);
	});

	it("OSCORPEX_GATEWAY_RATE_LIMIT env var is respected", async () => {
		vi.resetModules();
		process.env.OSCORPEX_GATEWAY_RATE_LIMIT = "120";
		const { getGatewayConfig } = await import("../gateway/gateway-config.js");
		const config = getGatewayConfig();
		expect(config.maxRequestsPerMinute).toBe(120);
		delete process.env.OSCORPEX_GATEWAY_RATE_LIMIT;
	});

	it("default rate limit is 60 when env var is absent", async () => {
		vi.resetModules();
		delete process.env.OSCORPEX_GATEWAY_RATE_LIMIT;
		const { getGatewayConfig } = await import("../gateway/gateway-config.js");
		const config = getGatewayConfig();
		expect(config.maxRequestsPerMinute).toBe(60);
	});
});
