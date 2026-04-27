// ---------------------------------------------------------------------------
// Provider SDK — Observability Tests
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
	classifyProviderError,
	ProviderTelemetryCollector,
} from "../src/observability.js";
import {
	ProviderUnavailableError,
	ProviderTimeoutError,
	ProviderExecutionError,
	ProviderRateLimitError,
} from "@oscorpex/core";

describe("classifyProviderError", () => {
	it("classifies ProviderUnavailableError", () => {
		const err = new ProviderUnavailableError("claude-code", "not found");
		expect(classifyProviderError(err)).toBe("unavailable");
	});

	it("classifies ProviderTimeoutError", () => {
		const err = new ProviderTimeoutError("codex", "t1", 300_000);
		expect(classifyProviderError(err)).toBe("timeout");
	});

	it("classifies ProviderRateLimitError", () => {
		const err = new ProviderRateLimitError("claude-code", 60_000);
		expect(classifyProviderError(err)).toBe("rate_limited");
	});

	it("classifies killed errors", () => {
		const err = new Error("CLI killed by SIGTERM");
		expect(classifyProviderError(err)).toBe("killed");
	});

	it("classifies tool restriction errors", () => {
		const err = new Error("cannot honor restricted tool policies");
		expect(classifyProviderError(err)).toBe("tool_restriction_unsupported");
	});

	it("classifies cli_error from exit code", () => {
		const err = new Error("exited with code 1: something broke");
		expect(classifyProviderError(err)).toBe("cli_error");
	});

	it("classifies spawn failures", () => {
		const err = new Error("spawn failed: ENOENT");
		expect(classifyProviderError(err)).toBe("spawn_failure");
	});

	it("classifies unknown errors", () => {
		const err = new Error("random failure");
		expect(classifyProviderError(err)).toBe("unknown");
	});

	it("classifies non-errors as unknown", () => {
		expect(classifyProviderError("string error")).toBe("unknown");
	});
});

describe("ProviderTelemetryCollector", () => {
	it("starts an execution record", () => {
		const collector = new ProviderTelemetryCollector();
		const record = collector.startExecution({
			runId: "r1",
			taskId: "t1",
			provider: "claude-code",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		});

		expect(record.runId).toBe("r1");
		expect(record.taskId).toBe("t1");
		expect(record.primaryProvider).toBe("claude-code");
		expect(record.success).toBe(false);
		expect(record.fallbackCount).toBe(0);
		expect(record.fallbackTimeline).toEqual([]);
		expect(record.startedAt).toBeDefined();
	});

	it("records a fallback entry", () => {
		const collector = new ProviderTelemetryCollector();
		const record = collector.startExecution({
			runId: "r1",
			taskId: "t1",
			provider: "claude-code",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		});

		collector.recordFallback(record, "claude-code", "codex", "timeout", "timeout", 300_000);
		expect(record.fallbackCount).toBe(1);
		expect(record.fallbackTimeline).toHaveLength(1);
		expect(record.fallbackTimeline[0]!.fromProvider).toBe("claude-code");
		expect(record.fallbackTimeline[0]!.toProvider).toBe("codex");
		expect(record.fallbackTimeline[0]!.errorClassification).toBe("timeout");
	});

	it("records degraded mode", () => {
		const collector = new ProviderTelemetryCollector();
		const record = collector.startExecution({
			runId: "r1",
			taskId: "t1",
			provider: "claude-code",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		});

		collector.recordDegraded(record, "All providers exhausted");
		expect(record.degradedMode).toBe(true);
		expect(record.degradedMessage).toBe("All providers exhausted");
	});

	it("records cancel", () => {
		const collector = new ProviderTelemetryCollector();
		const record = collector.startExecution({
			runId: "r1",
			taskId: "t1",
			provider: "claude-code",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		});

		collector.recordCancel(record, "user request");
		expect(record.canceled).toBe(true);
		expect(record.cancelReason).toBe("user request");
	});

	it("finishes execution successfully", () => {
		const collector = new ProviderTelemetryCollector();
		const record = collector.startExecution({
			runId: "r1",
			taskId: "t1",
			provider: "claude-code",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		});

		const result = {
			provider: "claude-code",
			text: "ok",
			filesCreated: [],
			filesModified: [],
			logs: [],
			startedAt: record.startedAt,
			completedAt: new Date().toISOString(),
			metadata: { durationMs: 1500 },
		};

		collector.finishExecution(record, result);
		expect(record.success).toBe(true);
		expect(record.latencyMs).toBe(1500);
		expect(record.finalProvider).toBe("claude-code");
		expect(record.completedAt).toBeDefined();
	});

	it("finishes execution with error", () => {
		const collector = new ProviderTelemetryCollector();
		const record = collector.startExecution({
			runId: "r1",
			taskId: "t1",
			provider: "claude-code",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		});

		const err = new ProviderTimeoutError("claude-code", "t1", 300_000);
		collector.finishExecution(record, null, err);

		expect(record.success).toBe(false);
		expect(record.errorClassification).toBe("timeout");
		expect(record.errorMessage).toContain("timed out");
	});

	it("retrieves a record by runId:taskId", () => {
		const collector = new ProviderTelemetryCollector();
		collector.startExecution({
			runId: "r1",
			taskId: "t1",
			provider: "claude-code",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		});

		const fetched = collector.getRecord("r1", "t1");
		expect(fetched).toBeDefined();
		expect(fetched!.runId).toBe("r1");
	});

	it("computes latency snapshot", () => {
		const collector = new ProviderTelemetryCollector();
		const record = collector.startExecution({
			runId: "r1",
			taskId: "t1",
			provider: "claude-code",
			repoPath: "/tmp",
			prompt: "hello",
			timeoutMs: 5000,
		});

		collector.finishExecution(record, {
			provider: "claude-code",
			text: "ok",
			filesCreated: [],
			filesModified: [],
			logs: [],
			startedAt: record.startedAt,
			completedAt: new Date().toISOString(),
			metadata: { durationMs: 2000 },
		});

		const snapshot = collector.getLatencySnapshot("claude-code");
		expect(snapshot.totalExecutions).toBe(1);
		expect(snapshot.successfulExecutions).toBe(1);
		expect(snapshot.failedExecutions).toBe(0);
		expect(snapshot.averageLatencyMs).toBe(2000);
	});
});
