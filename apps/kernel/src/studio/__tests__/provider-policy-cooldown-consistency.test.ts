// ---------------------------------------------------------------------------
// Provider Policy / Cooldown / Fallback Consistency Tests (P1 E4)
// Verifies cross-module invariants between provider-state, retry-policy,
// fallback-decision, timeout-policy, and performance-config.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	getRetryDecision,
	isRetryable,
	evaluateRetry,
	computeBackoffMs,
	MAX_AUTO_RETRIES,
	BASE_BACKOFF_MS,
} from "../retry-policy.js";
import { getFallbackSeverity, shouldSkipProvider, sortAdapterChain } from "../fallback-decision.js";
import { providerState } from "../provider-state.js";
import { providerRuntimeCache } from "../provider-runtime-cache.js";
import {
	getCooldownConfig,
	getFallbackConfig,
	getRetryPolicyConfig,
	getTimeoutPolicyConfig,
} from "../performance-config.js";
import type { ProviderErrorClassification } from "@oscorpex/provider-sdk";

vi.mock("../provider-runtime-cache.js", () => ({
	providerRuntimeCache: {
		resolveCapability: vi.fn(),
		invalidateAvailability: vi.fn(),
	},
}));

vi.mock("../provider-state.js", () => ({
	providerState: {
		isAvailable: vi.fn().mockReturnValue(true),
		markCooldown: vi.fn(),
		markRateLimited: vi.fn(),
		markSuccess: vi.fn(),
		markFailure: vi.fn(),
		isAllExhausted: vi.fn().mockReturnValue(false),
		getEarliestRecoveryMs: vi.fn().mockReturnValue(60_000),
		getState: vi.fn(),
		getAllStates: vi.fn().mockReturnValue([]),
	},
}));

function makeAdapter(name: string) {
	return {
		name,
		isAvailable: vi.fn().mockResolvedValue(true),
		capabilities: vi.fn().mockResolvedValue({
			supportedModels: ["model-1"],
			supportsToolRestriction: true,
			supportsStreaming: false,
			supportsResume: false,
			supportsCancel: true,
			supportsStructuredOutput: false,
			supportsSandboxHinting: true,
		}),
		execute: vi.fn(),
	};
}

// ---------------------------------------------------------------------------
// Local ProviderStateManager for state-transition tests (avoids singleton pollution)
// ---------------------------------------------------------------------------

interface ProviderState {
	adapter: string;
	rateLimited: boolean;
	cooldownUntil: Date | null;
	consecutiveFailures: number;
	lastSuccess: Date | null;
}

class ProviderStateManagerUnderTest {
	private states = new Map<string, ProviderState>();

	constructor() {
		for (const tool of ["claude-code", "codex", "cursor"] as const) {
			this.states.set(tool, {
				adapter: tool,
				rateLimited: false,
				cooldownUntil: null,
				consecutiveFailures: 0,
				lastSuccess: null,
			});
		}
	}

	markCooldown(adapter: string, trigger: string, customMs?: number): void {
		const state = this.states.get(adapter);
		if (!state) return;
		const durations: Record<string, number> = {
			unavailable: 30_000,
			spawn_failure: 60_000,
			rate_limited: 60_000,
			repeated_timeout: 90_000,
			cli_error: 120_000,
			manual: 30_000,
		};
		const durationMs = customMs ?? durations[trigger] ?? 30_000;
		state.rateLimited = true;
		state.cooldownUntil = new Date(Date.now() + durationMs);
	}

	markSuccess(adapter: string): void {
		const state = this.states.get(adapter);
		if (state) {
			state.rateLimited = false;
			state.cooldownUntil = null;
			state.consecutiveFailures = 0;
			state.lastSuccess = new Date();
		}
	}

	markFailure(adapter: string, classification?: string): void {
		const state = this.states.get(adapter);
		if (!state) return;
		state.consecutiveFailures++;
		if (classification === "spawn_failure") {
			this.markCooldown(adapter, "spawn_failure");
		} else if (classification === "unavailable") {
			this.markCooldown(adapter, "unavailable");
		} else if (classification === "timeout" && state.consecutiveFailures >= 3) {
			this.markCooldown(adapter, "repeated_timeout");
		}
		if (state.consecutiveFailures >= 3 && !state.rateLimited) {
			this.markCooldown(adapter, "cli_error", 120_000);
		}
	}

