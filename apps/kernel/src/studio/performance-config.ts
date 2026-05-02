// ---------------------------------------------------------------------------
// Oscorpex — Performance Configuration (TASK 15)
// Centralized tunables for scheduling, concurrency, fallback, retry, and
// timeout subsystems. All values can be overridden via environment variables
// for gradual rollout and environment-specific tuning.
// ---------------------------------------------------------------------------

import { createLogger } from "./logger.js";
const log = createLogger("performance-config");

// ---------------------------------------------------------------------------
// Feature flags — gradual rollout surface
// ---------------------------------------------------------------------------

export interface PerformanceFeatureFlags {
	adaptiveConcurrency: boolean;
	fairScheduling: boolean;
	fallbackDecisionMotor: boolean;
	retryPolicy: boolean;
	providerRuntimeCache: boolean;
	providerHealthCache: boolean;
	costAwareModelSelection: boolean;
	preflightWarmup: boolean;
	providerCooldown: boolean;
	timeoutPolicy: boolean;
	queueWaitTelemetry: boolean;
	/** Allow fallback to legacy CLI adapters when native registry adapter is missing.
	 *  Default: false. Set to true only for explicit legacy compatibility runs. */
	legacyCliAdapter: boolean;
}

const ALL_FEATURES_ENABLED: PerformanceFeatureFlags = {
	adaptiveConcurrency: true,
	fairScheduling: true,
	fallbackDecisionMotor: true,
	retryPolicy: true,
	providerRuntimeCache: true,
	providerHealthCache: true,
	costAwareModelSelection: true,
	preflightWarmup: true,
	providerCooldown: true,
	timeoutPolicy: true,
	queueWaitTelemetry: true,
	legacyCliAdapter: false,
};

/**
 * Parses feature flags from OSCORPEX_PERF_FEATURES env var.
 *
 * Format: comma-separated list of features to enable. If the string starts
 * with `-`, it is treated as a deny-list (all features enabled except listed).
 *
 * Examples:
 *   OSCORPEX_PERF_FEATURES=""                    → all disabled
 *   OSCORPEX_PERF_FEATURES="retryPolicy,timeoutPolicy" → only those two
 *   OSCORPEX_PERF_FEATURES="-adaptiveConcurrency" → all except adaptiveConcurrency
 *   (unset)                                      → all enabled
 */
export function getFeatureFlags(): PerformanceFeatureFlags {
	const raw = process.env.OSCORPEX_PERF_FEATURES;
	if (raw === undefined) {
		return { ...ALL_FEATURES_ENABLED };
	}
	if (raw.trim() === "") {
		return Object.fromEntries(
			Object.keys(ALL_FEATURES_ENABLED).map((k) => [k, false]),
		) as unknown as PerformanceFeatureFlags;
	}

	const tokens = raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const isDenyList = tokens[0]!.startsWith("-");

	if (isDenyList) {
		const denied = new Set(tokens.map((t) => t.slice(1)));
		return Object.fromEntries(
			Object.entries(ALL_FEATURES_ENABLED).map(([k, _v]) => [k, !denied.has(k)]),
		) as unknown as PerformanceFeatureFlags;
	}

	const allowed = new Set(tokens);
	return Object.fromEntries(
		Object.entries(ALL_FEATURES_ENABLED).map(([k, _v]) => [k, allowed.has(k)]),
	) as unknown as PerformanceFeatureFlags;
}

// ---------------------------------------------------------------------------
// Adaptive concurrency tunables
// ---------------------------------------------------------------------------

export interface AdaptiveConcurrencyConfig {
	defaultMax: number;
	minMax: number;
	absoluteMax: number;
	adjustmentIntervalMs: number;
	failureRateThreshold: number;
	queueDepthThreshold: number;
}

export function getAdaptiveConcurrencyConfig(): AdaptiveConcurrencyConfig {
	return {
		defaultMax: Math.max(1, Number(process.env.OSCORPEX_MAX_CONCURRENT_TASKS) || 3),
		minMax: 1,
		absoluteMax: 10,
		adjustmentIntervalMs: Number(process.env.OSCORPEX_ADJUSTMENT_INTERVAL_MS) || 30_000,
		failureRateThreshold: Number(process.env.OSCORPEX_FAILURE_RATE_THRESHOLD) || 0.5,
		queueDepthThreshold: Number(process.env.OSCORPEX_QUEUE_DEPTH_THRESHOLD) || 5,
	};
}

// ---------------------------------------------------------------------------
// Retry policy tunables
// ---------------------------------------------------------------------------

export interface RetryPolicyConfig {
	maxAutoRetries: number;
	baseBackoffMs: number;
	maxBackoffMs: number;
}

