// ---------------------------------------------------------------------------
// Tests — Retry / Timeout / Fallback Wiring Integration (TASK 5.4)
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	evaluateRetry,
	isRetryable,
	getRetryDecision,
	computeBackoffMs,
	MAX_AUTO_RETRIES,
	BASE_BACKOFF_MS,
} from "../retry-policy.js";
import {
	shouldSkipProvider,
	sortAdapterChain,
	getFallbackSeverity,
} from "../fallback-decision.js";
import { providerState } from "../provider-state.js";
import { providerRuntimeCache } from "../provider-runtime-cache.js";

vi.mock("../provider-state.js", () => ({
	providerState: {
		isAvailable: vi.fn().mockReturnValue(true),
		markCooldown: vi.fn(),
		markRateLimited: vi.fn(),
	},
}));

vi.mock("../provider-runtime-cache.js", () => ({
	providerRuntimeCache: {
		resolveCapability: vi.fn(),
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
// INTEGRATION: timeout → retry
// ---------------------------------------------------------------------------

describe("INTEGRATION: timeout → retry", () => {
	it("timeout is retryable up to MAX_AUTO_RETRIES", () => {
		expect(getRetryDecision("timeout")).toBe("retry");
		expect(isRetryable("timeout")).toBe(true);

		for (let i = 0; i < MAX_AUTO_RETRIES; i++) {
			const decision = evaluateRetry("timeout", i);
			expect(decision.shouldRetry).toBe(true);
			expect(decision.delayMs).toBe(BASE_BACKOFF_MS * 2 ** i);
		}
	});

	it("timeout after max retries → fail (no more retry)", () => {
		const decision = evaluateRetry("timeout", MAX_AUTO_RETRIES);
		expect(decision.shouldRetry).toBe(false);
		expect(decision.delayMs).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// INTEGRATION: unavailable → cooldown + fallback
// ---------------------------------------------------------------------------

describe("INTEGRATION: unavailable → cooldown + fallback", () => {
	beforeEach(() => {
		vi.mocked(providerState.isAvailable).mockReset().mockReturnValue(false);
		vi.mocked(providerRuntimeCache.resolveCapability).mockReset();
	});

	it("unavailable is non-retryable (immediate fallback)", () => {
		expect(getRetryDecision("unavailable")).toBe("fallback");
		expect(isRetryable("unavailable")).toBe(false);

		const decision = evaluateRetry("unavailable", 0);
		expect(decision.shouldRetry).toBe(false);
		expect(decision.delayMs).toBe(0);
	});

	it("cooldown provider is skipped in fallback chain", async () => {
		const adapter = makeAdapter("claude-code");
		const skip = await shouldSkipProvider(adapter, {});
		expect(skip.shouldSkip).toBe(true);
		expect(skip.reason).toBe("cooldown_active");
	});

	it("unavailable provider gets deprioritized in sorted chain", () => {
		const adapters = [makeAdapter("cursor"), makeAdapter("claude-code")];
		vi.mocked(providerState.isAvailable).mockImplementation((name: string) => name !== "cursor");

		const sorted = sortAdapterChain(adapters, () => ({ successRate: 0.9, avgLatencyMs: 500 }));
		expect(sorted[0]!.name).toBe("claude-code");
		expect(sorted[1]!.name).toBe("cursor");
	});
});

// ---------------------------------------------------------------------------
// INTEGRATION: non-retryable → immediate fail
// ---------------------------------------------------------------------------

describe("INTEGRATION: non-retryable → immediate fail", () => {
	const nonRetryable = [
		"spawn_failure",
		"unavailable",
		"rate_limited",
		"tool_restriction_unsupported",
	] as const;

	for (const classification of nonRetryable) {
		it(`${classification} triggers fallback, never retry`, () => {
			expect(getRetryDecision(classification)).toBe("fallback");
			expect(isRetryable(classification)).toBe(false);

			for (let retryCount = 0; retryCount <= MAX_AUTO_RETRIES + 2; retryCount++) {
				const decision = evaluateRetry(classification, retryCount);
				expect(decision.shouldRetry).toBe(false);
				expect(decision.delayMs).toBe(0);
			}
		});
	}
});

// ---------------------------------------------------------------------------
// INTEGRATION: retryable → retry with backoff
// ---------------------------------------------------------------------------

describe("INTEGRATION: retryable → retry with exponential backoff", () => {
	const retryable = ["timeout", "cli_error", "killed", "unknown"] as const;

	for (const classification of retryable) {
		it(`${classification}: retry allowed, backoff doubles each attempt`, () => {
			expect(getRetryDecision(classification)).toBe("retry");
			expect(isRetryable(classification)).toBe(true);

			const d0 = evaluateRetry(classification, 0);
			const d1 = evaluateRetry(classification, 1);
			const d2 = evaluateRetry(classification, 2);

			expect(d0.shouldRetry).toBe(true);
			expect(d1.shouldRetry).toBe(true);
			expect(d2.shouldRetry).toBe(true);

			expect(d1.delayMs).toBe(d0.delayMs * 2);
			expect(d2.delayMs).toBe(d1.delayMs * 2);
		});
	}

	it("backoff is capped at MAX_BACKOFF_MS", () => {
		const delay = computeBackoffMs(100);
		expect(delay).toBeLessThanOrEqual(60_000); // MAX_BACKOFF_MS default
	});
});

// ---------------------------------------------------------------------------
// INTEGRATION: severity → fallback order
// ---------------------------------------------------------------------------

describe("INTEGRATION: severity → fallback order", () => {
	it("tool_restriction_unsupported has highest severity", () => {
		expect(getFallbackSeverity("tool_restriction_unsupported")).toBe(100);
	});

	it("severity ordering is stable and monotonic", () => {
		const severities = [
			getFallbackSeverity("unknown"),
			getFallbackSeverity("cli_error"),
			getFallbackSeverity("timeout"),
			getFallbackSeverity("spawn_failure"),
			getFallbackSeverity("tool_restriction_unsupported"),
		];
		for (let i = 1; i < severities.length; i++) {
			expect(severities[i]).toBeGreaterThan(severities[i - 1]);
		}
	});
});

// ---------------------------------------------------------------------------
// INTEGRATION: composite pipeline
// ---------------------------------------------------------------------------

describe("INTEGRATION: composite retry + fallback + timeout pipeline", () => {
	beforeEach(() => {
		vi.mocked(providerState.isAvailable).mockReset().mockReturnValue(true);
		vi.mocked(providerRuntimeCache.resolveCapability).mockReset();
	});

	it("full cycle: timeout → retry → success (no fallback needed)", () => {
		// Step 1: Task fails with timeout on first attempt
		const retryDecision = evaluateRetry("timeout", 0);
		expect(retryDecision.shouldRetry).toBe(true);
		expect(retryDecision.delayMs).toBe(BASE_BACKOFF_MS);

		// Step 2: Retry succeeds (mocked)
		// In real execution, the same provider would be retried
		// No fallback needed because timeout is retryable
	});

	it("full cycle: unavailable → fallback → skip unhealthy provider", async () => {
		// Step 1: Task fails with unavailable
		const retryDecision = evaluateRetry("unavailable", 0);
		expect(retryDecision.shouldRetry).toBe(false);

		// Step 2: Next dispatch skips unavailable provider
		const adapter = makeAdapter("claude-code");
		vi.mocked(providerState.isAvailable).mockReturnValue(false);
		const skip = await shouldSkipProvider(adapter, {});
		expect(skip.shouldSkip).toBe(true);
	});

	it("full cycle: spawn_failure → fallback → sort deprioritizes failing provider", () => {
		// Step 1: spawn_failure is non-retryable
		expect(evaluateRetry("spawn_failure", 0).shouldRetry).toBe(false);

		// Step 2: Fallback chain deprioritizes the failing provider
		const adapters = [makeAdapter("claude-code"), makeAdapter("codex")];
		vi.mocked(providerState.isAvailable).mockImplementation((name: string) => name === "codex");
		const sorted = sortAdapterChain(adapters, (id) => ({
			successRate: id === "claude-code" ? 0.3 : 0.9,
			avgLatencyMs: 1000,
		}));
		expect(sorted[0]!.name).toBe("codex"); // available + better success rate
	});
});
