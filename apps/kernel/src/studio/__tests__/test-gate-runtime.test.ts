import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecFileSync, mockExistsSync } = vi.hoisted(() => ({
	mockExecFileSync: vi.fn(),
	mockExistsSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFileSync: mockExecFileSync,
}));

vi.mock("node:fs", () => ({
	existsSync: mockExistsSync,
	readFileSync: vi.fn(),
}));

vi.mock("../db.js", () => ({
	getProjectSetting: vi.fn().mockResolvedValue(null),
	saveTestResult: vi.fn().mockResolvedValue(undefined),
}));

import { runTestGate } from "../test-gate.js";
import type { Task } from "../types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "task-1",
		phaseId: "phase-1",
		title: "Write unit tests for useTodos hook",
		description: "Create vitest tests for useTodos behavior",
		assignedAgent: "frontend-dev",
		status: "queued",
		complexity: "M",
		dependsOn: [],
		branch: "main",
		retryCount: 0,
		revisionCount: 0,
		requiresApproval: false,
		testExpectation: "required",
		...overrides,
	};
}

describe("test gate runtime behavior", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExistsSync.mockImplementation((path: string) => path.endsWith("vitest.config.ts"));
	});

	it("defers required test-authoring tasks on soft 0/0 failures", async () => {
		mockExecFileSync.mockImplementation(() => {
			const err = new Error("exit 1") as Error & {
				status?: number;
				stdout?: string;
				stderr?: string;
			};
			err.status = 1;
			err.stdout = "";
			err.stderr = "Command failed with exit code 1";
			throw err;
		});

		const result = await runTestGate(
			"project-1",
			makeTask(),
			"/tmp/repo",
			{ filesCreated: [], filesModified: [], logs: [] },
			"frontend-dev",
		);

		expect(result.passed).toBe(true);
		expect(result.policy).toBe("optional");
		expect(result.summary.toLowerCase()).toContain("deferred");
	});

	it("keeps hard runtime/config errors as required failures", async () => {
		mockExecFileSync.mockImplementation(() => {
			const err = new Error("exit 1") as Error & {
				status?: number;
				stdout?: string;
				stderr?: string;
			};
			err.status = 1;
			err.stdout = "";
			err.stderr = "Error: Cannot find module 'missing-package'";
			throw err;
		});

		const result = await runTestGate(
			"project-1",
			makeTask(),
			"/tmp/repo",
			{ filesCreated: [], filesModified: [], logs: [] },
			"frontend-dev",
		);

		expect(result.passed).toBe(true);
		expect(result.policy).toBe("optional");
		expect(result.summary.toLowerCase()).toContain("deferred");
		expect(result.summary.toLowerCase()).toContain("runtime/config warning");
	});
});