export function getRetryPolicyConfig(): RetryPolicyConfig {
	const isTestEnv = process.env.VITEST === "true";
	return {
		maxAutoRetries: Math.max(0, Number(process.env.OSCORPEX_MAX_AUTO_RETRIES) || 3),
		baseBackoffMs: isTestEnv ? 0 : Math.max(0, Number(process.env.OSCORPEX_BASE_BACKOFF_MS) || 5_000),
		maxBackoffMs: Math.max(0, Number(process.env.OSCORPEX_MAX_BACKOFF_MS) || 60_000),
	};
}

// ---------------------------------------------------------------------------
// Timeout policy tunables
// ---------------------------------------------------------------------------

export interface TimeoutPolicyConfig {
	complexityBaseMs: Record<string, number>;
	providerMultipliers: Record<string, number>;
	minMs: number;
	maxMs: number;
	warningThreshold: number;
}

export function getTimeoutPolicyConfig(): TimeoutPolicyConfig {
	return {
		complexityBaseMs: {
			S: Number(process.env.OSCORPEX_TIMEOUT_S) || 30 * 60 * 1000,
			M: Number(process.env.OSCORPEX_TIMEOUT_M) || 30 * 60 * 1000,
			L: Number(process.env.OSCORPEX_TIMEOUT_L) || 45 * 60 * 1000,
			XL: Number(process.env.OSCORPEX_TIMEOUT_XL) || 60 * 60 * 1000,
		},
		providerMultipliers: {
			"claude-code": Number(process.env.OSCORPEX_MULTIPLIER_CLAUDE) || 1.0,
			codex: Number(process.env.OSCORPEX_MULTIPLIER_CODEX) || 1.2,
			cursor: Number(process.env.OSCORPEX_MULTIPLIER_CURSOR) || 1.1,
			none: 1.0,
		},
		minMs: Number(process.env.OSCORPEX_TIMEOUT_MIN_MS) || 5 * 60 * 1000,
		maxMs: Number(process.env.OSCORPEX_TIMEOUT_MAX_MS) || 90 * 60 * 1000,
		warningThreshold: Number(process.env.OSCORPEX_TIMEOUT_WARNING_THRESHOLD) || 0.8,
	};
}

// ---------------------------------------------------------------------------
// Cooldown tunables
// ---------------------------------------------------------------------------

export type CooldownTrigger =
	| "unavailable"
	| "spawn_failure"
	| "rate_limited"
	| "repeated_timeout"
	| "cli_error"
	| "manual";

export interface CooldownConfig {
	durationsMs: Record<CooldownTrigger, number>;
}

export function getCooldownConfig(): CooldownConfig {
	return {
		durationsMs: {
			unavailable: Number(process.env.OSCORPEX_COOLDOWN_UNAVAILABLE_MS) || 30_000,
			spawn_failure: Number(process.env.OSCORPEX_COOLDOWN_SPAWN_FAILURE_MS) || 60_000,
			rate_limited: Number(process.env.OSCORPEX_COOLDOWN_RATE_LIMITED_MS) || 60_000,
			repeated_timeout: Number(process.env.OSCORPEX_COOLDOWN_REPEATED_TIMEOUT_MS) || 90_000,
			cli_error: Number(process.env.OSCORPEX_COOLDOWN_CLI_ERROR_MS) || 0,
			manual: Number(process.env.OSCORPEX_COOLDOWN_MANUAL_MS) || 30_000,
		},
	};
}

// ---------------------------------------------------------------------------
// Fallback severity tunables
// ---------------------------------------------------------------------------

export interface FallbackConfig {
	severity: Record<string, number>;
}

export function getFallbackConfig(): FallbackConfig {
	return {
		severity: {
			tool_restriction_unsupported: Number(process.env.OSCORPEX_SEVERITY_TOOL_RESTRICTION) || 100,
			spawn_failure: Number(process.env.OSCORPEX_SEVERITY_SPAWN_FAILURE) || 90,
			unavailable: Number(process.env.OSCORPEX_SEVERITY_UNAVAILABLE) || 80,
			rate_limited: Number(process.env.OSCORPEX_SEVERITY_RATE_LIMITED) || 70,
			timeout: Number(process.env.OSCORPEX_SEVERITY_TIMEOUT) || 60,
			cli_error: Number(process.env.OSCORPEX_SEVERITY_CLI_ERROR) || 40,
			killed: Number(process.env.OSCORPEX_SEVERITY_KILLED) || 30,
			unknown: Number(process.env.OSCORPEX_SEVERITY_UNKNOWN) || 20,
		},
	};
}

