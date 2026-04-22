import { describe, expect, it } from "vitest";
import type { CLIExecutionResult } from "../cli-runtime.js";
import type { ProjectCostSummary, TokenUsage } from "../types.js";

describe("Token Analytics (Faz 3.1)", () => {
	it("CLIExecutionResult should include cache token fields", () => {
		const result: CLIExecutionResult = {
			text: "",
			filesCreated: [],
			filesModified: [],
			logs: [],
			inputTokens: 100,
			outputTokens: 50,
			cacheCreationTokens: 20,
			cacheReadTokens: 30,
			totalCostUsd: 0.01,
			durationMs: 1000,
			model: "claude-sonnet-4-6",
		};
		expect(result.cacheCreationTokens).toBe(20);
		expect(result.cacheReadTokens).toBe(30);
	});

	it("TokenUsage should include cache token fields", () => {
		const usage: TokenUsage = {
			id: "test",
			projectId: "p1",
			taskId: "t1",
			agentId: "a1",
			model: "claude-sonnet-4-6",
			provider: "anthropic",
			inputTokens: 100,
			outputTokens: 50,
			totalTokens: 150,
			costUsd: 0.01,
			cacheCreationTokens: 10,
			cacheReadTokens: 40,
			createdAt: new Date().toISOString(),
		};
		expect(usage.cacheCreationTokens).toBe(10);
		expect(usage.cacheReadTokens).toBe(40);
	});

	it("ProjectCostSummary should include cache totals", () => {
		const summary: ProjectCostSummary = {
			totalCostUsd: 1.5,
			totalInputTokens: 10000,
			totalOutputTokens: 5000,
			totalTokens: 15000,
			taskCount: 5,
			totalCacheCreationTokens: 2000,
			totalCacheReadTokens: 3000,
		};
		expect(summary.totalCacheCreationTokens).toBe(2000);
		expect(summary.totalCacheReadTokens).toBe(3000);
	});

	it("cache hit ratio calculation", () => {
		const ratio = 3000 / 10000;
		expect(ratio).toBeCloseTo(0.3, 2);
	});

	it("cache savings estimate is positive", () => {
		const savings = 5000 * 0.000003 * 0.9;
		expect(savings).toBeGreaterThan(0);
		expect(savings).toBeCloseTo(0.0135, 4);
	});
});