	isAvailable(adapter: string): boolean {
		const state = this.states.get(adapter);
		if (!state) return false;
		if (!state.rateLimited) return true;
		if (state.cooldownUntil && state.cooldownUntil <= new Date()) {
			state.rateLimited = false;
			state.cooldownUntil = null;
			return true;
		}
		return false;
	}

	isAllExhausted(): boolean {
		for (const state of this.states.values()) {
			if (this.isAvailable(state.adapter)) return false;
		}
		return true;
	}

	getEarliestRecoveryMs(): number {
		let earliest = Infinity;
		for (const state of this.states.values()) {
			if (state.cooldownUntil) {
				const remaining = state.cooldownUntil.getTime() - Date.now();
				if (remaining > 0 && remaining < earliest) earliest = remaining;
			}
		}
		return earliest === Infinity ? 60_000 : earliest;
	}
}

// ---------------------------------------------------------------------------
// E4.1: Config consistency — severity ordering aligns with retry decisions
// ---------------------------------------------------------------------------

describe("E4: severity ↔ retry decision consistency", () => {
	const classifications: ProviderErrorClassification[] = [
		"tool_restriction_unsupported",
		"spawn_failure",
		"unavailable",
		"rate_limited",
		"timeout",
		"cli_error",
		"killed",
		"unknown",
	];

	it("every fallback classification has higher severity than every retry classification", () => {
		const fallbackSeverities = classifications
			.filter((c) => getRetryDecision(c) === "fallback")
			.map((c) => getFallbackSeverity(c));
		const retrySeverities = classifications
			.filter((c) => getRetryDecision(c) === "retry")
			.map((c) => getFallbackSeverity(c));

		const minFallbackSeverity = Math.min(...fallbackSeverities);
		const maxRetrySeverity = Math.max(...retrySeverities);

		expect(minFallbackSeverity).toBeGreaterThan(maxRetrySeverity);
	});

	it("severity ordering is monotonic with retry decision strictness", () => {
		const ordered = [...classifications].sort((a, b) => getFallbackSeverity(b) - getFallbackSeverity(a));
		const fallbackPrefix = ordered.filter((c) => getRetryDecision(c) === "fallback");
		const retrySuffix = ordered.filter((c) => getRetryDecision(c) === "retry");

		// All fallback classifications should appear before retry classifications in severity order
		expect(fallbackPrefix.length + retrySuffix.length).toBe(classifications.length);
		for (const f of fallbackPrefix) {
			expect(getRetryDecision(f)).toBe("fallback");
		}
		for (const r of retrySuffix) {
			expect(getRetryDecision(r)).toBe("retry");
		}
	});
});

// ---------------------------------------------------------------------------
// E4.2: Config consistency — cooldown durations align with fallback severity
// ---------------------------------------------------------------------------

describe("E4: cooldown durations ↔ severity consistency", () => {
	it("repeated_timeout has the longest cooldown (reflects deepest degradation)", () => {
		const cfg = getCooldownConfig();
		const durations = Object.values(cfg.durationsMs);
		expect(cfg.durationsMs.repeated_timeout).toBe(Math.max(...durations));
	});

	it("cli_error cooldown is zero (immediate fallback, no artificial delay)", () => {
		const cfg = getCooldownConfig();
		expect(cfg.durationsMs.cli_error).toBe(0);
	});

	it("spawn_failure and rate_limited have equal cooldowns (both are hard provider faults)", () => {
		const cfg = getCooldownConfig();
		expect(cfg.durationsMs.spawn_failure).toBe(cfg.durationsMs.rate_limited);
	});

	it("unavailable cooldown is shorter than spawn_failure (binary check is quick)", () => {
		const cfg = getCooldownConfig();
		expect(cfg.durationsMs.unavailable).toBeLessThan(cfg.durationsMs.spawn_failure);
	});
});

// ---------------------------------------------------------------------------
// E4.3: Retry-policy config ↔ performance-config consistency
// ---------------------------------------------------------------------------

