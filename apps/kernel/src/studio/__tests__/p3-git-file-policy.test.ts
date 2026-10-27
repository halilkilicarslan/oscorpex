import { describe, expect, it, vi } from "vitest";

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
	assertInsideWorkspace: vi.fn(),
	WorkspaceViolationError: class extends Error {
		scope: unknown;
		constructor(m: string, s: unknown) {
			super(m);
			this.scope = s;
		}
	},
}));
vi.mock("../logger.js", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe("P3-3: Git policy enforcement", () => {
	it("allows git diff (read operation)", async () => {
		const { enforceGitPolicy } = await import("../security/git-file-policy.js");
		expect(() =>
			enforceGitPolicy({
				operation: "diff",
				source: "user",
				actorId: "u1",
				tenantId: "t1",
				projectId: "p1",
			}),
		).not.toThrow();
	});

	it("denies git ref with shell metacharacters", async () => {
		const { enforceGitPolicy } = await import("../security/git-file-policy.js");
		expect(() =>
			enforceGitPolicy({
				operation: "checkout",
				ref: "main; rm -rf /",
				source: "user",
				actorId: "u1",
				tenantId: "t1",
				projectId: "p1",
			}),
		).toThrow("shell metacharacters");
	});

	it("denies git ref starting with --", async () => {
		const { enforceGitPolicy } = await import("../security/git-file-policy.js");
		expect(() =>
			enforceGitPolicy({
				operation: "checkout",
				ref: "--output=/etc/passwd",
				source: "user",
				actorId: "u1",
				tenantId: "t1",
				projectId: "p1",
			}),
		).toThrow("flag");
	});

	it("classifies reset-hard as execute risk", async () => {
		const { enforceToolPolicy } = await import("../security/tool-policy-enforcer.js");
		const { enforceGitPolicy } = await import("../security/git-file-policy.js");
		enforceGitPolicy({
			operation: "reset-hard",
			source: "system",
			actorId: "sys",
			tenantId: "t1",
			projectId: "p1",
		});
		expect(vi.mocked(enforceToolPolicy)).toHaveBeenCalledWith(
			expect.objectContaining({
				request: expect.objectContaining({ riskLevel: "execute" }),
			}),
		);
	});

	it("git push-force classified as execute risk", async () => {
		const { enforceToolPolicy } = await import("../security/tool-policy-enforcer.js");
		const { enforceGitPolicy } = await import("../security/git-file-policy.js");
		enforceGitPolicy({
			operation: "push-force",
			source: "system",
			actorId: "sys",
			tenantId: "t1",
			projectId: "p1",
		});
		expect(vi.mocked(enforceToolPolicy)).toHaveBeenCalledWith(
			expect.objectContaining({
				request: expect.objectContaining({ riskLevel: "execute" }),
			}),
		);
	});
});

describe("P3-3: File policy enforcement", () => {
	it("allows file read inside workspace", async () => {
		const { enforceFilePolicy } = await import("../security/git-file-policy.js");
		expect(() =>
			enforceFilePolicy({
				operation: "read",
				path: "/workspace/t1/p1/src/index.ts",
				scope: { tenantId: "t1", projectId: "p1" },
				source: "llm",
				actorId: "agent-1",
			}),
		).not.toThrow();
	});

	it("file delete classified as execute risk", async () => {
		const { enforceToolPolicy } = await import("../security/tool-policy-enforcer.js");
		const { enforceFilePolicy } = await import("../security/git-file-policy.js");
		enforceFilePolicy({
			operation: "delete",
			path: "/workspace/t1/p1/temp.txt",
			scope: { tenantId: "t1", projectId: "p1" },
			source: "system",
			actorId: "sys",
		});
		expect(vi.mocked(enforceToolPolicy)).toHaveBeenCalledWith(
			expect.objectContaining({
				request: expect.objectContaining({ riskLevel: "execute" }),
			}),
		);
	});

	it("file write outside workspace denied by assertInsideWorkspace", async () => {
		const { assertInsideWorkspace } = await import("../security/workspace-resolver.js");
		vi.mocked(assertInsideWorkspace).mockImplementationOnce(() => {
			throw new Error("Path outside workspace");
		});
		const { enforceFilePolicy } = await import("../security/git-file-policy.js");
		expect(() =>
			enforceFilePolicy({
				operation: "write",
				path: "/etc/passwd",
				scope: { tenantId: "t1", projectId: "p1" },
				source: "llm",
				actorId: "agent-1",
			}),
		).toThrow("Path outside workspace");
	});
});
