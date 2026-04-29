// ---------------------------------------------------------------------------
// Tests — Preflight Warm-up (TASK 12)
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	markExecutionStarted,
	isColdStart,
	resetColdStart,
	runPreflightHealthChecks,
	resolveBinaryPath,
	clearBinaryPathCache,
	getLastPreflightTelemetry,
} from "../preflight-warmup.js";
import { providerRuntimeCache } from "../provider-runtime-cache.js";

vi.mock("../provider-runtime-cache.js", () => ({
	providerRuntimeCache: {
		resolveAvailability: vi.fn(),
	},
}));

describe("cold start tracking", () => {
	beforeEach(() => {
		resetColdStart();
	});

	it("marks first execution as cold start", () => {
		const result = markExecutionStarted();
		expect(result.isColdStart).toBe(true);
	});

	it("marks subsequent executions as warm", () => {
		markExecutionStarted();
		const result = markExecutionStarted();
		expect(result.isColdStart).toBe(false);
	});

	it("isColdStart returns true before any execution", () => {
		expect(isColdStart()).toBe(true);
	});

	it("isColdStart returns false after first execution", () => {
		markExecutionStarted();
		expect(isColdStart()).toBe(false);
	});
});

describe("runPreflightHealthChecks", () => {
	beforeEach(() => {
		vi.mocked(providerRuntimeCache.resolveAvailability).mockReset();
	});

	it("returns results for all adapters", async () => {
		vi.mocked(providerRuntimeCache.resolveAvailability)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);
		const adapters = [
			{ name: "claude-code", isAvailable: vi.fn().mockResolvedValue(true) },
			{ name: "codex", isAvailable: vi.fn().mockResolvedValue(false) },
		];
		const results = await runPreflightHealthChecks(adapters);
		expect(results).toHaveLength(2);
		expect(results[0]!.providerId).toBe("claude-code");
		expect(results[0]!.available).toBe(true);
		expect(results[1]!.providerId).toBe("codex");
		expect(results[1]!.available).toBe(false);
	});

	it("records duration for each check", async () => {
		vi.mocked(providerRuntimeCache.resolveAvailability).mockResolvedValue(true);
		const adapters = [{ name: "cursor", isAvailable: vi.fn().mockResolvedValue(true) }];
		const results = await runPreflightHealthChecks(adapters);
		expect(typeof results[0]!.durationMs).toBe("number");
		expect(results[0]!.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("stores telemetry after run (TASK 7.3)", async () => {
		vi.mocked(providerRuntimeCache.resolveAvailability)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);
		const adapters = [
			{ name: "claude-code", isAvailable: vi.fn().mockResolvedValue(true) },
			{ name: "codex", isAvailable: vi.fn().mockResolvedValue(false) },
		];
		await runPreflightHealthChecks(adapters);

		const telemetry = getLastPreflightTelemetry();
		expect(telemetry).not.toBeNull();
		expect(telemetry!.totalProviders).toBe(2);
		expect(telemetry!.successCount).toBe(1);
		expect(telemetry!.failCount).toBe(1);
		expect(telemetry!.results).toHaveLength(2);
		expect(telemetry!.ranAt).toBeTruthy();
	});

	it("first call is cold start, second is warm (TASK 7.3)", () => {
		resetColdStart();
		const first = markExecutionStarted();
		const second = markExecutionStarted();
		expect(first.isColdStart).toBe(true);
		expect(second.isColdStart).toBe(false);
	});
});

describe("resolveBinaryPath", () => {
	beforeEach(() => {
		clearBinaryPathCache();
	});

	it("caches successful lookups", async () => {
		const path1 = await resolveBinaryPath("node");
		expect(path1).toBeTruthy();
		const path2 = await resolveBinaryPath("node");
		expect(path2).toBe(path1);
	});

	it("returns null for missing binaries", async () => {
		const result = await resolveBinaryPath("definitely-not-a-real-binary-12345");
		expect(result).toBeNull();
	});
});
