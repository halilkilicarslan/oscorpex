// ---------------------------------------------------------------------------
// P2-2: Execution Gates — Behavior-based unit tests (DB-independent)
// Tests: verification pass, dependency failure, files_exist failure,
//        output_non_empty failure, lenient vs strict mode, session recording.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

// All vi.mock() calls must be at the top level BEFORE dynamic imports.

vi.mock("../output-verifier.js", () => ({
	resolveStrictness: vi.fn(async () => "strict"),
	verifyTaskOutput: vi.fn(async () => ({
		allPassed: true,
		results: [],
	})),
}));

vi.mock("../dependency-verifier.js", () => ({
	verifyDeclaredDependencies: vi.fn(() => ({
		passed: true,
		missingDependencies: [],
		checkedFiles: [],
	})),
}));

vi.mock("../event-bus.js", () => ({
	eventBus: { emit: vi.fn(), emitTransient: vi.fn() },
}));

vi.mock("../agent-runtime/index.js", () => ({
	recordStep: vi.fn(async () => {}),
}));

vi.mock("../goal-engine.js", () => ({
	evaluateGoal: vi.fn(async () => {}),
	getGoalForTask: vi.fn(async () => null),
	resolveGoalEnforcement: vi.fn(async () => "warn"),
	shouldEnforceGoalFailure: vi.fn(() => false),
	validateCriteriaFromOutput: vi.fn(async () => []),
	validateCriteriaWithLLM: vi.fn(async () => []),
}));

vi.mock("../test-gate.js", () => ({
	runTestGate: vi.fn(async () => ({
		passed: true,
		summary: "all tests pass",
		testsTotal: 0,
		testsPassed: 0,
		testsFailed: 0,
		policy: "optional",
	})),
}));

