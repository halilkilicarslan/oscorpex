// ---------------------------------------------------------------------------
// API Contract Type Consistency Tests (P1 F4)
// Verifies kernel API response shapes match expected console contracts.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { getPerformanceConfigSnapshot } from "../performance-config.js";

describe("F4: API contract — PerformanceConfigSnapshot shape", () => {
	it("returns all expected feature flags", () => {
		const snap = getPerformanceConfigSnapshot();
		const expectedFlags = [
			"adaptiveConcurrency",
			"fairScheduling",
			"fallbackDecisionMotor",
			"retryPolicy",
			"providerRuntimeCache",
			"providerHealthCache",
			"costAwareModelSelection",
			"preflightWarmup",
			"providerCooldown",
			"timeoutPolicy",
			"queueWaitTelemetry",
			"legacyCliAdapter",
		];
		for (const flag of expectedFlags) {
			expect(snap.features).toHaveProperty(flag);
			expect(typeof (snap.features as unknown as Record<string, boolean>)[flag]).toBe("boolean");
		}
	});

	it("returns all expected cooldown durations", () => {
		const snap = getPerformanceConfigSnapshot();
		const expectedDurations = [
			"unavailable",
			"spawn_failure",
			"rate_limited",
			"repeated_timeout",
			"cli_error",
			"manual",
		];
		for (const key of expectedDurations) {
			expect(snap.cooldown.durationsMs).toHaveProperty(key);
			expect(typeof (snap.cooldown.durationsMs as unknown as Record<string, number>)[key]).toBe("number");
		}
	});

	it("returns adaptive concurrency config with expected fields", () => {
		const snap = getPerformanceConfigSnapshot();
		expect(snap.adaptiveConcurrency).toHaveProperty("defaultMax");
		expect(snap.adaptiveConcurrency).toHaveProperty("adjustmentIntervalMs");
		expect(snap.adaptiveConcurrency).toHaveProperty("failureRateThreshold");
		expect(snap.adaptiveConcurrency).toHaveProperty("queueDepthThreshold");
	});

	it("returns retry policy config with expected fields", () => {
		const snap = getPerformanceConfigSnapshot();
		expect(snap.retryPolicy).toHaveProperty("maxAutoRetries");
		expect(snap.retryPolicy).toHaveProperty("baseBackoffMs");
	});

	it("returns timeout policy config with expected fields", () => {
		const snap = getPerformanceConfigSnapshot();
		expect(snap.timeoutPolicy).toHaveProperty("complexityBaseMs");
		expect(snap.timeoutPolicy.complexityBaseMs).toHaveProperty("S");
		expect(snap.timeoutPolicy.complexityBaseMs).toHaveProperty("M");
		expect(snap.timeoutPolicy.complexityBaseMs).toHaveProperty("L");
		expect(snap.timeoutPolicy.complexityBaseMs).toHaveProperty("XL");
		expect(snap.timeoutPolicy).toHaveProperty("providerMultipliers");
	});

	it("returns db pool config with expected fields", () => {
		const snap = getPerformanceConfigSnapshot();
		expect(snap.dbPool).toHaveProperty("minConnections");
		expect(snap.dbPool).toHaveProperty("maxConnections");
		expect(snap.dbPool).toHaveProperty("idleTimeoutMs");
		expect(snap.dbPool).toHaveProperty("acquireTimeoutMs");
	});
});