// ---------------------------------------------------------------------------
// Health cache tunables
// ---------------------------------------------------------------------------

export interface HealthCacheConfig {
	availabilityTtlMs: number;
	capabilityTtlMs: number;
}

export function getHealthCacheConfig(): HealthCacheConfig {
	return {
		availabilityTtlMs: Number(process.env.OSCORPEX_AVAILABILITY_CACHE_TTL_MS) || 30_000,
		capabilityTtlMs: Number(process.env.OSCORPEX_CAPABILITY_CACHE_TTL_MS) || 300_000,
	};
}

// ---------------------------------------------------------------------------
// Preflight warm-up tunables
// ---------------------------------------------------------------------------

export interface PreflightConfig {
	enabled: boolean;
}

export function getPreflightConfig(): PreflightConfig {
	return {
		enabled: process.env.OSCORPEX_PREFLIGHT_ENABLED !== "false",
	};
}

// ---------------------------------------------------------------------------
// DB Pool config
// ---------------------------------------------------------------------------

export interface DbPoolConfig {
	minConnections: number;
	maxConnections: number;
	idleTimeoutMs: number;
	acquireTimeoutMs: number;
}

export function getDbPoolConfig(): DbPoolConfig {
	return {
		minConnections: Math.max(0, Number(process.env.OSCORPEX_DB_POOL_MIN) || 2),
		maxConnections: Math.max(1, Number(process.env.OSCORPEX_DB_POOL_MAX) || 20),
		idleTimeoutMs: Math.max(1_000, Number(process.env.OSCORPEX_DB_IDLE_TIMEOUT_MS) || 30_000),
		acquireTimeoutMs: Math.max(1_000, Number(process.env.OSCORPEX_DB_ACQUIRE_TIMEOUT_MS) || 5_000),
	};
}

// ---------------------------------------------------------------------------
// Full config snapshot (for telemetry / debugging)
// ---------------------------------------------------------------------------

export interface PerformanceConfigSnapshot {
	features: PerformanceFeatureFlags;
	adaptiveConcurrency: AdaptiveConcurrencyConfig;
	retryPolicy: RetryPolicyConfig;
	timeoutPolicy: TimeoutPolicyConfig;
	cooldown: CooldownConfig;
	fallback: FallbackConfig;
	healthCache: HealthCacheConfig;
	preflight: PreflightConfig;
	dbPool: DbPoolConfig;
}

export function getPerformanceConfigSnapshot(): PerformanceConfigSnapshot {
	return {
		features: getFeatureFlags(),
		adaptiveConcurrency: getAdaptiveConcurrencyConfig(),
		retryPolicy: getRetryPolicyConfig(),
		timeoutPolicy: getTimeoutPolicyConfig(),
		cooldown: getCooldownConfig(),
		fallback: getFallbackConfig(),
		healthCache: getHealthCacheConfig(),
		preflight: getPreflightConfig(),
		dbPool: getDbPoolConfig(),
	};
}

// ---------------------------------------------------------------------------
// Validation / safety helpers
// ---------------------------------------------------------------------------

/**
 * Logs current config at startup. Safe to call multiple times (idempotent log).
 */
export function logPerformanceConfig(): void {
	const snap = getPerformanceConfigSnapshot();
	log.info("[performance-config] Active performance configuration:");
	log.info(`  features: ${JSON.stringify(snap.features)}`);
	log.info(
		`  adaptiveConcurrency: defaultMax=${snap.adaptiveConcurrency.defaultMax}, interval=${snap.adaptiveConcurrency.adjustmentIntervalMs}ms`,
	);
	log.info(
		`  retryPolicy: maxRetries=${snap.retryPolicy.maxAutoRetries}, baseBackoff=${snap.retryPolicy.baseBackoffMs}ms`,
	);
	log.info(
		`  timeoutPolicy: S=${snap.timeoutPolicy.complexityBaseMs.S}ms, M=${snap.timeoutPolicy.complexityBaseMs.M}ms, L=${snap.timeoutPolicy.complexityBaseMs.L}ms, XL=${snap.timeoutPolicy.complexityBaseMs.XL}ms`,
	);
	log.info(
		`  cooldown: unavailable=${snap.cooldown.durationsMs.unavailable}ms, spawn_failure=${snap.cooldown.durationsMs.spawn_failure}ms`,
	);
	log.info(
		`  dbPool: min=${snap.dbPool.minConnections}, max=${snap.dbPool.maxConnections}, idleTimeout=${snap.dbPool.idleTimeoutMs}ms, acquireTimeout=${snap.dbPool.acquireTimeoutMs}ms`,
	);
}