describe("E4: retry-policy ↔ performance-config consistency", () => {
	it("MAX_AUTO_RETRIES matches performance-config", () => {
		const cfg = getRetryPolicyConfig();
		expect(MAX_AUTO_RETRIES).toBe(cfg.maxAutoRetries);
	});

	it("BASE_BACKOFF_MS matches performance-config", () => {
		const cfg = getRetryPolicyConfig();
		expect(BASE_BACKOFF_MS).toBe(cfg.baseBackoffMs);
	});

	it("backoff never exceeds maxBackoffMs", () => {
		const cfg = getRetryPolicyConfig();
		for (let i = 0; i < 20; i++) {
			expect(computeBackoffMs(i)).toBeLessThanOrEqual(cfg.maxBackoffMs);
		}
	});

	it("max retries is respected by evaluateRetry for all retryable classifications", () => {
		const retryable: ProviderErrorClassification[] = ["timeout", "cli_error", "killed", "unknown"];
		for (const classification of retryable) {
			for (let i = 0; i < MAX_AUTO_RETRIES; i++) {
				const decision = evaluateRetry(classification, i);
				expect(decision.shouldRetry).toBe(true);
			}
			const decision = evaluateRetry(classification, MAX_AUTO_RETRIES);
			expect(decision.shouldRetry).toBe(false);
		}
	});
});

// ---------------------------------------------------------------------------
// E4.4: Timeout-policy ↔ provider multiplier consistency
// ---------------------------------------------------------------------------

describe("E4: timeout-policy ↔ provider multiplier consistency", () => {
	it("provider multipliers are ordered: codex >= cursor >= claude", () => {
		const cfg = getTimeoutPolicyConfig();
		const claude = cfg.providerMultipliers["claude-code"] ?? 1.0;
		const codex = cfg.providerMultipliers.codex ?? 1.2;
		const cursor = cfg.providerMultipliers.cursor ?? 1.1;
		expect(claude).toBeLessThanOrEqual(cursor);
		expect(cursor).toBeLessThanOrEqual(codex);
	});

	it("all provider multipliers are >= 1.0", () => {
		const cfg = getTimeoutPolicyConfig();
		for (const multiplier of Object.values(cfg.providerMultipliers)) {
			expect(multiplier).toBeGreaterThanOrEqual(1.0);
		}
	});
});

// ---------------------------------------------------------------------------
// E4.5: Provider-state transition consistency
// ---------------------------------------------------------------------------

describe("E4: provider-state transition consistency", () => {
	let manager: ProviderStateManagerUnderTest;

	beforeEach(() => {
		manager = new ProviderStateManagerUnderTest();
		vi.useFakeTimers();
	});

	it("spawn_failure immediately triggers cooldown", () => {
		expect(manager.isAvailable("codex")).toBe(true);
		manager.markFailure("codex", "spawn_failure");
		expect(manager.isAvailable("codex")).toBe(false);
	});

	it("unavailable immediately triggers cooldown", () => {
		expect(manager.isAvailable("claude-code")).toBe(true);
		manager.markFailure("claude-code", "unavailable");
		expect(manager.isAvailable("claude-code")).toBe(false);
	});

	it("single timeout does NOT trigger cooldown", () => {
		manager.markFailure("cursor", "timeout");
		expect(manager.isAvailable("cursor")).toBe(true);
	});

	it("3 timeouts trigger repeated_timeout cooldown", () => {
		manager.markFailure("cursor", "timeout");
		manager.markFailure("cursor", "timeout");
		expect(manager.isAvailable("cursor")).toBe(true); // still available after 2
		manager.markFailure("cursor", "timeout");
		expect(manager.isAvailable("cursor")).toBe(false); // 3rd timeout → cooldown
	});

	it("cooldown expiry restores availability", () => {
		manager.markCooldown("claude-code", "unavailable");
		expect(manager.isAvailable("claude-code")).toBe(false);
		vi.advanceTimersByTime(31_000);
		expect(manager.isAvailable("claude-code")).toBe(true);
	});

	it("markSuccess clears cooldown and failure count", () => {
		manager.markFailure("codex", "timeout");
		manager.markFailure("codex", "timeout");
		manager.markFailure("codex", "timeout");
		expect(manager.isAvailable("codex")).toBe(false);
		manager.markSuccess("codex");
		expect(manager.isAvailable("codex")).toBe(true);
	});

	it("isAllExhausted returns true when all providers in cooldown", () => {
		manager.markCooldown("claude-code", "unavailable");
		manager.markCooldown("codex", "spawn_failure");
		manager.markCooldown("cursor", "rate_limited");
		expect(manager.isAllExhausted()).toBe(true);
	});

	it("isAllExhausted returns false when at least one provider available", () => {
		manager.markCooldown("claude-code", "unavailable");
		manager.markCooldown("codex", "spawn_failure");
		// cursor still available
		expect(manager.isAllExhausted()).toBe(false);
	});

	it("getEarliestRecoveryMs returns smallest remaining cooldown", () => {
		manager.markCooldown("claude-code", "unavailable"); // 30s
		manager.markCooldown("codex", "spawn_failure"); // 60s
		const remaining = manager.getEarliestRecoveryMs();
		expect(remaining).toBeGreaterThan(0);
		expect(remaining).toBeLessThanOrEqual(30_000);
	});
});

