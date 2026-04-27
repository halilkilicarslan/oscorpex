// ---------------------------------------------------------------------------
// Tests — Performance Configuration (TASK 15)
// ---------------------------------------------------------------------------

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
	getFeatureFlags,
	getAdaptiveConcurrencyConfig,
	getRetryPolicyConfig,
	getTimeoutPolicyConfig,
	getCooldownConfig,
	getFallbackConfig,
	getHealthCacheConfig,
	getPreflightConfig,
	getPerformanceConfigSnapshot,
	logPerformanceConfig,
	type PerformanceFeatureFlags,
} from "../performance-config.js";

// Helper to safely mutate env vars during tests
function withEnv<T>(key: string, value: string | undefined, fn: () => T): T {
	const original = process.env[key];
	if (value === undefined) {
		delete process.env[key];
	} else {
		process.env[key] = value;
	}
	try {
		return fn();
	} finally {
		if (original === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = original;
		}
	}
}

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

describe("getFeatureFlags", () => {
	it("returns all enabled when env var is unset", () => {
		const flags = withEnv("OSCORPEX_PERF_FEATURES", undefined, getFeatureFlags);
		expect(flags.adaptiveConcurrency).toBe(true);
		expect(flags.retryPolicy).toBe(true);
		expect(flags.fairScheduling).toBe(true);
	});

	it("returns all disabled when env var is empty string", () => {
		const flags = withEnv("OSCORPEX_PERF_FEATURES", "", getFeatureFlags);
		expect(flags.adaptiveConcurrency).toBe(false);
		expect(flags.retryPolicy).toBe(false);
		expect(flags.fairScheduling).toBe(false);
	});

	it("enables only listed features", () => {
		const flags = withEnv("OSCORPEX_PERF_FEATURES", "retryPolicy,timeoutPolicy", getFeatureFlags);
		expect(flags.retryPolicy).toBe(true);
		expect(flags.timeoutPolicy).toBe(true);
		expect(flags.adaptiveConcurrency).toBe(false);
		expect(flags.fairScheduling).toBe(false);
	});

	it("supports deny-list syntax with leading dash", () => {
		const flags = withEnv("OSCORPEX_PERF_FEATURES", "-adaptiveConcurrency", getFeatureFlags);
		expect(flags.adaptiveConcurrency).toBe(false);
		expect(flags.retryPolicy).toBe(true);
		expect(flags.fairScheduling).toBe(true);
	});

	it("supports multiple denied features", () => {
		const flags = withEnv("OSCORPEX_PERF_FEATURES", "-adaptiveConcurrency,-preflightWarmup", getFeatureFlags);
		expect(flags.adaptiveConcurrency).toBe(false);
		expect(flags.preflightWarmup).toBe(false);
		expect(flags.retryPolicy).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Adaptive concurrency config
// ---------------------------------------------------------------------------

describe("getAdaptiveConcurrencyConfig", () => {
	it("returns defaults when no env vars set", () => {
		const cfg = withEnv("OSCORPEX_MAX_CONCURRENT_TASKS", undefined, () =>
			withEnv("OSCORPEX_ADJUSTMENT_INTERVAL_MS", undefined, getAdaptiveConcurrencyConfig),
		);
		expect(cfg.defaultMax).toBe(3);
		expect(cfg.minMax).toBe(1);
		expect(cfg.absoluteMax).toBe(10);
		expect(cfg.adjustmentIntervalMs).toBe(30_000);
		expect(cfg.failureRateThreshold).toBe(0.5);
		expect(cfg.queueDepthThreshold).toBe(5);
	});

	it("reads OSCORPEX_MAX_CONCURRENT_TASKS", () => {
		const cfg = withEnv("OSCORPEX_MAX_CONCURRENT_TASKS", "5", getAdaptiveConcurrencyConfig);
		expect(cfg.defaultMax).toBe(5);
	});

	it("clamps negative max to 1", () => {
		const cfg = withEnv("OSCORPEX_MAX_CONCURRENT_TASKS", "-3", getAdaptiveConcurrencyConfig);
		expect(cfg.defaultMax).toBe(1);
	});

	it("reads OSCORPEX_ADJUSTMENT_INTERVAL_MS", () => {
		const cfg = withEnv("OSCORPEX_ADJUSTMENT_INTERVAL_MS", "60000", getAdaptiveConcurrencyConfig);
		expect(cfg.adjustmentIntervalMs).toBe(60_000);
	});
});

// ---------------------------------------------------------------------------
// Retry policy config
// ---------------------------------------------------------------------------

describe("getRetryPolicyConfig", () => {
	it("returns defaults", () => {
		const cfg = withEnv("OSCORPEX_MAX_AUTO_RETRIES", undefined, () =>
			withEnv("OSCORPEX_BASE_BACKOFF_MS", undefined, getRetryPolicyConfig),
		);
		expect(cfg.maxAutoRetries).toBe(3);
		expect(cfg.baseBackoffMs).toBe(0); // VITEST === "true"
		expect(cfg.maxBackoffMs).toBe(60_000);
	});

	it("reads OSCORPEX_MAX_AUTO_RETRIES", () => {
		const cfg = withEnv("OSCORPEX_MAX_AUTO_RETRIES", "5", getRetryPolicyConfig);
		expect(cfg.maxAutoRetries).toBe(5);
	});

	it("reads OSCORPEX_MAX_BACKOFF_MS", () => {
		const cfg = withEnv("OSCORPEX_MAX_BACKOFF_MS", "120000", getRetryPolicyConfig);
		expect(cfg.maxBackoffMs).toBe(120_000);
	});
});

// ---------------------------------------------------------------------------
// Timeout policy config
// ---------------------------------------------------------------------------

describe("getTimeoutPolicyConfig", () => {
	it("returns defaults", () => {
		const cfg = getTimeoutPolicyConfig();
		expect(cfg.complexityBaseMs.S).toBe(30 * 60 * 1000);
		expect(cfg.complexityBaseMs.M).toBe(30 * 60 * 1000);
		expect(cfg.complexityBaseMs.L).toBe(45 * 60 * 1000);
		expect(cfg.complexityBaseMs.XL).toBe(60 * 60 * 1000);
		expect(cfg.providerMultipliers["claude-code"]).toBe(1.0);
		expect(cfg.providerMultipliers.codex).toBe(1.2);
		expect(cfg.providerMultipliers.cursor).toBe(1.1);
		expect(cfg.minMs).toBe(5 * 60 * 1000);
		expect(cfg.maxMs).toBe(90 * 60 * 1000);
		expect(cfg.warningThreshold).toBe(0.8);
	});

	it("reads OSCORPEX_TIMEOUT_S", () => {
		const cfg = withEnv("OSCORPEX_TIMEOUT_S", "60000", getTimeoutPolicyConfig);
		expect(cfg.complexityBaseMs.S).toBe(60_000);
	});

	it("reads OSCORPEX_MULTIPLIER_CODEX", () => {
		const cfg = withEnv("OSCORPEX_MULTIPLIER_CODEX", "1.5", getTimeoutPolicyConfig);
		expect(cfg.providerMultipliers.codex).toBe(1.5);
	});
});

// ---------------------------------------------------------------------------
// Cooldown config
// ---------------------------------------------------------------------------

describe("getCooldownConfig", () => {
	it("returns defaults", () => {
		const cfg = getCooldownConfig();
		expect(cfg.durationsMs.unavailable).toBe(30_000);
		expect(cfg.durationsMs.spawn_failure).toBe(60_000);
		expect(cfg.durationsMs.rate_limited).toBe(60_000);
		expect(cfg.durationsMs.repeated_timeout).toBe(90_000);
		expect(cfg.durationsMs.cli_error).toBe(0);
		expect(cfg.durationsMs.manual).toBe(30_000);
	});

	it("reads OSCORPEX_COOLDOWN_UNAVAILABLE_MS", () => {
		const cfg = withEnv("OSCORPEX_COOLDOWN_UNAVAILABLE_MS", "45000", getCooldownConfig);
		expect(cfg.durationsMs.unavailable).toBe(45_000);
	});
});

// ---------------------------------------------------------------------------
// Fallback config
// ---------------------------------------------------------------------------

describe("getFallbackConfig", () => {
	it("returns defaults", () => {
		const cfg = getFallbackConfig();
		expect(cfg.severity.tool_restriction_unsupported).toBe(100);
		expect(cfg.severity.spawn_failure).toBe(90);
		expect(cfg.severity.unavailable).toBe(80);
		expect(cfg.severity.rate_limited).toBe(70);
		expect(cfg.severity.timeout).toBe(60);
		expect(cfg.severity.cli_error).toBe(40);
		expect(cfg.severity.killed).toBe(30);
		expect(cfg.severity.unknown).toBe(20);
	});

	it("reads OSCORPEX_SEVERITY_TIMEOUT", () => {
		const cfg = withEnv("OSCORPEX_SEVERITY_TIMEOUT", "55", getFallbackConfig);
		expect(cfg.severity.timeout).toBe(55);
	});
});

// ---------------------------------------------------------------------------
// Health cache config
// ---------------------------------------------------------------------------

describe("getHealthCacheConfig", () => {
	it("returns defaults", () => {
		const cfg = getHealthCacheConfig();
		expect(cfg.availabilityTtlMs).toBe(30_000);
		expect(cfg.capabilityTtlMs).toBe(300_000);
	});

	it("reads OSCORPEX_AVAILABILITY_CACHE_TTL_MS", () => {
		const cfg = withEnv("OSCORPEX_AVAILABILITY_CACHE_TTL_MS", "60000", getHealthCacheConfig);
		expect(cfg.availabilityTtlMs).toBe(60_000);
	});
});

// ---------------------------------------------------------------------------
// Preflight config
// ---------------------------------------------------------------------------

describe("getPreflightConfig", () => {
	it("defaults to enabled", () => {
		const cfg = withEnv("OSCORPEX_PREFLIGHT_ENABLED", undefined, getPreflightConfig);
		expect(cfg.enabled).toBe(true);
	});

	it("can be disabled", () => {
		const cfg = withEnv("OSCORPEX_PREFLIGHT_ENABLED", "false", getPreflightConfig);
		expect(cfg.enabled).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

describe("getPerformanceConfigSnapshot", () => {
	it("returns a complete snapshot with all subsystems", () => {
		const snap = getPerformanceConfigSnapshot();
		expect(snap.features).toBeDefined();
		expect(snap.adaptiveConcurrency).toBeDefined();
		expect(snap.retryPolicy).toBeDefined();
		expect(snap.timeoutPolicy).toBeDefined();
		expect(snap.cooldown).toBeDefined();
		expect(snap.fallback).toBeDefined();
		expect(snap.healthCache).toBeDefined();
		expect(snap.preflight).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// logPerformanceConfig
// ---------------------------------------------------------------------------

describe("logPerformanceConfig", () => {
	it("runs without throwing", () => {
		expect(() => logPerformanceConfig()).not.toThrow();
	});
});
