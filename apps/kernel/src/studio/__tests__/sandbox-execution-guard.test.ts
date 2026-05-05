// ---------------------------------------------------------------------------
// Oscorpex — Unit Tests: sandbox-execution-guard.ts
// Security-critical: sandbox policy setup, pre/post enforcement, cleanup.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionWorkspace } from "../execution-workspace.js";
import type { SandboxPolicy } from "../sandbox-manager.js";

// ---------------------------------------------------------------------------
// Mocks — declared before importing the module under test
// ---------------------------------------------------------------------------

const mockResolveTaskPolicy = vi.fn();
const mockStartSandboxSession = vi.fn();
const mockEndSandboxSession = vi.fn();
const mockEnforceToolCheck = vi.fn();
const mockEnforcePathChecks = vi.fn();
const mockEnforceOutputSizeCheck = vi.fn();

vi.mock("../sandbox-manager.js", () => ({
	SandboxViolationError: class SandboxViolationError extends Error {
		public readonly violation: { type: string; detail: string; timestamp: string };
		constructor(violation: { type: string; detail: string; timestamp: string }) {
			super(`Sandbox violation (${violation.type}): ${violation.detail}`);
			this.name = "SandboxViolationError";
			this.violation = violation;
		}
	},
	resolveTaskPolicy: (...args: unknown[]) => mockResolveTaskPolicy(...args),
	startSandboxSession: (...args: unknown[]) => mockStartSandboxSession(...args),
	endSandboxSession: (...args: unknown[]) => mockEndSandboxSession(...args),
	enforceToolCheck: (...args: unknown[]) => mockEnforceToolCheck(...args),
	enforcePathChecks: (...args: unknown[]) => mockEnforcePathChecks(...args),
	enforceOutputSizeCheck: (...args: unknown[]) => mockEnforceOutputSizeCheck(...args),
}));

const mockResolveWorkspace = vi.fn();

vi.mock("../execution-workspace.js", () => ({
	resolveWorkspace: (...args: unknown[]) => mockResolveWorkspace(...args),
}));

vi.mock("../logger.js", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

// Import module under test after mocks are registered
import {
	closeSandboxExecution,
	enforceSandboxHardPreflight,
	enforceSandboxPostExecution,
	enforceSandboxPreExecution,
	setupSandboxExecution,
} from "../execution/sandbox-execution-guard.js";
import type { SandboxExecutionContext } from "../execution/sandbox-execution-guard.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePolicy(overrides: Partial<SandboxPolicy> = {}): SandboxPolicy {
	return {
		id: "policy-1",
		projectId: "proj-1",
		isolationLevel: "workspace",
		allowedTools: ["read", "write"],
		deniedTools: ["rm_rf", "sudo"],
		filesystemScope: ["/tmp/repo"],
		networkPolicy: "project_only",
		maxExecutionTimeMs: 300_000,
		maxOutputSizeBytes: 10_485_760,
		elevatedCapabilities: [],
		enforcementMode: "hard",
		...overrides,
	};
}

function makeTask(overrides: Partial<{ id: string; title: string; riskLevel: string }> = {}) {
	return {
		id: overrides.id ?? "task-1",
		phaseId: "phase-1",
		title: overrides.title ?? "Implement feature",
		description: "Do the thing",
		assignedAgent: "dev-agent",
		status: "pending" as const,
		complexity: "medium" as const,
		dependsOn: [],
		branch: "main",
		retryCount: 0,
		revisionCount: 0,
		requiresApproval: false,
		riskLevel: (overrides.riskLevel ?? undefined) as "low" | "medium" | "high" | "critical" | undefined,
	} as unknown as import("../types.js").Task;
}

