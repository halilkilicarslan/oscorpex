import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock db.js — agentic-metrics uses query/queryOne from ./db.js
vi.mock("../db.js", () => ({
	query: vi.fn().mockResolvedValue([]),
	queryOne: vi.fn().mockResolvedValue(null),
}));

import { getAgenticMetrics } from "../agentic-metrics.js";
import { query, queryOne } from "../db.js";

const mockQueryOne = queryOne as ReturnType<typeof vi.fn>;
const mockQuery = query as ReturnType<typeof vi.fn>;

describe("Agentic Metrics", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should return default/zero metrics when no data exists", async () => {
		// All queryOne return null, all query return []
		mockQueryOne.mockResolvedValue(null);
		mockQuery.mockResolvedValue([]);

		const metrics = await getAgenticMetrics("project-1");

		expect(metrics.taskClaimLatency).toEqual({ avgMs: 0, p95Ms: 0, samples: 0 });
		expect(metrics.duplicateDispatchPrevented).toBe(0);
		expect(metrics.verificationFailureRate).toBe(0);
		expect(metrics.strategySuccessRates).toEqual([]);
		expect(metrics.avgRetriesBeforeCompletion).toBe(0);
		expect(metrics.reviewRejectionByRole).toEqual([]);
		expect(metrics.injectedTaskVolume).toEqual({
			total: 0,
			humanApproved: 0,
			autoApproved: 0,
			pending: 0,
			rejected: 0,
		});
		expect(metrics.graphMutationStats).toEqual({ total: 0, byType: {} });
		expect(metrics.replanTriggerFrequency).toEqual({ total: 0, byTrigger: {}, byStatus: {} });
		expect(metrics.degradedProviderDuration).toEqual([]);
		expect(metrics.failureClassification).toEqual({ transientFailures: 0, terminalFailures: 0, retryExhausted: 0 });
	});

	it("should parse task claim latency from DB row", async () => {
		// queryOne call order: claimLatency, duplicates, verificationRate, avgRetries, proposalStats, failureClass, failureClassExhausted
		mockQueryOne
			.mockResolvedValueOnce({ avg_ms: "150.5", p95_ms: "320.7", samples: "25" })
			.mockResolvedValueOnce({ cnt: "3" })
			.mockResolvedValueOnce({ failed: "2", total: "10" })
			.mockResolvedValueOnce({ avg_retries: "1.45" })
			.mockResolvedValueOnce({ total: "8", approved: "3", auto_approved: "2", pending: "2", rejected: "1" })
			.mockResolvedValueOnce({ transient: "5", terminal: "2" })
			.mockResolvedValueOnce({ cnt: "1" });
		mockQuery.mockResolvedValue([]);

		const metrics = await getAgenticMetrics("project-1");

		expect(metrics.taskClaimLatency).toEqual({ avgMs: 151, p95Ms: 321, samples: 25 });
		expect(metrics.duplicateDispatchPrevented).toBe(3);
		expect(metrics.verificationFailureRate).toBe(20);
		expect(metrics.avgRetriesBeforeCompletion).toBe(1.45);
		expect(metrics.injectedTaskVolume).toEqual({
			total: 8,
			humanApproved: 3,
			autoApproved: 2,
			pending: 2,
			rejected: 1,
		});
		expect(metrics.failureClassification).toEqual({ transientFailures: 5, terminalFailures: 2, retryExhausted: 1 });
	});

	it("should parse strategy success rates", async () => {
		mockQueryOne.mockResolvedValue(null);
		// query calls: strategies, rejectionByRole, graphMutations, replanTriggers
		mockQuery
			.mockResolvedValueOnce([
				{ strategy: "scaffold_then_refine", task_type: "feature", samples: "10", successes: "8" },
				{ strategy: "test_first", task_type: "bugfix", samples: "5", successes: "4" },
			])
			.mockResolvedValueOnce([]) // rejectionByRole
			.mockResolvedValueOnce([]) // graphMutations
			.mockResolvedValueOnce([]); // replanTriggers

		const metrics = await getAgenticMetrics("project-1");

		expect(metrics.strategySuccessRates).toHaveLength(2);
		expect(metrics.strategySuccessRates[0]).toEqual({
			strategy: "scaffold_then_refine",
			taskType: "feature",
			successRate: 80,
			samples: 10,
		});
		expect(metrics.strategySuccessRates[1]).toEqual({
			strategy: "test_first",
			taskType: "bugfix",
			successRate: 80,
			samples: 5,
		});
	});

	it("should parse review rejection by role", async () => {
		mockQueryOne.mockResolvedValue(null);
		mockQuery
			.mockResolvedValueOnce([]) // strategies
			.mockResolvedValueOnce([
				{ agent_role: "frontend_dev", rejections: "3", total: "10" },
				{ agent_role: "backend_dev", rejections: "1", total: "15" },
			])
			.mockResolvedValueOnce([]) // graphMutations
			.mockResolvedValueOnce([]); // replanTriggers

		const metrics = await getAgenticMetrics("project-1");

		expect(metrics.reviewRejectionByRole).toHaveLength(2);
		expect(metrics.reviewRejectionByRole[0]).toEqual({
			agentRole: "frontend-dev",
			rejections: 3,
			total: 10,
			rate: 30,
		});
		expect(metrics.reviewRejectionByRole[1]).toEqual({
			agentRole: "backend-dev",
			rejections: 1,
			total: 15,
			rate: 6.67,
		});
	});

	it("should parse graph mutation stats", async () => {
		mockQueryOne.mockResolvedValue(null);
		mockQuery
			.mockResolvedValueOnce([]) // strategies
			.mockResolvedValueOnce([]) // rejectionByRole
			.mockResolvedValueOnce([
				{ mutation_type: "insert_task", cnt: "5" },
				{ mutation_type: "add_edge", cnt: "3" },
				{ mutation_type: "defer_task", cnt: "1" },
			])
			.mockResolvedValueOnce([]); // replanTriggers

		const metrics = await getAgenticMetrics("project-1");

		expect(metrics.graphMutationStats.total).toBe(9);
		expect(metrics.graphMutationStats.byType).toEqual({
			insert_task: 5,
			add_edge: 3,
			defer_task: 1,
		});
	});

	it("should parse replan trigger frequency", async () => {
		mockQueryOne.mockResolvedValue(null);
		mockQuery
			.mockResolvedValueOnce([]) // strategies
			.mockResolvedValueOnce([]) // rejectionByRole
			.mockResolvedValueOnce([]) // graphMutations
			.mockResolvedValueOnce([
				{ trigger: "phase_end", status: "applied", cnt: "3" },
				{ trigger: "phase_end", status: "pending", cnt: "1" },
				{ trigger: "repeated_review_failure", status: "applied", cnt: "2" },
			]);

		const metrics = await getAgenticMetrics("project-1");

		expect(metrics.replanTriggerFrequency.total).toBe(6);
		expect(metrics.replanTriggerFrequency.byTrigger).toEqual({
			phase_end: 4,
			repeated_review_failure: 2,
		});
		expect(metrics.replanTriggerFrequency.byStatus).toEqual({
			applied: 5,
			pending: 1,
		});
	});

	it("should handle verification rate of 0 total gracefully", async () => {
		mockQueryOne
			.mockResolvedValueOnce(null) // claim latency
			.mockResolvedValueOnce(null) // duplicate count
			.mockResolvedValueOnce({ failed: "0", total: "0" }) // verification
			.mockResolvedValueOnce(null) // avg retries
			.mockResolvedValueOnce(null); // proposals
		mockQuery.mockResolvedValue([]);

		const metrics = await getAgenticMetrics("project-1");
		expect(metrics.verificationFailureRate).toBe(0);
	});

	it("should call all 12 queries in parallel via Promise.all", async () => {
		mockQueryOne.mockResolvedValue(null);
		mockQuery.mockResolvedValue([]);

		await getAgenticMetrics("project-1");

		// 7 queryOne calls (claimLatency, duplicates, verification, avgRetries, proposals, failureClass, failureExhausted)
		// + 5 query calls (strategies, rejectionByRole, graphMutations, replanTriggers, degradedProviders)
		expect(mockQueryOne).toHaveBeenCalledTimes(7);
		expect(mockQuery).toHaveBeenCalledTimes(5);
	});
});
