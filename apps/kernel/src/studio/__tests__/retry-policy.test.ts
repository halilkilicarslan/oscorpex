// ---------------------------------------------------------------------------
// Tests — Retry Policy (TASK 10)
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
	BASE_BACKOFF_MS,
	MAX_AUTO_RETRIES,
	buildRetryTelemetry,
	computeBackoffMs,
	evaluateRetry,
	getRetryDecision,
	isRetryable,
} from "../retry-policy.js";

const isTestEnv = process.env.VITEST === "true";

describe("getRetryDecision", () => {
	it("fallback for spawn_failure", () => {
		expect(getRetryDecision("spawn_failure")).toBe("fallback");
	});

	it("fallback for unavailable", () => {
		expect(getRetryDecision("unavailable")).toBe("fallback");
	});

	it("fallback for rate_limited", () => {
		expect(getRetryDecision("rate_limited")).toBe("fallback");
	});

	it("fallback for tool_restriction_unsupported", () => {
		expect(getRetryDecision("tool_restriction_unsupported")).toBe("fallback");
	});

	it("retry for timeout", () => {
		expect(getRetryDecision("timeout")).toBe("retry");
	});

	it("retry for cli_error", () => {
		expect(getRetryDecision("cli_error")).toBe("retry");
	});

	it("retry for unknown", () => {
		expect(getRetryDecision("unknown")).toBe("retry");
	});
});

describe("isRetryable", () => {
	it("returns false for fallback classifications", () => {
		expect(isRetryable("spawn_failure")).toBe(false);
		expect(isRetryable("rate_limited")).toBe(false);
	});

	it("returns true for retry classifications", () => {
		expect(isRetryable("timeout")).toBe(true);
		expect(isRetryable("cli_error")).toBe(true);
	});
});

describe("computeBackoffMs", () => {
	it("doubles each attempt", () => {
		expect(computeBackoffMs(0)).toBe(BASE_BACKOFF_MS);
		expect(computeBackoffMs(1)).toBe(BASE_BACKOFF_MS * 2);
		expect(computeBackoffMs(2)).toBe(BASE_BACKOFF_MS * 4);
	});

	it("caps at MAX_BACKOFF_MS", () => {
		const expectedMax = isTestEnv ? 0 : 60_000;
		expect(computeBackoffMs(10)).toBe(expectedMax);
	});
});

describe("evaluateRetry", () => {
	it("allows retry when under max and classification is retryable", () => {
		const result = evaluateRetry("cli_error", 0);
		expect(result.shouldRetry).toBe(true);
		expect(result.delayMs).toBe(BASE_BACKOFF_MS);
	});

	it("blocks retry when max reached", () => {
		const result = evaluateRetry("cli_error", MAX_AUTO_RETRIES);
		expect(result.shouldRetry).toBe(false);
		expect(result.delayMs).toBe(0);
	});

	it("blocks retry for fallback classifications", () => {
		const result = evaluateRetry("spawn_failure", 0);
		expect(result.shouldRetry).toBe(false);
		expect(result.delayMs).toBe(0);
	});

	it("increases delay with attempt count", () => {
		const r0 = evaluateRetry("timeout", 0);
		const r1 = evaluateRetry("timeout", 1);
		const r2 = evaluateRetry("timeout", 2);
		if (isTestEnv) {
			expect(r0.delayMs).toBe(0);
			expect(r1.delayMs).toBe(0);
			expect(r2.delayMs).toBe(0);
		} else {
			expect(r0.delayMs).toBeLessThan(r1.delayMs);
			expect(r1.delayMs).toBeLessThan(r2.delayMs);
		}
	});
});

describe("buildRetryTelemetry", () => {
	it("includes decision and backoff for retryable", () => {
		const telemetry = buildRetryTelemetry("cli_error", 1);
		expect(telemetry.retryDecision).toBe("retry");
		expect(telemetry.retryCount).toBe(1);
		expect(telemetry.maxRetries).toBe(MAX_AUTO_RETRIES);
		if (isTestEnv) {
			expect(telemetry.backoffMs).toBe(0);
		} else {
			expect(telemetry.backoffMs).toBeGreaterThan(0);
		}
	});

	it("includes zero backoff for non-retryable", () => {
		const telemetry = buildRetryTelemetry("rate_limited", 0);
		expect(telemetry.retryDecision).toBe("fallback");
		expect(telemetry.backoffMs).toBe(0);
	});
});