function makeWorkspace(overrides: Partial<ExecutionWorkspace> = {}): ExecutionWorkspace {
	return {
		type: "isolated",
		repoPath: "/tmp/isolated/task-1",
		isolated: true,
		writeBack: vi.fn().mockResolvedValue([]),
		cleanup: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// setupSandboxExecution
// ---------------------------------------------------------------------------

describe("setupSandboxExecution", () => {
	const projectId = "proj-1";
	const agentId = "agent-1";
	const agentRole = "developer";
	const repoPath = "/repo/project";

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("resolves task policy with provided parameters", async () => {
		const policy = makePolicy();
		const workspace = makeWorkspace();
		mockResolveTaskPolicy.mockResolvedValue(policy);
		mockResolveWorkspace.mockResolvedValue(workspace);
		mockStartSandboxSession.mockResolvedValue({ id: "session-1" });

		await setupSandboxExecution(projectId, makeTask(), agentId, agentRole, repoPath);

		expect(mockResolveTaskPolicy).toHaveBeenCalledWith(
			projectId,
			expect.objectContaining({ id: "task-1" }),
			agentRole,
			undefined,
		);
	});

	it("passes riskLevel to resolveTaskPolicy when provided", async () => {
		const policy = makePolicy({ enforcementMode: "hard" });
		const workspace = makeWorkspace();
		mockResolveTaskPolicy.mockResolvedValue(policy);
		mockResolveWorkspace.mockResolvedValue(workspace);
		mockStartSandboxSession.mockResolvedValue({ id: "session-2" });

		await setupSandboxExecution(projectId, makeTask(), agentId, agentRole, repoPath, "critical");

		expect(mockResolveTaskPolicy).toHaveBeenCalledWith(projectId, expect.anything(), agentRole, "critical");
	});

	it("returns context with resolved policy", async () => {
		const policy = makePolicy({ enforcementMode: "soft" });
		const workspace = makeWorkspace();
		mockResolveTaskPolicy.mockResolvedValue(policy);
		mockResolveWorkspace.mockResolvedValue(workspace);
		mockStartSandboxSession.mockResolvedValue({ id: "session-3" });

		const ctx = await setupSandboxExecution(projectId, makeTask(), agentId, agentRole, repoPath);

		expect(ctx.sandboxPolicy).toEqual(policy);
	});

	it("creates isolated workspace and assigns its repoPath to runtimeRepoPath", async () => {
		const policy = makePolicy();
		const workspace = makeWorkspace({ repoPath: "/tmp/isolated-ws" });
		mockResolveTaskPolicy.mockResolvedValue(policy);
		mockResolveWorkspace.mockResolvedValue(workspace);
		mockStartSandboxSession.mockResolvedValue({ id: "session-4" });

		const ctx = await setupSandboxExecution(projectId, makeTask(), agentId, agentRole, repoPath);

		expect(ctx.isolatedWorkspace).toBe(workspace);
		expect(ctx.runtimeRepoPath).toBe("/tmp/isolated-ws");
	});

	it("falls back to original repoPath when workspace repoPath is falsy", async () => {
		const policy = makePolicy();
		// workspace.repoPath = "" (falsy)
		const workspace = makeWorkspace({ repoPath: "" });
		mockResolveTaskPolicy.mockResolvedValue(policy);
		mockResolveWorkspace.mockResolvedValue(workspace);
		mockStartSandboxSession.mockResolvedValue({ id: "session-5" });

		const ctx = await setupSandboxExecution(projectId, makeTask(), agentId, agentRole, repoPath);

		expect(ctx.runtimeRepoPath).toBe(repoPath);
	});

	it("starts sandbox session after workspace creation", async () => {
		const policy = makePolicy();
		const workspace = makeWorkspace({ repoPath: "/tmp/ws" });
		mockResolveTaskPolicy.mockResolvedValue(policy);
		mockResolveWorkspace.mockResolvedValue(workspace);
		mockStartSandboxSession.mockResolvedValue({ id: "session-6" });

		const ctx = await setupSandboxExecution(projectId, makeTask(), agentId, agentRole, repoPath);

		expect(mockStartSandboxSession).toHaveBeenCalledWith({
			projectId,
			taskId: "task-1",
			agentId,
			workspacePath: "/tmp/ws",
		});
		expect(ctx.sandboxSessionId).toBe("session-6");
	});

	it("skips workspace creation when repoPath is empty string", async () => {
		const policy = makePolicy();
		mockResolveTaskPolicy.mockResolvedValue(policy);

		const ctx = await setupSandboxExecution(projectId, makeTask(), agentId, agentRole, "");

		expect(mockResolveWorkspace).not.toHaveBeenCalled();
		expect(mockStartSandboxSession).not.toHaveBeenCalled();
		expect(ctx.sandboxSessionId).toBeUndefined();
		expect(ctx.isolatedWorkspace).toBeUndefined();
	});

	it("returns partial context (non-blocking) when resolveTaskPolicy throws", async () => {
		mockResolveTaskPolicy.mockRejectedValue(new Error("DB down"));

		const ctx = await setupSandboxExecution(projectId, makeTask(), agentId, agentRole, repoPath);

		// Should still return a context — error is swallowed (non-blocking)
		expect(ctx).toBeDefined();
		expect(ctx.runtimeRepoPath).toBe(repoPath);
		expect(ctx.sandboxPolicy).toBeUndefined();
	});

	it("returns partial context when startSandboxSession throws", async () => {
		const policy = makePolicy();
		const workspace = makeWorkspace();
		mockResolveTaskPolicy.mockResolvedValue(policy);
		mockResolveWorkspace.mockResolvedValue(workspace);
		mockStartSandboxSession.mockRejectedValue(new Error("Session table missing"));

		const ctx = await setupSandboxExecution(projectId, makeTask(), agentId, agentRole, repoPath);

		expect(ctx).toBeDefined();
		expect(ctx.sandboxSessionId).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// enforceSandboxPreExecution
// ---------------------------------------------------------------------------

describe("enforceSandboxPreExecution", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnforceToolCheck.mockResolvedValue(undefined);
	});

	it("does nothing when sandboxPolicy is undefined", async () => {
		await enforceSandboxPreExecution(undefined, ["read"], "session-1");
		expect(mockEnforceToolCheck).not.toHaveBeenCalled();
	});

	it("does nothing when enforcementMode is off", async () => {
		const policy = makePolicy({ enforcementMode: "off" });
		await enforceSandboxPreExecution(policy, ["read"], "session-1");
		expect(mockEnforceToolCheck).not.toHaveBeenCalled();
	});

	it("calls enforceToolCheck for each tool in allowedTools", async () => {
		const policy = makePolicy({ enforcementMode: "hard", deniedTools: [] });
		await enforceSandboxPreExecution(policy, ["read", "write"], "session-1");

		expect(mockEnforceToolCheck).toHaveBeenCalledWith(policy, "read", "session-1");
		expect(mockEnforceToolCheck).toHaveBeenCalledWith(policy, "write", "session-1");
	});

	it("also calls enforceToolCheck for denied tools that appear in allowedTools", async () => {
		const policy = makePolicy({ enforcementMode: "hard", deniedTools: ["rm_rf", "sudo"] });
		// "sudo" is both in allowedTools and deniedTools — should get a second check
		await enforceSandboxPreExecution(policy, ["read", "sudo"], "session-1");

		// First loop: enforces all allowedTools (read + sudo)
		expect(mockEnforceToolCheck).toHaveBeenCalledWith(policy, "read", "session-1");
		expect(mockEnforceToolCheck).toHaveBeenCalledWith(policy, "sudo", "session-1");

		// Second loop: re-enforces denied tools that are in allowedTools
		const sudoCalls = mockEnforceToolCheck.mock.calls.filter((c) => c[1] === "sudo");
		expect(sudoCalls.length).toBe(2);
	});

	it("propagates SandboxViolationError in hard mode when tool is denied", async () => {
		const { SandboxViolationError } = await import("../sandbox-manager.js");
		const violation = { type: "tool_denied" as const, detail: "rm_rf blocked", timestamp: new Date().toISOString() };
		mockEnforceToolCheck.mockRejectedValueOnce(new SandboxViolationError(violation));

		const policy = makePolicy({ enforcementMode: "hard", deniedTools: ["rm_rf"] });
		await expect(enforceSandboxPreExecution(policy, ["rm_rf"], "session-1")).rejects.toThrow(SandboxViolationError);
	});

	it("does NOT throw when no tools provided", async () => {
		const policy = makePolicy({ enforcementMode: "hard" });
		await expect(enforceSandboxPreExecution(policy, [], "session-1")).resolves.toBeUndefined();
		expect(mockEnforceToolCheck).not.toHaveBeenCalled();
	});

	it("passes undefined sessionId through to enforceToolCheck", async () => {
		const policy = makePolicy({ enforcementMode: "soft", deniedTools: [] });
		await enforceSandboxPreExecution(policy, ["read"], undefined);
		expect(mockEnforceToolCheck).toHaveBeenCalledWith(policy, "read", undefined);
	});
});

// ---------------------------------------------------------------------------
// enforceSandboxHardPreflight
// ---------------------------------------------------------------------------

describe("enforceSandboxHardPreflight", () => {
	it("does nothing when policy is undefined", () => {
		expect(() => enforceSandboxHardPreflight(undefined, ["rm_rf"])).not.toThrow();
	});

	it("does nothing when enforcementMode is not hard", () => {
		const policy = makePolicy({ enforcementMode: "soft", deniedTools: ["rm_rf"] });
		expect(() => enforceSandboxHardPreflight(policy, ["rm_rf"])).not.toThrow();
	});

	it("does nothing when deniedTools list is empty", () => {
		const policy = makePolicy({ enforcementMode: "hard", deniedTools: [] });
		expect(() => enforceSandboxHardPreflight(policy, ["rm_rf"])).not.toThrow();
	});

	it("does nothing when no denied tool appears in allowedTools", () => {
		const policy = makePolicy({ enforcementMode: "hard", deniedTools: ["rm_rf", "sudo"] });
		expect(() => enforceSandboxHardPreflight(policy, ["read", "write"])).not.toThrow();
	});

	it("throws SandboxViolationError when a denied tool is present in allowedTools (hard mode)", async () => {
		const { SandboxViolationError } = await import("../sandbox-manager.js");
		const policy = makePolicy({ enforcementMode: "hard", deniedTools: ["rm_rf"] });
		expect(() => enforceSandboxHardPreflight(policy, ["read", "rm_rf"])).toThrow(SandboxViolationError);
	});

	it("includes the offending tool name in the error message", async () => {
		const { SandboxViolationError } = await import("../sandbox-manager.js");
		const policy = makePolicy({ enforcementMode: "hard", deniedTools: ["sudo", "rm_rf"] });
		try {
			enforceSandboxHardPreflight(policy, ["sudo"]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(SandboxViolationError);
			expect((err as InstanceType<typeof SandboxViolationError>).violation.type).toBe("tool_denied");
			expect((err as InstanceType<typeof SandboxViolationError>).violation.detail).toContain("sudo");
		}
	});

	it("throws listing all offending tools when multiple denied tools are in allowedTools", async () => {
		const { SandboxViolationError } = await import("../sandbox-manager.js");
		const policy = makePolicy({ enforcementMode: "hard", deniedTools: ["sudo", "rm_rf"] });
		try {
			enforceSandboxHardPreflight(policy, ["sudo", "rm_rf", "read"]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(SandboxViolationError);
			const detail = (err as InstanceType<typeof SandboxViolationError>).violation.detail;
			expect(detail).toContain("sudo");
			expect(detail).toContain("rm_rf");
		}
	});

	it("violation has type tool_denied", async () => {
		const { SandboxViolationError } = await import("../sandbox-manager.js");
		const policy = makePolicy({ enforcementMode: "hard", deniedTools: ["rm_rf"] });
		try {
			enforceSandboxHardPreflight(policy, ["rm_rf"]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect((err as InstanceType<typeof SandboxViolationError>).violation.type).toBe("tool_denied");
		}
	});
});

// ---------------------------------------------------------------------------
// enforceSandboxPostExecution
// ---------------------------------------------------------------------------

describe("enforceSandboxPostExecution", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnforcePathChecks.mockResolvedValue([]);
		mockEnforceOutputSizeCheck.mockResolvedValue(undefined);
	});

	it("does nothing when policy is undefined", async () => {
		const output = { filesCreated: [], filesModified: [], logs: [] };
		await enforceSandboxPostExecution(undefined, output, "session-1");
		expect(mockEnforcePathChecks).not.toHaveBeenCalled();
		expect(mockEnforceOutputSizeCheck).not.toHaveBeenCalled();
	});

	it("does nothing when enforcementMode is off", async () => {
		const policy = makePolicy({ enforcementMode: "off" });
		const output = { filesCreated: ["/repo/src/foo.ts"], filesModified: [], logs: [] };
		await enforceSandboxPostExecution(policy, output, "session-1");
		expect(mockEnforcePathChecks).not.toHaveBeenCalled();
		expect(mockEnforceOutputSizeCheck).not.toHaveBeenCalled();
	});

	it("calls enforcePathChecks with combined filesCreated and filesModified", async () => {
		const policy = makePolicy({ enforcementMode: "hard" });
		const output = {
			filesCreated: ["/repo/src/new.ts"],
			filesModified: ["/repo/src/existing.ts"],
			logs: [],
		};

		await enforceSandboxPostExecution(policy, output, "session-1");

		expect(mockEnforcePathChecks).toHaveBeenCalledWith(
			policy,
			["/repo/src/new.ts", "/repo/src/existing.ts"],
			"session-1",
		);
	});

	it("skips enforcePathChecks when both file lists are empty", async () => {
		const policy = makePolicy({ enforcementMode: "hard" });
		const output = { filesCreated: [], filesModified: [], logs: [] };

		await enforceSandboxPostExecution(policy, output, "session-1");

		expect(mockEnforcePathChecks).not.toHaveBeenCalled();
	});

	it("calls enforceOutputSizeCheck with JSON stringified size estimate", async () => {
		const policy = makePolicy({ enforcementMode: "hard" });
		const output = { filesCreated: [], filesModified: [], logs: ["done"] };

		await enforceSandboxPostExecution(policy, output, "session-1");

		const expectedSize = JSON.stringify(output).length;
		expect(mockEnforceOutputSizeCheck).toHaveBeenCalledWith(policy, expectedSize, "session-1");
	});

	it("always calls enforceOutputSizeCheck even when no files are present", async () => {
		const policy = makePolicy({ enforcementMode: "soft" });
		const output = { filesCreated: [], filesModified: [], logs: [] };

		await enforceSandboxPostExecution(policy, output, "session-1");

		expect(mockEnforceOutputSizeCheck).toHaveBeenCalledOnce();
	});

	it("treats undefined filesCreated/filesModified as empty arrays", async () => {
		const policy = makePolicy({ enforcementMode: "hard" });
		// TaskOutput fields are optional in practice
		const output = {
			filesCreated: undefined as unknown as string[],
			filesModified: undefined as unknown as string[],
			logs: [],
		};

		await enforceSandboxPostExecution(policy, output, "session-1");

		// allPaths will be empty — no path check expected
		expect(mockEnforcePathChecks).not.toHaveBeenCalled();
		expect(mockEnforceOutputSizeCheck).toHaveBeenCalledOnce();
	});

	it("propagates SandboxViolationError from enforcePathChecks in hard mode", async () => {
		const { SandboxViolationError } = await import("../sandbox-manager.js");
		const violation = { type: "path_traversal" as const, detail: "outside scope", timestamp: new Date().toISOString() };
		mockEnforcePathChecks.mockRejectedValueOnce(new SandboxViolationError(violation));

		const policy = makePolicy({ enforcementMode: "hard" });
		const output = { filesCreated: ["/etc/passwd"], filesModified: [], logs: [] };

		await expect(enforceSandboxPostExecution(policy, output, "session-1")).rejects.toThrow(SandboxViolationError);
	});

	it("propagates SandboxViolationError from enforceOutputSizeCheck in hard mode", async () => {
		const { SandboxViolationError } = await import("../sandbox-manager.js");
		const violation = { type: "output_overflow" as const, detail: "too large", timestamp: new Date().toISOString() };
		mockEnforceOutputSizeCheck.mockRejectedValueOnce(new SandboxViolationError(violation));

		const policy = makePolicy({ enforcementMode: "hard", maxOutputSizeBytes: 10 });
		const output = { filesCreated: [], filesModified: [], logs: ["a".repeat(100)] };

		await expect(enforceSandboxPostExecution(policy, output, "session-1")).rejects.toThrow(SandboxViolationError);
	});

	it("passes sessionId through to enforcePathChecks and enforceOutputSizeCheck", async () => {
		const policy = makePolicy({ enforcementMode: "soft" });
		const output = { filesCreated: ["/repo/file.ts"], filesModified: [], logs: [] };

		await enforceSandboxPostExecution(policy, output, "my-session-id");

		expect(mockEnforcePathChecks).toHaveBeenCalledWith(policy, expect.any(Array), "my-session-id");
		expect(mockEnforceOutputSizeCheck).toHaveBeenCalledWith(policy, expect.any(Number), "my-session-id");
	});
});

// ---------------------------------------------------------------------------
// closeSandboxExecution
// ---------------------------------------------------------------------------

describe("closeSandboxExecution", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEndSandboxSession.mockResolvedValue(undefined);
	});

	it("calls endSandboxSession when sandboxSessionId is present", async () => {
		const context: Pick<SandboxExecutionContext, "sandboxSessionId" | "isolatedWorkspace"> = {
			sandboxSessionId: "session-abc",
			isolatedWorkspace: undefined,
		};

		closeSandboxExecution(context);

		// endSandboxSession is called in a fire-and-forget promise; wait for microtasks
		await Promise.resolve();
		expect(mockEndSandboxSession).toHaveBeenCalledWith("session-abc");
	});

	it("does NOT call endSandboxSession when sandboxSessionId is undefined", async () => {
		const context: Pick<SandboxExecutionContext, "sandboxSessionId" | "isolatedWorkspace"> = {
			sandboxSessionId: undefined,
			isolatedWorkspace: undefined,
		};

		closeSandboxExecution(context);
		await Promise.resolve();

		expect(mockEndSandboxSession).not.toHaveBeenCalled();
	});

	it("calls workspace.cleanup() when isolatedWorkspace.isolated is true", async () => {
		const workspace = makeWorkspace({ isolated: true });
		const context: Pick<SandboxExecutionContext, "sandboxSessionId" | "isolatedWorkspace"> = {
			sandboxSessionId: undefined,
			isolatedWorkspace: workspace,
		};

		closeSandboxExecution(context);
		await Promise.resolve();

		expect(workspace.cleanup).toHaveBeenCalledOnce();
	});

	it("does NOT call workspace.cleanup() when isolatedWorkspace.isolated is false", async () => {
		const workspace = makeWorkspace({ isolated: false });
		const context: Pick<SandboxExecutionContext, "sandboxSessionId" | "isolatedWorkspace"> = {
			sandboxSessionId: undefined,
			isolatedWorkspace: workspace,
		};

		closeSandboxExecution(context);
		await Promise.resolve();

		expect(workspace.cleanup).not.toHaveBeenCalled();
	});

	it("does NOT call workspace.cleanup() when isolatedWorkspace is undefined", async () => {
		const context: Pick<SandboxExecutionContext, "sandboxSessionId" | "isolatedWorkspace"> = {
			sandboxSessionId: undefined,
			isolatedWorkspace: undefined,
		};

		// Should not throw
		expect(() => closeSandboxExecution(context)).not.toThrow();
	});

	it("calls both endSandboxSession and workspace.cleanup() when both are present", async () => {
		const workspace = makeWorkspace({ isolated: true });
		const context: Pick<SandboxExecutionContext, "sandboxSessionId" | "isolatedWorkspace"> = {
			sandboxSessionId: "session-xyz",
			isolatedWorkspace: workspace,
		};

		closeSandboxExecution(context);
		await Promise.resolve();

		expect(mockEndSandboxSession).toHaveBeenCalledWith("session-xyz");
		expect(workspace.cleanup).toHaveBeenCalledOnce();
	});

	it("does not throw when endSandboxSession rejects (fire-and-forget)", async () => {
		mockEndSandboxSession.mockRejectedValue(new Error("DB down"));
		const context: Pick<SandboxExecutionContext, "sandboxSessionId" | "isolatedWorkspace"> = {
			sandboxSessionId: "session-err",
			isolatedWorkspace: undefined,
		};

		// Must not throw synchronously or cause unhandled rejection to surface
		expect(() => closeSandboxExecution(context)).not.toThrow();
		// Allow the rejected promise to settle without crashing the test
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

	it("does not throw when workspace.cleanup() rejects (fire-and-forget)", async () => {
		const workspace = makeWorkspace({ isolated: true });
		(workspace.cleanup as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("FS error"));

		const context: Pick<SandboxExecutionContext, "sandboxSessionId" | "isolatedWorkspace"> = {
			sandboxSessionId: undefined,
			isolatedWorkspace: workspace,
		};

		expect(() => closeSandboxExecution(context)).not.toThrow();
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
});