vi.mock("../logger.js", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

// Dynamic imports AFTER mocks.
const { runVerificationGate } = await import("../execution-gates.js");
const { verifyDeclaredDependencies } = await import("../dependency-verifier.js");
const { resolveStrictness, verifyTaskOutput } = await import("../output-verifier.js");
const { eventBus } = await import("../event-bus.js");
const { recordStep } = await import("../agent-runtime/index.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides?: Partial<{ id: string; title: string }>): any {
	return {
		id: overrides?.id ?? "task-1",
		title: overrides?.title ?? "Build feature",
		description: "Task description",
		status: "in_progress",
	};
}

function makeOutput(): any {
	return {
		files: ["src/feature.ts"],
		summary: "Feature implemented",
		dependencies: [],
	};
}

function makeVerificationResults(overrides: { type: string; passed: boolean; details?: any[] }[]) {
	return overrides.map((r) => ({
		type: r.type,
		passed: r.passed,
		details: r.details ?? [{ file: `${r.type}-check.ts` }],
	}));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P2-2: Execution Gates — runVerificationGate()", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Reset defaults
		vi.mocked(verifyDeclaredDependencies).mockReturnValue({
			passed: true,
			missingDependencies: [],
			checkedFiles: [],
		});
		vi.mocked(resolveStrictness).mockResolvedValue("strict" as any);
		vi.mocked(verifyTaskOutput).mockResolvedValue({
			allPassed: true,
			results: [],
		} as any);
	});

	// -------------------------------------------------------------------------
	// 1. All checks pass → { passed: true }
	// -------------------------------------------------------------------------
	it("returns { passed: true } when dependency check and output verification both pass", async () => {
		const result = await runVerificationGate("proj-1", makeTask(), "/repo", makeOutput(), "agent-1");

		expect(result).toEqual({ passed: true });
		expect(verifyDeclaredDependencies).toHaveBeenCalledOnce();
		expect(verifyTaskOutput).toHaveBeenCalledOnce();
	});

	it("records a session step with 'passed' summary when all checks pass and sessionId provided", async () => {
		await runVerificationGate("proj-1", makeTask(), "/repo", makeOutput(), "agent-1", "session-abc");

		expect(recordStep).toHaveBeenCalledWith(
			"session-abc",
			expect.objectContaining({ summary: "Verification: passed" }),
		);
	});

	// -------------------------------------------------------------------------
	// 2. Dependency check failure → always blocks
	// -------------------------------------------------------------------------
	it("returns { passed: false } when dependency check fails", async () => {
		vi.mocked(verifyDeclaredDependencies).mockReturnValue({
			passed: false,
			missingDependencies: ["lodash", "express"],
			checkedFiles: ["package.json"],
		});

		const result = await runVerificationGate("proj-2", makeTask(), "/repo", makeOutput(), "agent-1");

		expect(result.passed).toBe(false);
		expect(result.failedChecks).toMatch(/dependency_declared/);
		expect(result.failedChecks).toMatch(/lodash/);
		// Should not reach verifyTaskOutput when dependency check fails
		expect(verifyTaskOutput).not.toHaveBeenCalled();
	});

	it("emits a transient event when dependency check fails", async () => {
		vi.mocked(verifyDeclaredDependencies).mockReturnValue({
			passed: false,
			missingDependencies: ["axios"],
			checkedFiles: [],
		});

		await runVerificationGate("proj-2", makeTask(), "/repo", makeOutput(), "agent-1");

		expect(eventBus.emitTransient).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: "proj-2", type: "agent:output" }),
		);
	});

	// -------------------------------------------------------------------------
	// 3. files_exist failure → blocks in strict mode
	// -------------------------------------------------------------------------
	it("returns { passed: false } when files_exist check fails in strict mode", async () => {
		vi.mocked(verifyTaskOutput).mockResolvedValue({
			allPassed: false,
			results: makeVerificationResults([{ type: "files_exist", passed: false }]),
		} as any);
		vi.mocked(resolveStrictness).mockResolvedValue("strict" as any);

		const result = await runVerificationGate("proj-3", makeTask(), "/repo", makeOutput(), "agent-1");

		expect(result.passed).toBe(false);
		expect(result.failedChecks).toMatch(/files_exist/);
	});

	// -------------------------------------------------------------------------
	// 4. files_exist failure → also blocks in lenient mode (P0-11 fix)
	// -------------------------------------------------------------------------
	it("returns { passed: false } when files_exist check fails even in lenient mode (P0-11)", async () => {
		vi.mocked(verifyTaskOutput).mockResolvedValue({
			allPassed: false,
			results: makeVerificationResults([{ type: "files_exist", passed: false }]),
		} as any);
		vi.mocked(resolveStrictness).mockResolvedValue("lenient" as any);

		const result = await runVerificationGate("proj-4", makeTask(), "/repo", makeOutput(), "agent-1");

		expect(result.passed).toBe(false);
		expect(result.failedChecks).toMatch(/files_exist/);
	});

	// -------------------------------------------------------------------------
	// 5. output_non_empty failure → always blocks regardless of strictness
	// -------------------------------------------------------------------------
	it("returns { passed: false } when output_non_empty fails in strict mode", async () => {
		vi.mocked(verifyTaskOutput).mockResolvedValue({
			allPassed: false,
			results: makeVerificationResults([{ type: "output_non_empty", passed: false }]),
		} as any);
		vi.mocked(resolveStrictness).mockResolvedValue("strict" as any);

		const result = await runVerificationGate("proj-5", makeTask(), "/repo", makeOutput(), "agent-1");

		expect(result.passed).toBe(false);
		expect(result.failedChecks).toMatch(/output_non_empty/);
	});

	it("returns { passed: false } when output_non_empty fails in lenient mode (mandatory)", async () => {
		vi.mocked(verifyTaskOutput).mockResolvedValue({
			allPassed: false,
			results: makeVerificationResults([{ type: "output_non_empty", passed: false }]),
		} as any);
		vi.mocked(resolveStrictness).mockResolvedValue("lenient" as any);

		const result = await runVerificationGate("proj-5b", makeTask(), "/repo", makeOutput(), "agent-1");

		expect(result.passed).toBe(false);
	});

	// -------------------------------------------------------------------------
	// 6. files_modified failure in lenient mode → NOT blocking (only strict blocks)
	// -------------------------------------------------------------------------
	it("returns { passed: true } when only files_modified fails in lenient mode", async () => {
		vi.mocked(verifyTaskOutput).mockResolvedValue({
			allPassed: false,
			results: makeVerificationResults([{ type: "files_modified", passed: false }]),
		} as any);
		vi.mocked(resolveStrictness).mockResolvedValue("lenient" as any);

		const result = await runVerificationGate("proj-6", makeTask(), "/repo", makeOutput(), "agent-1");

		// lenient mode: only files_modified failed → should NOT block
		expect(result.passed).toBe(true);
	});

	it("returns { passed: false } when files_modified fails in strict mode", async () => {
		vi.mocked(verifyTaskOutput).mockResolvedValue({
			allPassed: false,
			results: makeVerificationResults([{ type: "files_modified", passed: false }]),
		} as any);
		vi.mocked(resolveStrictness).mockResolvedValue("strict" as any);

		const result = await runVerificationGate("proj-7", makeTask(), "/repo", makeOutput(), "agent-1");

		expect(result.passed).toBe(false);
	});

	// -------------------------------------------------------------------------
	// 7. Session recording on failure
	// -------------------------------------------------------------------------
	it("records a session step with 'failed' summary when verification fails and sessionId provided", async () => {
		vi.mocked(verifyTaskOutput).mockResolvedValue({
			allPassed: false,
			results: makeVerificationResults([{ type: "files_exist", passed: false }]),
		} as any);

		await runVerificationGate("proj-8", makeTask(), "/repo", makeOutput(), "agent-1", "session-xyz");

		expect(recordStep).toHaveBeenCalledWith(
			"session-xyz",
			expect.objectContaining({ summary: "Verification: failed" }),
		);
	});

	it("does not call recordStep when no sessionId is provided", async () => {
		await runVerificationGate("proj-9", makeTask(), "/repo", makeOutput(), "agent-1");
		// sessionId omitted → no recordStep calls
		expect(recordStep).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// 8. emitTransient called on output verification failure
	// -------------------------------------------------------------------------
	it("emits a transient agent:output event when output verification fails", async () => {
		vi.mocked(verifyTaskOutput).mockResolvedValue({
			allPassed: false,
			results: makeVerificationResults([{ type: "output_non_empty", passed: false }]),
		} as any);

		await runVerificationGate("proj-10", makeTask(), "/repo", makeOutput(), "agent-1");

		expect(eventBus.emitTransient).toHaveBeenCalledWith(
			expect.objectContaining({ type: "agent:output", projectId: "proj-10" }),
		);
	});
});
