import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type EnforcementMode,
	type SandboxPolicy,
	SandboxViolationError,
	checkOutputSize,
	checkPathAllowed,
	checkToolAllowed,
	enforceOutputSizeCheck,
	enforcePathChecks,
	enforceToolCheck,
} from "../sandbox-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePolicy(overrides: Partial<SandboxPolicy> = {}): SandboxPolicy {
	return {
		id: "test-policy",
		projectId: "proj-1",
		isolationLevel: "workspace",
		allowedTools: [],
		deniedTools: ["rm_rf", "format_disk", "sudo"],
		filesystemScope: ["/tmp/repo"],
		networkPolicy: "project_only",
		maxExecutionTimeMs: 300_000,
		maxOutputSizeBytes: 10_485_760,
		elevatedCapabilities: [],
		enforcementMode: "hard",
		...overrides,
	};
}

// Mock DB calls used by enforce* helpers
vi.mock("../db.js", () => ({
	query: vi.fn().mockResolvedValue([]),
	queryOne: vi.fn().mockResolvedValue(null),
	execute: vi.fn().mockResolvedValue(undefined),
	getProjectSetting: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Pure check functions (unchanged — confirm they still work)
// ---------------------------------------------------------------------------

describe("checkToolAllowed", () => {
	it("allows tools not in denied list", () => {
		const policy = makePolicy();
		expect(checkToolAllowed(policy, "read").allowed).toBe(true);
		expect(checkToolAllowed(policy, "write").allowed).toBe(true);
	});

	it("blocks denied tools", () => {
		const policy = makePolicy();
		expect(checkToolAllowed(policy, "rm_rf").allowed).toBe(false);
		expect(checkToolAllowed(policy, "sudo").allowed).toBe(false);
	});

	it("blocks tools not in allowedTools when allowedTools is non-empty", () => {
		const policy = makePolicy({ allowedTools: ["read", "write"] });
		expect(checkToolAllowed(policy, "read").allowed).toBe(true);
		expect(checkToolAllowed(policy, "shell_exec").allowed).toBe(false);
	});
});

describe("checkPathAllowed", () => {
	it("allows paths within filesystem scope", () => {
		const policy = makePolicy({ filesystemScope: ["/tmp/repo"] });
		expect(checkPathAllowed(policy, "/tmp/repo/src/index.ts").allowed).toBe(true);
	});

	it("blocks paths outside filesystem scope", () => {
		const policy = makePolicy({ filesystemScope: ["/tmp/repo"] });
		expect(checkPathAllowed(policy, "/etc/passwd").allowed).toBe(false);
		expect(checkPathAllowed(policy, "/home/user/.ssh/id_rsa").allowed).toBe(false);
	});

	it("allows any path when filesystemScope is empty", () => {
		const policy = makePolicy({ filesystemScope: [] });
		expect(checkPathAllowed(policy, "/anywhere/file.ts").allowed).toBe(true);
	});
});

describe("checkOutputSize", () => {
	it("allows output within limit", () => {
		const policy = makePolicy({ maxOutputSizeBytes: 10_485_760 });
		expect(checkOutputSize(policy, 1024).allowed).toBe(true);
	});

	it("blocks output exceeding limit", () => {
		const policy = makePolicy({ maxOutputSizeBytes: 10_485_760 });
		expect(checkOutputSize(policy, 20_000_000).allowed).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Enforcement helpers — mode-based behavior
// ---------------------------------------------------------------------------

describe("enforceToolCheck", () => {
	it("throws SandboxViolationError in hard mode for denied tool", async () => {
		const policy = makePolicy({ enforcementMode: "hard" });
		await expect(enforceToolCheck(policy, "rm_rf")).rejects.toThrow(SandboxViolationError);
		await expect(enforceToolCheck(policy, "rm_rf")).rejects.toThrow("tool_denied");
	});

	it("does NOT throw in soft mode for denied tool", async () => {
		const policy = makePolicy({ enforcementMode: "soft" });
		await expect(enforceToolCheck(policy, "rm_rf")).resolves.toBeUndefined();
	});

	it("skips all checks in off mode", async () => {
		const policy = makePolicy({ enforcementMode: "off" });
		await expect(enforceToolCheck(policy, "rm_rf")).resolves.toBeUndefined();
	});

	it("does NOT throw for allowed tool in hard mode", async () => {
		const policy = makePolicy({ enforcementMode: "hard" });
		await expect(enforceToolCheck(policy, "read")).resolves.toBeUndefined();
	});
});

describe("enforcePathChecks", () => {
	it("throws SandboxViolationError in hard mode for path outside scope", async () => {
		const policy = makePolicy({ enforcementMode: "hard", filesystemScope: ["/tmp/repo"] });
		await expect(enforcePathChecks(policy, ["/etc/passwd"])).rejects.toThrow(SandboxViolationError);
	});

	it("returns violations in soft mode without throwing", async () => {
		const policy = makePolicy({ enforcementMode: "soft", filesystemScope: ["/tmp/repo"] });
		const violations = await enforcePathChecks(policy, ["/etc/passwd", "/tmp/repo/ok.ts"]);
		expect(violations).toHaveLength(1);
		expect(violations[0].type).toBe("path_traversal");
	});

	it("returns empty array for valid paths in hard mode", async () => {
		const policy = makePolicy({ enforcementMode: "hard", filesystemScope: ["/tmp/repo"] });
		const violations = await enforcePathChecks(policy, ["/tmp/repo/src/main.ts"]);
		expect(violations).toHaveLength(0);
	});

	it("returns empty array in off mode even for bad paths", async () => {
		const policy = makePolicy({ enforcementMode: "off", filesystemScope: ["/tmp/repo"] });
		const violations = await enforcePathChecks(policy, ["/etc/passwd"]);
		expect(violations).toHaveLength(0);
	});
});

describe("enforceOutputSizeCheck", () => {
	it("throws SandboxViolationError in hard mode for oversized output", async () => {
		const policy = makePolicy({ enforcementMode: "hard", maxOutputSizeBytes: 1000 });
		await expect(enforceOutputSizeCheck(policy, 5000)).rejects.toThrow(SandboxViolationError);
	});

	it("does NOT throw in soft mode for oversized output", async () => {
		const policy = makePolicy({ enforcementMode: "soft", maxOutputSizeBytes: 1000 });
		await expect(enforceOutputSizeCheck(policy, 5000)).resolves.toBeUndefined();
	});

	it("does NOT throw for valid size in hard mode", async () => {
		const policy = makePolicy({ enforcementMode: "hard", maxOutputSizeBytes: 10_000 });
		await expect(enforceOutputSizeCheck(policy, 1000)).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// SandboxViolationError structure
// ---------------------------------------------------------------------------

describe("SandboxViolationError", () => {
	it("carries violation details", () => {
		const violation = { type: "tool_denied" as const, detail: "rm_rf blocked", timestamp: new Date().toISOString() };
		const err = new SandboxViolationError(violation);
		expect(err.name).toBe("SandboxViolationError");
		expect(err.violation).toEqual(violation);
		expect(err.message).toContain("tool_denied");
		expect(err.message).toContain("rm_rf blocked");
	});
});

// ---------------------------------------------------------------------------
// Enforcement mode combinations matrix
// ---------------------------------------------------------------------------

describe("enforcement mode matrix", () => {
	const modes: EnforcementMode[] = ["hard", "soft", "off"];

	for (const mode of modes) {
		it(`${mode} mode — allowed tool passes`, async () => {
			const policy = makePolicy({ enforcementMode: mode });
			await expect(enforceToolCheck(policy, "read")).resolves.toBeUndefined();
		});
	}

	it("hard mode blocked tool throws with correct violation type", async () => {
		const policy = makePolicy({ enforcementMode: "hard" });
		try {
			await enforceToolCheck(policy, "sudo");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(SandboxViolationError);
			expect((err as SandboxViolationError).violation.type).toBe("tool_denied");
		}
	});

	it("hard mode blocked path throws with correct violation type", async () => {
		const policy = makePolicy({ enforcementMode: "hard", filesystemScope: ["/safe"] });
		try {
			await enforcePathChecks(policy, ["/unsafe/secret.key"]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(SandboxViolationError);
			expect((err as SandboxViolationError).violation.type).toBe("path_traversal");
		}
	});

	it("hard mode oversized output throws with correct violation type", async () => {
		const policy = makePolicy({ enforcementMode: "hard", maxOutputSizeBytes: 100 });
		try {
			await enforceOutputSizeCheck(policy, 500);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(SandboxViolationError);
			expect((err as SandboxViolationError).violation.type).toBe("output_overflow");
		}
	});
});