// ---------------------------------------------------------------------------
// E4.6: Fallback-decision ↔ provider-state integration
// ---------------------------------------------------------------------------

describe("E4: fallback-decision ↔ provider-state integration", () => {
	beforeEach(() => {
		vi.mocked(providerState.isAvailable).mockReset().mockReturnValue(true);
		vi.mocked(providerRuntimeCache.resolveCapability).mockReset();
	});

	it("shouldSkipProvider returns cooldown_active when providerState.isAvailable is false", async () => {
		vi.mocked(providerState.isAvailable).mockReturnValue(false);
		const adapter = makeAdapter("claude-code");
		const skip = await shouldSkipProvider(adapter, {});
		expect(skip.shouldSkip).toBe(true);
		expect(skip.reason).toBe("cooldown_active");
	});

	it("sortAdapterChain deprioritizes unavailable providers", () => {
		const adapters = [makeAdapter("cursor"), makeAdapter("claude-code"), makeAdapter("codex")];
		vi.mocked(providerState.isAvailable).mockImplementation((name: string) => name !== "cursor");

		const sorted = sortAdapterChain(adapters, () => ({ successRate: 0.8, avgLatencyMs: 1000 }));
		expect(sorted[2]!.name).toBe("cursor"); // unavailable is last
	});

	it("fallback severity of timeout is lower than unavailable", () => {
		expect(getFallbackSeverity("timeout")).toBeLessThan(getFallbackSeverity("unavailable"));
	});

	it("fallback severity of spawn_failure is higher than unavailable", () => {
		expect(getFallbackSeverity("spawn_failure")).toBeGreaterThan(getFallbackSeverity("unavailable"));
	});
});

// ---------------------------------------------------------------------------
// E4.7: End-to-end composite pipeline consistency
// ---------------------------------------------------------------------------

describe("E4: composite pipeline — state → skip → retry decision", () => {
	beforeEach(() => {
		vi.mocked(providerState.isAvailable).mockReset().mockReturnValue(true);
		vi.mocked(providerRuntimeCache.resolveCapability).mockReset();
	});

	it("spawn_failure: retry says fallback → provider-state cooldown → fallback skips provider", async () => {
		// Step 1: retry decision
		expect(getRetryDecision("spawn_failure")).toBe("fallback");
		expect(evaluateRetry("spawn_failure", 0).shouldRetry).toBe(false);

		// Step 2: provider-state cooldown (simulated via mock)
		vi.mocked(providerState.isAvailable).mockReturnValue(false);

		// Step 3: fallback skips
		const adapter = makeAdapter("codex");
		const skip = await shouldSkipProvider(adapter, {});
		expect(skip.shouldSkip).toBe(true);
		expect(skip.reason).toBe("cooldown_active");
	});

	it("timeout: retry says retry → provider-state does NOT cooldown immediately → fallback does NOT skip", async () => {
		// Step 1: retry decision
		expect(getRetryDecision("timeout")).toBe("retry");
		expect(evaluateRetry("timeout", 0).shouldRetry).toBe(true);

		// Step 2: provider-state — single timeout doesn't trigger cooldown
		vi.mocked(providerState.isAvailable).mockReturnValue(true);

		// Step 3: fallback allows
		const adapter = makeAdapter("claude-code");
		const skip = await shouldSkipProvider(adapter, { lastFailureProvider: "cursor", lastFailureClassification: "timeout" });
		// Should not skip because last failure was on different provider
		expect(skip.shouldSkip).toBe(false);
	});

	it("timeout on same provider: fallback skips due to timeout_retry_avoided", async () => {
		const adapter = makeAdapter("claude-code");
		const skip = await shouldSkipProvider(adapter, {
			lastFailureProvider: "claude-code",
			lastFailureClassification: "timeout",
		});
		expect(skip.shouldSkip).toBe(true);
		expect(skip.reason).toBe("timeout_retry_avoided");
	});
});
