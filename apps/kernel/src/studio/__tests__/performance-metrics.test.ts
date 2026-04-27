import { describe, it, expect } from "vitest";
import { ProviderTelemetryCollector } from "@oscorpex/provider-sdk";
import { buildPerformanceBaseline } from "../performance-metrics.js";

function makeRecord(partial: {
	runId: string;
	taskId: string;
	primaryProvider: string;
	finalProvider?: string;
	success: boolean;
	latencyMs: number;
	fallbackCount?: number;
	fallbackTimeline?: ReturnType<ProviderTelemetryCollector["startExecution"]>["fallbackTimeline"];
	canceled?: boolean;
	errorClassification?: string;
}): ReturnType<ProviderTelemetryCollector["startExecution"]> {
	return {
		...partial,
		startedAt: new Date().toISOString(),
		fallbackCount: partial.fallbackCount ?? 0,
		fallbackTimeline: partial.fallbackTimeline ?? [],
		canceled: partial.canceled ?? false,
		cancelReason: undefined,
		degradedMode: false,
		degradedMessage: undefined,
		errorMessage: undefined,
		retryReason: undefined,
	} as ReturnType<ProviderTelemetryCollector["startExecution"]>;
}

describe("buildPerformanceBaseline", () => {
	it("returns zeroed baseline when no records", () => {
		const collector = new ProviderTelemetryCollector();
		const baseline = buildPerformanceBaseline(collector, 3600000);

    expect(baseline.totalExecutions).toBe(0);
    expect(baseline.successRate).toBe(0);
    expect(baseline.fallbackRate).toBe(0);
    expect(baseline.providerSnapshots).toEqual([]);
    expect(baseline.topSlowestPatterns).toEqual([]);
    expect(baseline.topFallbackPatterns).toEqual([]);
    expect(baseline.queueWaitMetrics.recordedCount).toBe(0);
	});

	it("aggregates basic metrics correctly", () => {
		const collector = new ProviderTelemetryCollector();
    const r1 = collector.startExecution({ runId: "r1", taskId: "t1", provider: "claude-code", repoPath: "/tmp", prompt: "test", timeoutMs: 30000 });
    collector.finishExecution(r1, { provider: "claude-code", output: "ok", files: [], tokens: {}, metadata: { durationMs: 3000 } } as any);

    const r2 = collector.startExecution({ runId: "r2", taskId: "t2", provider: "claude-code", repoPath: "/tmp", prompt: "test", timeoutMs: 30000 });
    collector.finishExecution(r2, null, new Error("timeout"));

		const baseline = buildPerformanceBaseline(collector, 3600000);

		expect(baseline.totalExecutions).toBe(2);
		expect(baseline.successRate).toBe(0.5);
		expect(baseline.providerSnapshots).toHaveLength(1);
		expect(baseline.providerSnapshots[0].totalExecutions).toBe(2);
		expect(baseline.providerSnapshots[0].successfulExecutions).toBe(1);
		expect(baseline.providerSnapshots[0].failedExecutions).toBe(1);
	});

	it("computes fallback and cancel rates", () => {
		const collector = new ProviderTelemetryCollector();
    const r1 = collector.startExecution({ runId: "r1", taskId: "t1", provider: "claude-code", repoPath: "/tmp", prompt: "test", timeoutMs: 30000 });
    collector.recordFallback(r1, "claude-code", "codex", "timeout", "timeout" as any, 1200);
    collector.finishExecution(r1, { provider: "codex", output: "ok", files: [], tokens: {}, metadata: { durationMs: 2000 } } as any);

    const r2 = collector.startExecution({ runId: "r2", taskId: "t2", provider: "claude-code", repoPath: "/tmp", prompt: "test", timeoutMs: 30000 });
    collector.recordCancel(r2, "pipeline_pause");
    collector.finishExecution(r2, null, new Error("aborted"));

		const baseline = buildPerformanceBaseline(collector, 3600000);

		expect(baseline.fallbackRate).toBe(0.5); // 1 fallback across 2 execs
		expect(baseline.cancelRate).toBe(0.5);
		expect(baseline.providerSnapshots).toHaveLength(2); // claude-code + codex
	});

  it("identifies top slowest patterns", () => {
    const collector = new ProviderTelemetryCollector();
    for (let i = 0; i < 3; i++) {
      const r = collector.startExecution({ runId: `r${i}`, taskId: `t${i}`, provider: "claude-code", repoPath: "/tmp", prompt: "test", timeoutMs: 30000 });
      // Simulate slow failure with explicit latency via a fake result with error
      collector.finishExecution(r, { provider: "claude-code", output: "", files: [], tokens: {}, metadata: { durationMs: 8000 } } as any, new Error("slow"));
    }
    for (let i = 0; i < 3; i++) {
      const r = collector.startExecution({ runId: `rx${i}`, taskId: `tx${i}`, provider: "codex", repoPath: "/tmp", prompt: "test", timeoutMs: 30000 });
      collector.finishExecution(r, { provider: "codex", output: "ok", files: [], tokens: {}, metadata: { durationMs: 500 } } as any);
    }

    const baseline = buildPerformanceBaseline(collector, 3600000);
    expect(baseline.topSlowestPatterns.length).toBeGreaterThan(0);
    expect(baseline.topSlowestPatterns[0].provider).toBe("claude-code");
  });

	it("identifies top fallback patterns", () => {
		const collector = new ProviderTelemetryCollector();
		const r1 = collector.startExecution({ runId: "r1", taskId: "t1", provider: "claude-code", repoPath: "/tmp", prompt: "test", timeoutMs: 30000 });
		collector.recordFallback(r1, "claude-code", "codex", "timeout", "timeout" as any, 1200);
		collector.finishExecution(r1, { provider: "codex", output: "ok", files: [], tokens: {}, metadata: { durationMs: 2000 } } as any);

		const r2 = collector.startExecution({ runId: "r2", taskId: "t2", provider: "claude-code", repoPath: "/tmp", prompt: "test", timeoutMs: 30000 });
		collector.recordFallback(r2, "claude-code", "codex", "timeout", "timeout" as any, 1500);
		collector.finishExecution(r2, { provider: "codex", output: "ok", files: [], tokens: {}, metadata: { durationMs: 2500 } } as any);

		const baseline = buildPerformanceBaseline(collector, 3600000);
		expect(baseline.topFallbackPatterns).toHaveLength(1);
		expect(baseline.topFallbackPatterns[0].count).toBe(2);
		expect(baseline.topFallbackPatterns[0].fromProvider).toBe("claude-code");
		expect(baseline.topFallbackPatterns[0].toProvider).toBe("codex");
	});

	it("computes latency percentiles correctly", () => {
		const collector = new ProviderTelemetryCollector();
		for (let i = 1; i <= 100; i++) {
			const r = collector.startExecution({ runId: `r${i}`, taskId: `t${i}`, provider: "claude-code", repoPath: "/tmp", prompt: "test", timeoutMs: 30000 });
			collector.finishExecution(r, { provider: "claude-code", output: "ok", files: [], tokens: {}, metadata: { durationMs: i * 100 } } as any);
		}

		const baseline = buildPerformanceBaseline(collector, 3600000);
		expect(baseline.overallP95LatencyMs).toBeGreaterThanOrEqual(9500);
		expect(baseline.overallP99LatencyMs).toBeGreaterThanOrEqual(9900);
	});

	it("filters by window correctly", () => {
		const collector = new ProviderTelemetryCollector();
		// Old record (2 hours ago)
		const old = collector.startExecution({ runId: "old", taskId: "told", provider: "claude-code", repoPath: "/tmp", prompt: "test", timeoutMs: 30000 });
		(old as any).startedAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
		collector.finishExecution(old, { provider: "claude-code", output: "ok", files: [], tokens: {}, metadata: { durationMs: 1000 } } as any);

		// Recent record
		const recent = collector.startExecution({ runId: "new", taskId: "tnew", provider: "claude-code", repoPath: "/tmp", prompt: "test", timeoutMs: 30000 });
		collector.finishExecution(recent, { provider: "claude-code", output: "ok", files: [], tokens: {}, metadata: { durationMs: 2000 } } as any);

		const baseline = buildPerformanceBaseline(collector, 3600000); // 1h window
		expect(baseline.totalExecutions).toBe(1);
		expect(baseline.avgLatencyMs).toBe(2000);
	});
});
