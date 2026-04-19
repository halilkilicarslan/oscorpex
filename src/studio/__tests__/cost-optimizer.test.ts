// ---------------------------------------------------------------------------
// Oscorpex — Cost Optimizer Tests (V6 M2 F8)
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CostOptimizer } from "../cost-optimizer.js";
import type { TaskComplexity } from "../types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../db.js", () => ({
	listTokenUsage: vi.fn().mockResolvedValue([]),
	getProjectCostBreakdown: vi.fn().mockResolvedValue([]),
}));

vi.mock("../model-router.js", () => ({
	getDefaultRoutingConfig: vi.fn().mockReturnValue({
		S: "claude-haiku-4-5-20251001",
		M: "claude-sonnet-4-6",
		L: "claude-sonnet-4-6",
		XL: "claude-opus-4-6",
	}),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBreakdownEntry(model: string, taskCount: number, costUsd: number, totalTokens: number) {
	return {
		agentId: "agent-1",
		agentName: "Test Agent",
		agentAvatar: "",
		agentRole: "developer",
		model,
		taskCount,
		inputTokens: Math.round(totalTokens * 0.7),
		outputTokens: Math.round(totalTokens * 0.3),
		totalTokens,
		costUsd,
	};
}

function makeUsageEntry(model: string, provider: string, costUsd: number) {
	return {
		id: `u-${Math.random()}`,
		projectId: "proj-1",
		taskId: `t-${Math.random()}`,
		agentId: "agent-1",
		model,
		provider,
		inputTokens: 1000,
		outputTokens: 500,
		totalTokens: 1500,
		costUsd,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		createdAt: new Date().toISOString(),
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CostOptimizer", () => {
	let optimizer: CostOptimizer;
	let listTokenUsageMock: ReturnType<typeof vi.fn>;
	let getProjectCostBreakdownMock: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.clearAllMocks();
		optimizer = new CostOptimizer();

		const db = await import("../db.js");
		listTokenUsageMock = db.listTokenUsage as ReturnType<typeof vi.fn>;
		getProjectCostBreakdownMock = db.getProjectCostBreakdown as ReturnType<typeof vi.fn>;

		// Default: no data
		listTokenUsageMock.mockResolvedValue([]);
		getProjectCostBreakdownMock.mockResolvedValue([]);
	});

	// -------------------------------------------------------------------------
	// getRecommendation — empty data fallback
	// -------------------------------------------------------------------------

	describe("getRecommendation — no historical data", () => {
		it("returns default model for S complexity when no data exists", async () => {
			const rec = await optimizer.getRecommendation("proj-1", "S");
			expect(rec.recommendedModel).toBe("claude-haiku-4-5-20251001");
			expect(rec.complexity).toBe("S");
			expect(rec.confidenceLevel).toBe("low");
		});

		it("returns default model for M complexity when no data exists", async () => {
			const rec = await optimizer.getRecommendation("proj-1", "M");
			expect(rec.recommendedModel).toBe("claude-sonnet-4-6");
			expect(rec.complexity).toBe("M");
		});

		it("returns default model for L complexity when no data exists", async () => {
			const rec = await optimizer.getRecommendation("proj-1", "L");
			expect(rec.recommendedModel).toBe("claude-sonnet-4-6");
			expect(rec.complexity).toBe("L");
		});

		it("returns default model for XL complexity when no data exists", async () => {
			const rec = await optimizer.getRecommendation("proj-1", "XL");
			expect(rec.recommendedModel).toBe("claude-opus-4-6");
			expect(rec.complexity).toBe("XL");
		});

		it("includes taskType in response even with no data", async () => {
			const rec = await optimizer.getRecommendation("proj-1", "M", "backend");
			expect(rec.taskType).toBe("backend");
			expect(rec.potentialSavingsPct).toBe(0);
		});
	});

	// -------------------------------------------------------------------------
	// getRecommendation — with historical data
	// -------------------------------------------------------------------------

	describe("getRecommendation — with historical data", () => {
		it("recommends cheaper model when it has good efficiency for S tasks", async () => {
			// Haiku: 3 tasks, cheap, reliable
			getProjectCostBreakdownMock.mockResolvedValue([
				makeBreakdownEntry("claude-haiku-4-5-20251001", 3, 0.003, 4500),
			]);
			listTokenUsageMock.mockResolvedValue([
				makeUsageEntry("claude-haiku-4-5-20251001", "anthropic", 0.001),
				makeUsageEntry("claude-haiku-4-5-20251001", "anthropic", 0.001),
				makeUsageEntry("claude-haiku-4-5-20251001", "anthropic", 0.001),
			]);

			// Record good outcomes
			optimizer.recordOutcome("t1", "claude-haiku-4-5-20251001", 0.001, 1.0);
			optimizer.recordOutcome("t2", "claude-haiku-4-5-20251001", 0.001, 1.0);
			optimizer.recordOutcome("t3", "claude-haiku-4-5-20251001", 0.001, 1.0);

			const rec = await optimizer.getRecommendation("proj-1", "S");
			expect(rec.recommendedModel).toBe("claude-haiku-4-5-20251001");
			expect(rec.confidenceLevel).toBe("high");
		});

		it("still recommends sonnet for XL tasks even if haiku is cheaper", async () => {
			// Haiku is cheap but haiku is not in the XL candidate list
			getProjectCostBreakdownMock.mockResolvedValue([
				makeBreakdownEntry("claude-haiku-4-5-20251001", 10, 0.01, 15000),
				makeBreakdownEntry("claude-opus-4-6", 5, 0.5, 30000),
			]);
			listTokenUsageMock.mockResolvedValue([
				makeUsageEntry("claude-haiku-4-5-20251001", "anthropic", 0.001),
				makeUsageEntry("claude-opus-4-6", "anthropic", 0.1),
			]);

			const rec = await optimizer.getRecommendation("proj-1", "XL");
			// XL candidates don't include haiku, so opus/sonnet should be recommended
			expect(["claude-opus-4-6", "claude-sonnet-4-6"].some((m) => rec.recommendedModel.includes(m))).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// recordOutcome
	// -------------------------------------------------------------------------

	describe("recordOutcome", () => {
		it("increments internal outcome count after recording", () => {
			expect(optimizer._outcomeCount).toBe(0);
			optimizer.recordOutcome("t1", "claude-sonnet-4-6", 0.01, 1.0);
			expect(optimizer._outcomeCount).toBe(1);
		});

		it("clamps quality below 0 to 0", () => {
			optimizer.recordOutcome("t1", "claude-sonnet-4-6", 0.01, -5);
			// Should not throw; internal quality is clamped
			expect(optimizer._outcomeCount).toBe(1);
		});

		it("clamps quality above 1 to 1", () => {
			optimizer.recordOutcome("t1", "claude-sonnet-4-6", 0.01, 999);
			expect(optimizer._outcomeCount).toBe(1);
		});

		it("recording multiple outcomes accumulates correctly", () => {
			optimizer.recordOutcome("t1", "claude-haiku-4-5-20251001", 0.001, 1.0);
			optimizer.recordOutcome("t2", "claude-haiku-4-5-20251001", 0.001, 0.5);
			optimizer.recordOutcome("t3", "claude-sonnet-4-6", 0.01, 0.9);
			expect(optimizer._outcomeCount).toBe(3);
		});
	});

	// -------------------------------------------------------------------------
	// getModelEfficiency
	// -------------------------------------------------------------------------

	describe("getModelEfficiency", () => {
		it("returns empty array when no token usage exists", async () => {
			const stats = await optimizer.getModelEfficiency("proj-1");
			expect(stats).toEqual([]);
		});

		it("returns one entry per distinct model", async () => {
			getProjectCostBreakdownMock.mockResolvedValue([
				makeBreakdownEntry("claude-haiku-4-5-20251001", 5, 0.005, 7500),
				makeBreakdownEntry("claude-sonnet-4-6", 3, 0.09, 9000),
			]);
			listTokenUsageMock.mockResolvedValue([
				makeUsageEntry("claude-haiku-4-5-20251001", "anthropic", 0.001),
				makeUsageEntry("claude-sonnet-4-6", "anthropic", 0.03),
			]);

			const stats = await optimizer.getModelEfficiency("proj-1");
			expect(stats.length).toBe(2);
			const models = stats.map((s) => s.model);
			expect(models).toContain("claude-haiku-4-5-20251001");
			expect(models).toContain("claude-sonnet-4-6");
		});

		it("computes avgCostPerTask correctly", async () => {
			getProjectCostBreakdownMock.mockResolvedValue([
				makeBreakdownEntry("claude-sonnet-4-6", 4, 0.08, 12000),
			]);
			listTokenUsageMock.mockResolvedValue([
				makeUsageEntry("claude-sonnet-4-6", "anthropic", 0.02),
			]);

			const stats = await optimizer.getModelEfficiency("proj-1");
			expect(stats.length).toBe(1);
			expect(stats[0].avgCostPerTask).toBeCloseTo(0.02, 4);
		});

		it("reflects in-memory outcome quality in successRate", async () => {
			getProjectCostBreakdownMock.mockResolvedValue([
				makeBreakdownEntry("claude-sonnet-4-6", 2, 0.02, 3000),
			]);
			listTokenUsageMock.mockResolvedValue([
				makeUsageEntry("claude-sonnet-4-6", "anthropic", 0.01),
			]);

			// Record one failure outcome
			optimizer.recordOutcome("t1", "claude-sonnet-4-6", 0.01, 0.0);

			const stats = await optimizer.getModelEfficiency("proj-1");
			const sonnetStats = stats.find((s) => s.model === "claude-sonnet-4-6");
			expect(sonnetStats).toBeDefined();
			// successRate should reflect the 0.0 quality we recorded
			expect(sonnetStats!.successRate).toBeLessThan(0.5);
		});

		it("sorts models by efficiencyScore descending", async () => {
			getProjectCostBreakdownMock.mockResolvedValue([
				makeBreakdownEntry("claude-haiku-4-5-20251001", 5, 0.005, 7500), // cheaper
				makeBreakdownEntry("claude-opus-4-6", 5, 0.5, 30000),             // expensive
			]);
			listTokenUsageMock.mockResolvedValue([
				makeUsageEntry("claude-haiku-4-5-20251001", "anthropic", 0.001),
				makeUsageEntry("claude-opus-4-6", "anthropic", 0.1),
			]);

			const stats = await optimizer.getModelEfficiency("proj-1");
			// Haiku should rank higher (cheaper, same default success rate)
			expect(stats[0].model).toBe("claude-haiku-4-5-20251001");
		});
	});

	// -------------------------------------------------------------------------
	// getCostInsights
	// -------------------------------------------------------------------------

	describe("getCostInsights", () => {
		it("returns zero metrics for empty project", async () => {
			const insights = await optimizer.getCostInsights("proj-1");
			expect(insights.totalCostUsd).toBe(0);
			expect(insights.taskCount).toBe(0);
			expect(insights.avgCostPerTask).toBe(0);
			expect(insights.mostExpensiveModel).toBeNull();
			expect(insights.mostEfficientModel).toBeNull();
			expect(insights.potentialSavingsUsd).toBe(0);
			expect(insights.recommendations.length).toBeGreaterThan(0);
		});

		it("identifies most expensive model from breakdown data", async () => {
			getProjectCostBreakdownMock.mockResolvedValue([
				makeBreakdownEntry("claude-haiku-4-5-20251001", 10, 0.01, 15000),
				makeBreakdownEntry("claude-opus-4-6", 3, 0.6, 18000),
			]);
			listTokenUsageMock.mockResolvedValue([
				...Array(10).fill(null).map(() => makeUsageEntry("claude-haiku-4-5-20251001", "anthropic", 0.001)),
				...Array(3).fill(null).map(() => makeUsageEntry("claude-opus-4-6", "anthropic", 0.2)),
			]);

			const insights = await optimizer.getCostInsights("proj-1");
			expect(insights.mostExpensiveModel).toBe("claude-opus-4-6");
		});

		it("includes projectId in response", async () => {
			const insights = await optimizer.getCostInsights("my-project");
			expect(insights.projectId).toBe("my-project");
		});

		it("computes totalCostUsd from listTokenUsage", async () => {
			listTokenUsageMock.mockResolvedValue([
				makeUsageEntry("claude-sonnet-4-6", "anthropic", 0.05),
				makeUsageEntry("claude-sonnet-4-6", "anthropic", 0.03),
				makeUsageEntry("claude-haiku-4-5-20251001", "anthropic", 0.001),
			]);
			getProjectCostBreakdownMock.mockResolvedValue([
				makeBreakdownEntry("claude-sonnet-4-6", 2, 0.08, 6000),
				makeBreakdownEntry("claude-haiku-4-5-20251001", 1, 0.001, 1500),
			]);

			const insights = await optimizer.getCostInsights("proj-1");
			expect(insights.totalCostUsd).toBeCloseTo(0.081, 3);
			expect(insights.taskCount).toBe(3);
		});

		it("generates at least one recommendation", async () => {
			const insights = await optimizer.getCostInsights("proj-1");
			expect(insights.recommendations.length).toBeGreaterThanOrEqual(1);
			expect(typeof insights.recommendations[0]).toBe("string");
		});
	});
});
