import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../types.js";

vi.mock("../db.js", () => ({
	getProjectSettings: vi.fn(),
}));

import { getProjectSettings } from "../db.js";
import { getDefaultRoutingConfig, resolveModel } from "../model-router.js";

const mockSettings = vi.mocked(getProjectSettings);

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "t-1",
		phaseId: "p-1",
		title: "Some task",
		description: "",
		assignedAgent: "backend",
		status: "queued",
		complexity: "M",
		dependsOn: [],
		branch: "feat/x",
		retryCount: 0,
		revisionCount: 0,
		requiresApproval: false,
		...overrides,
	} as Task;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockSettings.mockResolvedValue([]);
});

describe("getDefaultRoutingConfig", () => {
	it("returns S/M/L/XL mapping with Anthropic models", () => {
		const cfg = getDefaultRoutingConfig();
		expect(cfg.S).toContain("haiku");
		expect(cfg.M).toContain("sonnet");
		expect(cfg.L).toContain("sonnet");
		expect(cfg.XL).toContain("opus");
	});
});

describe("resolveModel", () => {
	it("maps S complexity to haiku tier", async () => {
		const r = await resolveModel(makeTask({ complexity: "S" }), { projectId: "p-1" });
		expect(r.model).toContain("haiku");
		expect(r.provider).toBe("anthropic");
	});

	it("maps M complexity to sonnet", async () => {
		const r = await resolveModel(makeTask({ complexity: "M" }), { projectId: "p-1" });
		expect(r.model).toContain("sonnet");
	});

	it("maps XL complexity to opus", async () => {
		const r = await resolveModel(makeTask({ complexity: "XL" }), { projectId: "p-1" });
		expect(r.model).toContain("opus");
	});

	it("bumps tier once on prior failure (S → M = sonnet)", async () => {
		const r = await resolveModel(makeTask({ complexity: "S" }), {
			projectId: "p-1",
			priorFailures: 1,
		});
		expect(r.model).toContain("sonnet");
	});

	it("bumps tier on repeated review rejections (> 1)", async () => {
		const r = await resolveModel(makeTask({ complexity: "M" }), {
			projectId: "p-1",
			reviewRejections: 2,
		});
		expect(r.model).toContain("sonnet"); // L is still sonnet in default config
	});

	it("escalates to at least L when risk is high", async () => {
		const r = await resolveModel(makeTask({ complexity: "S" }), {
			projectId: "p-1",
			riskLevel: "high",
		});
		// L → sonnet in default config
		expect(r.model).toContain("sonnet");
	});

	it("escalates to at least L when risk is critical", async () => {
		const r = await resolveModel(makeTask({ complexity: "S" }), {
			projectId: "p-1",
			riskLevel: "critical",
		});
		expect(r.model).toContain("sonnet");
	});

	it("does not downgrade when task already above L", async () => {
		const r = await resolveModel(makeTask({ complexity: "XL" }), {
			projectId: "p-1",
			riskLevel: "high",
		});
		expect(r.model).toContain("opus");
	});

	it("respects project-level routing overrides", async () => {
		mockSettings.mockResolvedValue([
			{ category: "model_routing", key: "M", value: "custom-model-m" } as any,
		]);

		const r = await resolveModel(makeTask({ complexity: "M" }), { projectId: "p-1" });
		expect(r.model).toBe("custom-model-m");
	});

	it("falls back to M for unknown complexity", async () => {
		const r = await resolveModel(makeTask({ complexity: "???" as any }), { projectId: "p-1" });
		expect(r.model).toContain("sonnet");
	});

	it("returns effort matching the tier", async () => {
		const small = await resolveModel(makeTask({ complexity: "S" }), { projectId: "p-1" });
		const large = await resolveModel(makeTask({ complexity: "XL" }), { projectId: "p-1" });
		expect(small.effort).toBeDefined();
		expect(large.effort).toBeDefined();
		// XL should have non-low effort
		expect(large.effort).not.toBe(small.effort);
	});
});
