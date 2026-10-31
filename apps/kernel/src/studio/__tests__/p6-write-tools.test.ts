import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before dynamic imports
// ---------------------------------------------------------------------------

vi.mock("../mcp-bridge/write-tool-registry.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../mcp-bridge/write-tool-registry.js")>();
	return actual; // Use real registry; reset between tests via __clearWriteToolRegistry
});

vi.mock("../security/workspace-resolver.js", () => ({
	resolveWorkspacePath: vi.fn((_scope: unknown, rel?: string) => `/workspace/t1/p1${rel ? `/${rel}` : ""}`),
	assertInsideWorkspace: vi.fn(),
}));

vi.mock("../logger.js", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inv(toolName: string, args: Record<string, unknown>) {
	return {
		tenantId: "t1",
		projectId: "p1",
		actorId: "u1",
		toolName,
		args,
		source: "user" as const,
	};
}

// ---------------------------------------------------------------------------
// P6-D: file.write
// ---------------------------------------------------------------------------

describe("P6-D: file.write tool", () => {
	beforeEach(async () => {
		const { __clearWriteToolRegistry } = await import("../mcp-bridge/write-tool-registry.js");
		__clearWriteToolRegistry();
	});

	it("rejects missing path — INVALID_INPUT", async () => {
		const { fileWrite } = await import("../mcp-bridge/write-tools.js");
		const result = await fileWrite(inv("file.write", {}));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_INPUT");
	});

	it("rejects empty path — INVALID_INPUT", async () => {
		const { fileWrite } = await import("../mcp-bridge/write-tools.js");
		const result = await fileWrite(inv("file.write", { path: "", content: "x" }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_INPUT");
	});

	it("rejects oversized content (> 200 000 chars)", async () => {
		const { fileWrite } = await import("../mcp-bridge/write-tools.js");
		const result = await fileWrite(inv("file.write", { path: "big.txt", content: "x".repeat(300_000) }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_INPUT");
	});

	it("accepts valid file write — create mode", async () => {
		const { fileWrite } = await import("../mcp-bridge/write-tools.js");
		const result = await fileWrite(
			inv("file.write", { path: "src/index.ts", content: "console.log('hello')", mode: "create" }),
		);
		expect(result.ok).toBe(true);
		expect((result.data as Record<string, unknown>)?.action).toBe("file.write");
		expect((result.data as Record<string, unknown>)?.mode).toBe("create");
		expect((result.data as Record<string, unknown>)?.message).toMatch(/approval/i);
	});

	it("accepts valid file write — overwrite mode", async () => {
		const { fileWrite } = await import("../mcp-bridge/write-tools.js");
		const result = await fileWrite(
			inv("file.write", { path: "src/index.ts", content: "// updated", mode: "overwrite" }),
		);
		expect(result.ok).toBe(true);
		expect((result.data as Record<string, unknown>)?.mode).toBe("overwrite");
	});

	it("defaults mode to create when omitted", async () => {
		const { fileWrite } = await import("../mcp-bridge/write-tools.js");
		const result = await fileWrite(inv("file.write", { path: "new.ts", content: "export {}" }));
		expect(result.ok).toBe(true);
		expect((result.data as Record<string, unknown>)?.mode).toBe("create");
	});

	it("rejects unknown extra fields (strict schema)", async () => {
		const { fileWrite } = await import("../mcp-bridge/write-tools.js");
		const result = await fileWrite(inv("file.write", { path: "a.ts", content: "x", extraField: "sneaky" }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_INPUT");
	});

	it("returns contentLength in data", async () => {
		const { fileWrite } = await import("../mcp-bridge/write-tools.js");
		const content = "hello world";
		const result = await fileWrite(inv("file.write", { path: "hello.ts", content }));
		expect(result.ok).toBe(true);
		expect((result.data as Record<string, unknown>)?.contentLength).toBe(content.length);
	});
});

// ---------------------------------------------------------------------------
// P6-D: file.write — workspace violation
// ---------------------------------------------------------------------------

describe("P6-D: file.write — workspace enforcement", () => {
	beforeEach(async () => {
		const { __clearWriteToolRegistry } = await import("../mcp-bridge/write-tool-registry.js");
		__clearWriteToolRegistry();
	});

	it("returns WORKSPACE_VIOLATION when assertInsideWorkspace throws", async () => {
		const { assertInsideWorkspace } = await import("../security/workspace-resolver.js");
		vi.mocked(assertInsideWorkspace).mockImplementationOnce(() => {
			throw new Error("Path escapes workspace");
		});

		const { fileWrite } = await import("../mcp-bridge/write-tools.js");
		const result = await fileWrite(inv("file.write", { path: "src/ok.ts", content: "x", mode: "overwrite" }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("WORKSPACE_VIOLATION");
	});

	it("returns WORKSPACE_VIOLATION when resolveWorkspacePath throws", async () => {
		const { resolveWorkspacePath } = await import("../security/workspace-resolver.js");
		vi.mocked(resolveWorkspacePath).mockImplementationOnce(() => {
			throw new Error("Path traversal attempt");
		});

		const { fileWrite } = await import("../mcp-bridge/write-tools.js");
		const result = await fileWrite(inv("file.write", { path: "../etc/passwd", content: "x", mode: "overwrite" }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("WORKSPACE_VIOLATION");
	});
});

// ---------------------------------------------------------------------------
// P6-E: docs.generate
// ---------------------------------------------------------------------------

describe("P6-E: docs.generate tool", () => {
	beforeEach(async () => {
		const { __clearWriteToolRegistry } = await import("../mcp-bridge/write-tool-registry.js");
		__clearWriteToolRegistry();
	});

	it("accepts readme type", async () => {
		const { docsGenerate } = await import("../mcp-bridge/write-tools.js");
		const result = await docsGenerate(inv("docs.generate", { type: "readme", projectId: "p1" }));
		expect(result.ok).toBe(true);
		expect((result.data as Record<string, unknown>)?.action).toBe("docs.generate");
		expect((result.data as Record<string, unknown>)?.type).toBe("readme");
	});

	it("accepts changelog type", async () => {
		const { docsGenerate } = await import("../mcp-bridge/write-tools.js");
		const result = await docsGenerate(inv("docs.generate", { type: "changelog", projectId: "p1" }));
		expect(result.ok).toBe(true);
		expect((result.data as Record<string, unknown>)?.type).toBe("changelog");
	});

	it("accepts api-docs type", async () => {
		const { docsGenerate } = await import("../mcp-bridge/write-tools.js");
		const result = await docsGenerate(inv("docs.generate", { type: "api-docs", projectId: "p1" }));
		expect(result.ok).toBe(true);
		expect((result.data as Record<string, unknown>)?.type).toBe("api-docs");
	});

	it("rejects invalid doc type — INVALID_INPUT", async () => {
		const { docsGenerate } = await import("../mcp-bridge/write-tools.js");
		const result = await docsGenerate(inv("docs.generate", { type: "invalid", projectId: "p1" }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_INPUT");
	});

	it("rejects missing projectId — INVALID_INPUT", async () => {
		const { docsGenerate } = await import("../mcp-bridge/write-tools.js");
		const result = await docsGenerate(inv("docs.generate", { type: "readme" }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_INPUT");
	});

	it("rejects unknown extra fields (strict schema)", async () => {
		const { docsGenerate } = await import("../mcp-bridge/write-tools.js");
		const result = await docsGenerate(inv("docs.generate", { type: "readme", projectId: "p1", extra: true }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_INPUT");
	});

	it("response includes approval message", async () => {
		const { docsGenerate } = await import("../mcp-bridge/write-tools.js");
		const result = await docsGenerate(inv("docs.generate", { type: "readme", projectId: "p1" }));
		expect((result.data as Record<string, unknown>)?.message).toMatch(/approval/i);
	});
});

// ---------------------------------------------------------------------------
// P6-F: task tools
// ---------------------------------------------------------------------------

describe("P6-F: task.comment tool", () => {
	beforeEach(async () => {
		const { __clearWriteToolRegistry } = await import("../mcp-bridge/write-tool-registry.js");
		__clearWriteToolRegistry();
	});

	it("accepts valid comment", async () => {
		const { taskComment } = await import("../mcp-bridge/write-tools.js");
		const result = await taskComment(inv("task.comment", { taskId: "t-1", comment: "This looks good" }));
		expect(result.ok).toBe(true);
		expect((result.data as Record<string, unknown>)?.action).toBe("task.comment");
		expect((result.data as Record<string, unknown>)?.taskId).toBe("t-1");
	});

	it("rejects empty taskId — INVALID_INPUT", async () => {
		const { taskComment } = await import("../mcp-bridge/write-tools.js");
		const result = await taskComment(inv("task.comment", { taskId: "", comment: "hi" }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_INPUT");
	});

	it("rejects empty comment — INVALID_INPUT", async () => {
		const { taskComment } = await import("../mcp-bridge/write-tools.js");
		const result = await taskComment(inv("task.comment", { taskId: "t-1", comment: "" }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_INPUT");
	});

	it("rejects comment exceeding 5000 chars — INVALID_INPUT", async () => {
		const { taskComment } = await import("../mcp-bridge/write-tools.js");
		const result = await taskComment(inv("task.comment", { taskId: "t-1", comment: "x".repeat(5001) }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_INPUT");
	});

	it("returns commentLength in data", async () => {
		const { taskComment } = await import("../mcp-bridge/write-tools.js");
		const comment = "looks great";
		const result = await taskComment(inv("task.comment", { taskId: "t-1", comment }));
		expect(result.ok).toBe(true);
		expect((result.data as Record<string, unknown>)?.commentLength).toBe(comment.length);
	});
});

describe("P6-F: task.updateMetadata tool", () => {
	beforeEach(async () => {
		const { __clearWriteToolRegistry } = await import("../mcp-bridge/write-tool-registry.js");
		__clearWriteToolRegistry();
	});

	it("accepts valid metadata update", async () => {
		const { taskUpdateMetadata } = await import("../mcp-bridge/write-tools.js");
		const result = await taskUpdateMetadata(
			inv("task.updateMetadata", { taskId: "t-1", metadata: { priority: "high", sprint: 3 } }),
		);
		expect(result.ok).toBe(true);
		expect((result.data as Record<string, unknown>)?.action).toBe("task.updateMetadata");
	});

	it("returns metadataKeys in data", async () => {
		const { taskUpdateMetadata } = await import("../mcp-bridge/write-tools.js");
		const result = await taskUpdateMetadata(
			inv("task.updateMetadata", { taskId: "t-1", metadata: { priority: "high", sprint: 3 } }),
		);
		expect(result.ok).toBe(true);
		const keys = (result.data as Record<string, unknown>)?.metadataKeys as string[];
		expect(keys).toContain("priority");
		expect(keys).toContain("sprint");
	});

	it("accepts empty metadata object", async () => {
		const { taskUpdateMetadata } = await import("../mcp-bridge/write-tools.js");
		const result = await taskUpdateMetadata(inv("task.updateMetadata", { taskId: "t-1", metadata: {} }));
		expect(result.ok).toBe(true);
	});

	it("rejects missing taskId — INVALID_INPUT", async () => {
		const { taskUpdateMetadata } = await import("../mcp-bridge/write-tools.js");
		const result = await taskUpdateMetadata(inv("task.updateMetadata", { metadata: { k: "v" } }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_INPUT");
	});

	it("rejects missing metadata field — INVALID_INPUT", async () => {
		const { taskUpdateMetadata } = await import("../mcp-bridge/write-tools.js");
		const result = await taskUpdateMetadata(inv("task.updateMetadata", { taskId: "t-1" }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_INPUT");
	});
});

// ---------------------------------------------------------------------------
// P6-G: git.createBranch
// ---------------------------------------------------------------------------

describe("P6-G: git.createBranch tool", () => {
	beforeEach(async () => {
		const { __clearWriteToolRegistry } = await import("../mcp-bridge/write-tool-registry.js");
		__clearWriteToolRegistry();
	});

	it("accepts valid simple branch name", async () => {
		const { gitCreateBranch } = await import("../mcp-bridge/write-tools.js");
		const result = await gitCreateBranch(inv("git.createBranch", { branchName: "my-feature" }));
		expect(result.ok).toBe(true);
		expect((result.data as Record<string, unknown>)?.action).toBe("git.createBranch");
		expect((result.data as Record<string, unknown>)?.branchName).toBe("my-feature");
	});

	it("accepts feature/ prefix branch name", async () => {
		const { gitCreateBranch } = await import("../mcp-bridge/write-tools.js");
		const result = await gitCreateBranch(inv("git.createBranch", { branchName: "feature/my-feature" }));
		expect(result.ok).toBe(true);
	});

	it("defaults fromRef to HEAD when omitted", async () => {
		const { gitCreateBranch } = await import("../mcp-bridge/write-tools.js");
		const result = await gitCreateBranch(inv("git.createBranch", { branchName: "feat-123" }));
		expect(result.ok).toBe(true);
		expect((result.data as Record<string, unknown>)?.fromRef).toBe("HEAD");
	});

	it("accepts explicit fromRef", async () => {
		const { gitCreateBranch } = await import("../mcp-bridge/write-tools.js");
		const result = await gitCreateBranch(inv("git.createBranch", { branchName: "hotfix-99", fromRef: "main" }));
		expect(result.ok).toBe(true);
		expect((result.data as Record<string, unknown>)?.fromRef).toBe("main");
	});

	it("rejects branch with shell metacharacters (semicolon) — INVALID_BRANCH_NAME", async () => {
		const { gitCreateBranch } = await import("../mcp-bridge/write-tools.js");
		const result = await gitCreateBranch(inv("git.createBranch", { branchName: "feature; rm -rf /" }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_BRANCH_NAME");
	});

	it("rejects branch starting with double dash — INVALID_BRANCH_NAME", async () => {
		const { gitCreateBranch } = await import("../mcp-bridge/write-tools.js");
		const result = await gitCreateBranch(inv("git.createBranch", { branchName: "--output=/etc/passwd" }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_BRANCH_NAME");
	});

	it("rejects branch with path traversal (..) — INVALID_BRANCH_NAME", async () => {
		const { gitCreateBranch } = await import("../mcp-bridge/write-tools.js");
		const result = await gitCreateBranch(inv("git.createBranch", { branchName: "feature/../../../etc" }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_BRANCH_NAME");
	});

	it("rejects branch with backtick injection — INVALID_BRANCH_NAME", async () => {
		const { gitCreateBranch } = await import("../mcp-bridge/write-tools.js");
		const result = await gitCreateBranch(inv("git.createBranch", { branchName: "feat`id`" }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_BRANCH_NAME");
	});

	it("rejects branch with whitespace — INVALID_BRANCH_NAME", async () => {
		const { gitCreateBranch } = await import("../mcp-bridge/write-tools.js");
		const result = await gitCreateBranch(inv("git.createBranch", { branchName: "feat ure" }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_BRANCH_NAME");
	});

	it("rejects empty branch name — INVALID_INPUT", async () => {
		const { gitCreateBranch } = await import("../mcp-bridge/write-tools.js");
		const result = await gitCreateBranch(inv("git.createBranch", { branchName: "" }));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_INPUT");
	});

	it("rejects missing branchName — INVALID_INPUT", async () => {
		const { gitCreateBranch } = await import("../mcp-bridge/write-tools.js");
		const result = await gitCreateBranch(inv("git.createBranch", {}));
		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe("INVALID_INPUT");
	});

	it("response includes approval message", async () => {
		const { gitCreateBranch } = await import("../mcp-bridge/write-tools.js");
		const result = await gitCreateBranch(inv("git.createBranch", { branchName: "feat-abc" }));
		expect((result.data as Record<string, unknown>)?.message).toMatch(/approval/i);
	});
});

// ---------------------------------------------------------------------------
// registerAllWriteTools integration
// ---------------------------------------------------------------------------

describe("registerAllWriteTools — registry integration", () => {
	beforeEach(async () => {
		const { __clearWriteToolRegistry } = await import("../mcp-bridge/write-tool-registry.js");
		__clearWriteToolRegistry();
	});

	it("registers all 5 write tools without throwing", async () => {
		const { registerAllWriteTools } = await import("../mcp-bridge/write-tools.js");
		const { listWriteTools } = await import("../mcp-bridge/write-tool-registry.js");
		expect(() => registerAllWriteTools()).not.toThrow();
		const tools = listWriteTools();
		const names = tools.map((t) => t.name);
		expect(names).toContain("file.write");
		expect(names).toContain("docs.generate");
		expect(names).toContain("task.comment");
		expect(names).toContain("task.updateMetadata");
		expect(names).toContain("git.createBranch");
	});

	it("throws on duplicate registration", async () => {
		const { registerAllWriteTools } = await import("../mcp-bridge/write-tools.js");
		registerAllWriteTools();
		expect(() => registerAllWriteTools()).toThrow(/already registered/i);
	});

	it("all registered tools have requiresApproval true", async () => {
		const { registerAllWriteTools } = await import("../mcp-bridge/write-tools.js");
		const { listWriteTools } = await import("../mcp-bridge/write-tool-registry.js");
		registerAllWriteTools();
		for (const tool of listWriteTools()) {
			expect(tool.requiresApproval).toBe(true);
		}
	});

	it("all registered tools have riskLevel write", async () => {
		const { registerAllWriteTools } = await import("../mcp-bridge/write-tools.js");
		const { listWriteTools } = await import("../mcp-bridge/write-tool-registry.js");
		registerAllWriteTools();
		for (const tool of listWriteTools()) {
			expect(tool.riskLevel).toBe("write");
		}
	});
});
