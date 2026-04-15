import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../types.js";

vi.mock("../db.js", () => ({
	getProjectSettingsMap: vi.fn(),
}));

vi.mock("../event-bus.js", () => ({
	eventBus: { emit: vi.fn() },
}));

import { getProjectSettingsMap } from "../db.js";
import { eventBus } from "../event-bus.js";
import { evaluatePolicies, getPolicies } from "../policy-engine.js";

const mockSettings = vi.mocked(getProjectSettingsMap);
const mockEmit = vi.mocked(eventBus.emit);

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "t-1",
		phaseId: "ph-1",
		title: "Build auth",
		description: "implement auth",
		assignedAgent: "backend-dev",
		complexity: "S",
		dependsOn: [],
		status: "queued",
		revisionCount: 0,
		retryCount: 0,
		createdAt: new Date().toISOString(),
		...overrides,
	} as Task;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("getPolicies", () => {
	it("returns 3 built-in rules when no custom rules defined", async () => {
		mockSettings.mockResolvedValue({});
		const policies = await getPolicies("p-1");
		expect(policies).toHaveLength(3);
		expect(policies.map((p) => p.id)).toEqual([
			"max_cost_per_task",
			"require_approval_for_large",
			"multi_reviewer",
		]);
	});

	it("merges custom rules from project_settings on top of built-ins", async () => {
		mockSettings.mockResolvedValue({
			policy: {
				rules: JSON.stringify({
					rules: [
						{ id: "c-1", projectId: "p-1", name: "No main branch", condition: "branch == main", action: "block", enabled: true },
					],
				}),
			},
		});
		const policies = await getPolicies("p-1");
		expect(policies).toHaveLength(4);
		expect(policies[3].id).toBe("c-1");
	});

	it("supports legacy array-shape custom rules", async () => {
		mockSettings.mockResolvedValue({
			policy: {
				rules: JSON.stringify([
					{ id: "c-1", projectId: "p-1", name: "x", condition: "complexity == XL", action: "block", enabled: true },
				]),
			},
		});
		const policies = await getPolicies("p-1");
		expect(policies).toHaveLength(4);
	});

	it("ignores malformed JSON gracefully", async () => {
		mockSettings.mockResolvedValue({ policy: { rules: "{not json" } });
		const policies = await getPolicies("p-1");
		expect(policies).toHaveLength(3);
	});
});

describe("evaluatePolicies — built-in rules", () => {
	it("allows small tasks with no policy config", async () => {
		mockSettings.mockResolvedValue({});
		const result = await evaluatePolicies("p-1", makeTask());
		expect(result.allowed).toBe(true);
		expect(result.violations).toEqual([]);
	});

	it("flags L complexity tasks without approval", async () => {
		mockSettings.mockResolvedValue({});
		const result = await evaluatePolicies("p-1", makeTask({ complexity: "L" }));
		expect(result.allowed).toBe(true); // require_approval is not block
		expect(result.violations.some((v) => v.includes("requires approval"))).toBe(true);
	});

	it("allows L tasks that are already approved", async () => {
		mockSettings.mockResolvedValue({});
		const result = await evaluatePolicies(
			"p-1",
			makeTask({ complexity: "L", approvalStatus: "approved" }),
		);
		expect(result.violations).toEqual([]);
	});

	it("blocks when per-task budget exceeds project max cost", async () => {
		mockSettings.mockResolvedValue({
			budget: { maxCostUsd: "10.00" },
			policy: { task_budget_usd: "50.00" },
		});
		const result = await evaluatePolicies("p-1", makeTask());
		expect(result.allowed).toBe(false);
		expect(result.violations.some((v) => v.includes("exceeds project max cost"))).toBe(true);
	});

	it("warns when task touches files matching multi-reviewer pattern", async () => {
		mockSettings.mockResolvedValue({
			policy: { multi_reviewer_pattern: "src/auth/.*" },
		});
		const task = makeTask({ targetFiles: ["src/auth/login.ts", "src/utils/str.ts"] });
		const result = await evaluatePolicies("p-1", task);
		expect(result.allowed).toBe(true); // warn, not block
		expect(result.violations.some((v) => v.includes("multiple reviewers"))).toBe(true);
	});

	it("ignores invalid regex pattern silently", async () => {
		mockSettings.mockResolvedValue({
			policy: { multi_reviewer_pattern: "[invalid regex" },
		});
		const task = makeTask({ targetFiles: ["src/auth/login.ts"] });
		const result = await evaluatePolicies("p-1", task);
		expect(result.violations).toEqual([]);
	});
});

describe("evaluatePolicies — custom rules", () => {
	it("evaluates 'complexity == XL' condition as block", async () => {
		mockSettings.mockResolvedValue({
			policy: {
				rules: JSON.stringify({
					rules: [{ id: "c-1", projectId: "p-1", name: "No XL", condition: "complexity == XL", action: "block", enabled: true }],
				}),
			},
		});
		const result = await evaluatePolicies("p-1", makeTask({ complexity: "XL", approvalStatus: "approved" }));
		expect(result.allowed).toBe(false);
		expect(result.violations.some((v) => v.includes("No XL"))).toBe(true);
	});

	it("evaluates 'title contains' condition", async () => {
		mockSettings.mockResolvedValue({
			policy: {
				rules: JSON.stringify({
					rules: [{ id: "c-1", projectId: "p-1", name: "No deploys", condition: "title contains deploy", action: "block", enabled: true }],
				}),
			},
		});
		const result = await evaluatePolicies("p-1", makeTask({ title: "Deploy to staging" }));
		expect(result.allowed).toBe(false);
	});

	it("skips disabled custom rules", async () => {
		mockSettings.mockResolvedValue({
			policy: {
				rules: JSON.stringify({
					rules: [{ id: "c-1", projectId: "p-1", name: "No XL", condition: "complexity == XL", action: "block", enabled: false }],
				}),
			},
		});
		const result = await evaluatePolicies("p-1", makeTask({ complexity: "XL", approvalStatus: "approved" }));
		expect(result.violations.some((v) => v.includes("No XL"))).toBe(false);
	});

	it("custom warn-action rule does not block", async () => {
		mockSettings.mockResolvedValue({
			policy: {
				rules: JSON.stringify({
					rules: [{ id: "c-1", projectId: "p-1", name: "Branch warn", condition: "branch == main", action: "warn", enabled: true }],
				}),
			},
		});
		const result = await evaluatePolicies("p-1", makeTask({ branch: "main" }));
		expect(result.allowed).toBe(true);
		expect(result.violations.some((v) => v.includes("Branch warn"))).toBe(true);
	});
});

describe("evaluatePolicies — events", () => {
	it("emits policy:violation event when violations are found", async () => {
		mockSettings.mockResolvedValue({});
		await evaluatePolicies("p-1", makeTask({ complexity: "L" }));
		expect(mockEmit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "policy:violation",
				projectId: "p-1",
				taskId: "t-1",
				payload: expect.objectContaining({ blocked: false }),
			}),
		);
	});

	it("does not emit event when no violations", async () => {
		mockSettings.mockResolvedValue({});
		await evaluatePolicies("p-1", makeTask());
		expect(mockEmit).not.toHaveBeenCalled();
	});
});
