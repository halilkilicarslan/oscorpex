// ---------------------------------------------------------------------------
// Performance Regression Tests (TASK 14)
// ---------------------------------------------------------------------------
// These tests exercise the integrated scheduling, concurrency, fallback,
// and retry subsystems to ensure performance invariants hold and do not
// regress across refactors.
//
// Invariants verified:
// 1. Short tasks are never starved by long tasks (fairness)
// 2. Non-retryable errors do not trigger retry storms
// 3. Fallback chain respects provider health and cooldown
// 4. Adaptive concurrency responds to failure rate within bounded time
// 5. Queue wait time for short tasks stays within acceptable bounds
// 6. Throughput does not collapse under moderate concurrent load
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdaptiveConcurrencyController, AdaptiveSemaphore, ConcurrencyTracker } from "../adaptive-concurrency.js";
import { getFallbackSeverity, shouldSkipProvider, sortAdapterChain } from "../fallback-decision.js";
import { providerRuntimeCache } from "../provider-runtime-cache.js";
import { providerState } from "../provider-state.js";
import { MAX_AUTO_RETRIES, evaluateRetry, isRetryable } from "../retry-policy.js";
import { getTaskCategory, groupTasksByLane, sortTasksByFairness } from "../task-scheduler.js";
import type { Task } from "../types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "t-1",
		phaseId: "p-1",
		title: "Test task",
		description: "Do something",
		assignedAgent: "backend",
		status: "queued",
		complexity: "M",
		dependsOn: [],
		branch: "feat/x",
		retryCount: 0,
		revisionCount: 0,
		requiresApproval: false,
		createdAt: new Date().toISOString(),
		...overrides,
	} as Task;
}

function makeAdapter(name: string, caps?: Record<string, unknown>) {
	return {
		name,
		isAvailable: vi.fn().mockResolvedValue(true),
		capabilities: vi.fn().mockResolvedValue(
			caps ?? {
				supportedModels: ["model-1"],
				supportsToolRestriction: true,
				supportsStreaming: false,
				supportsResume: false,
				supportsCancel: true,
				supportsStructuredOutput: false,
				supportsSandboxHinting: true,
			},
		),
		execute: vi.fn(),
	};
}

// ---------------------------------------------------------------------------
// INVARIANT 1 — Scheduling Fairness Regression
// ---------------------------------------------------------------------------

describe("INVARIANT 1: Short tasks are never starved by long tasks", () => {
	it("short tasks appear before all long tasks in sorted order", () => {
		const tasks = [
			makeTask({ id: "long-1", complexity: "XL", createdAt: new Date(Date.now() - 10_000).toISOString() }),
			makeTask({ id: "long-2", complexity: "L", createdAt: new Date(Date.now() - 9000).toISOString() }),
			makeTask({ id: "short-1", complexity: "S", createdAt: new Date(Date.now() - 1000).toISOString() }),
			makeTask({ id: "med-1", complexity: "M", createdAt: new Date(Date.now() - 500).toISOString() }),
			makeTask({ id: "short-2", complexity: "S", createdAt: new Date(Date.now() - 200).toISOString() }),
		];

		const sorted = sortTasksByFairness(tasks);
		const shortIndex = sorted.findIndex((t) => t.id === "short-1");
		const longIndex = sorted.findIndex((t) => t.id === "long-1");

		expect(shortIndex).toBeLessThan(longIndex);
		expect(sorted[0]!.id).toBe("short-1");
		expect(sorted[1]!.id).toBe("short-2");
	});

	it("groupTasksByLane preserves short-first priority", () => {
		const tasks = [
			makeTask({ id: "long-1", complexity: "XL" }),
			makeTask({ id: "short-1", complexity: "S" }),
			makeTask({ id: "med-1", complexity: "M" }),
		];

		const lanes = groupTasksByLane(tasks);
		expect(lanes[0]!.category).toBe("short");
		expect(lanes[1]!.category).toBe("medium");
		expect(lanes[2]!.category).toBe("long");
	});

	it("even with 100 long tasks, short tasks still sort first", () => {
		const tasks: Task[] = [];
		for (let i = 0; i < 100; i++) {
			tasks.push(makeTask({ id: `long-${i}`, complexity: "XL", createdAt: new Date(Date.now() - i).toISOString() }));
		}
		tasks.push(makeTask({ id: "short-0", complexity: "S", createdAt: new Date().toISOString() }));

		const sorted = sortTasksByFairness(tasks);
		expect(sorted[0]!.id).toBe("short-0");
	});
});

// ---------------------------------------------------------------------------
// INVARIANT 2 — Retry Storm Prevention
// ---------------------------------------------------------------------------

describe("INVARIANT 2: Non-retryable errors do not trigger retry storms", () => {
	const nonRetryable = ["spawn_failure", "unavailable", "rate_limited", "tool_restriction_unsupported"];
	const retryable = ["timeout", "cli_error", "killed", "unknown"];

	for (const classification of nonRetryable) {
		it(`${classification} is not retryable`, () => {
			expect(isRetryable(classification as never)).toBe(false);
			const decision = evaluateRetry(classification as never, 0);
			expect(decision.shouldRetry).toBe(false);
			expect(decision.delayMs).toBe(0);
		});
	}

	for (const classification of retryable) {
		it(`${classification} is retryable up to ${MAX_AUTO_RETRIES} times`, () => {
			expect(isRetryable(classification as never)).toBe(true);
			for (let i = 0; i < MAX_AUTO_RETRIES; i++) {
				const decision = evaluateRetry(classification as never, i);
				expect(decision.shouldRetry).toBe(true);
			}
			const overLimit = evaluateRetry(classification as never, MAX_AUTO_RETRIES);
			expect(overLimit.shouldRetry).toBe(false);
		});
	}

	it("total retry attempts for mixed errors never exceed MAX_AUTO_RETRIES per task", () => {
		let attempts = 0;
		for (let retryCount = 0; retryCount <= MAX_AUTO_RETRIES + 5; retryCount++) {
			const decision = evaluateRetry("timeout", retryCount);
			if (decision.shouldRetry) attempts++;
		}
		expect(attempts).toBe(MAX_AUTO_RETRIES);
	});
});

// ---------------------------------------------------------------------------
// INVARIANT 3 — Fallback Chain Health Respect
// ---------------------------------------------------------------------------

describe("INVARIANT 3: Fallback chain respects provider health and cooldown", () => {
	beforeEach(() => {
		vi.mocked(providerState.isAvailable).mockReset().mockReturnValue(true);
		vi.mocked(providerRuntimeCache.resolveCapability).mockReset();
	});

	it("unavailable providers are deprioritized in chain", () => {
		const adapters = [makeAdapter("cursor"), makeAdapter("claude-code"), makeAdapter("codex")];
		vi.mocked(providerState.isAvailable).mockImplementation((name: string) => name !== "cursor");

		const sorted = sortAdapterChain(adapters, () => ({ successRate: 0.9, avgLatencyMs: 500 }));
		expect(sorted[sorted.length - 1]!.name).toBe("cursor");
	});

	it("shouldSkipProvider blocks cooldown providers", async () => {
		const adapter = makeAdapter("claude-code");
		vi.mocked(providerState.isAvailable).mockReturnValue(false);

		const result = await shouldSkipProvider(adapter, {});
		expect(result.shouldSkip).toBe(true);
		expect(result.reason).toBe("cooldown_active");
	});

	it("shouldSkipProvider blocks same-provider timeout retry", async () => {
		const adapter = makeAdapter("claude-code");
		const result = await shouldSkipProvider(adapter, {
			lastFailureProvider: "claude-code",
			lastFailureClassification: "timeout",
		});
		expect(result.shouldSkip).toBe(true);
		expect(result.reason).toBe("timeout_retry_avoided");
	});

	it("fallback severity ordering is stable", () => {
		const severities = [
			getFallbackSeverity("unknown"),
			getFallbackSeverity("timeout"),
			getFallbackSeverity("tool_restriction_unsupported"),
		];
		expect(severities[0]).toBeLessThan(severities[1]);
		expect(severities[1]).toBeLessThan(severities[2]);
	});
});

// ---------------------------------------------------------------------------
// INVARIANT 4 — Adaptive Concurrency Response Bounds
// ---------------------------------------------------------------------------

describe("INVARIANT 4: Adaptive concurrency responds to failure rate within bounded time", () => {
	it("reduces max concurrency within one adjustment window (30s) when failure rate > 50%", () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const sem = new AdaptiveSemaphore(6);
		const getFailureRate = vi.fn().mockReturnValue(0.75);
		const getQueueDepth = vi.fn().mockReturnValue(0);
		const controller = new AdaptiveConcurrencyController(sem, getFailureRate, getQueueDepth);
		controller.start();

		expect(sem.maxConcurrency).toBe(6);
		vi.advanceTimersByTime(31_000);
		expect(sem.maxConcurrency).toBeLessThan(6);

		controller.stop();
		vi.useRealTimers();
	});

	it("increases max concurrency within one adjustment window when queue deep and failure low", () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const sem = new AdaptiveSemaphore(2);
		const getFailureRate = vi.fn().mockReturnValue(0.05);
		const getQueueDepth = vi.fn().mockReturnValue(12);
		const controller = new AdaptiveConcurrencyController(sem, getFailureRate, getQueueDepth);
		controller.start();

		expect(sem.maxConcurrency).toBe(2);
		vi.advanceTimersByTime(31_000);
		expect(sem.maxConcurrency).toBeGreaterThan(2);

		controller.stop();
		vi.useRealTimers();
	});

	it("never reduces concurrency below absolute minimum", () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const sem = new AdaptiveSemaphore(2);
		const getFailureRate = vi.fn().mockReturnValue(1.0);
		const getQueueDepth = vi.fn().mockReturnValue(0);
		const controller = new AdaptiveConcurrencyController(sem, getFailureRate, getQueueDepth);
		controller.start();

		vi.advanceTimersByTime(120_000); // Multiple windows
		expect(sem.maxConcurrency).toBeGreaterThanOrEqual(1);

		controller.stop();
		vi.useRealTimers();
	});

	it("never increases concurrency above absolute maximum", () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const sem = new AdaptiveSemaphore(9);
		const getFailureRate = vi.fn().mockReturnValue(0.0);
		const getQueueDepth = vi.fn().mockReturnValue(50);
		const controller = new AdaptiveConcurrencyController(sem, getFailureRate, getQueueDepth);
		controller.start();

		vi.advanceTimersByTime(120_000);
		expect(sem.maxConcurrency).toBeLessThanOrEqual(10);

		controller.stop();
		vi.useRealTimers();
	});
});

// ---------------------------------------------------------------------------
// INVARIANT 5 — Queue Wait Time Bounds for Short Tasks
// ---------------------------------------------------------------------------

describe("INVARIANT 5: Queue wait time for short tasks stays within acceptable bounds", () => {
	it("fair scheduling ensures short tasks are in the first lane", () => {
		const tasks = [
			makeTask({ id: "xl-1", complexity: "XL" }),
			makeTask({ id: "s-1", complexity: "S" }),
			makeTask({ id: "l-1", complexity: "L" }),
			makeTask({ id: "s-2", complexity: "S" }),
		];

		const lanes = groupTasksByLane(tasks);
		const shortLane = lanes.find((l) => l.category === "short");
		expect(shortLane).toBeDefined();
		expect(shortLane!.tasks).toHaveLength(2);
	});

	it("getTaskCategory classifies all complexities without exception", () => {
		expect(() => getTaskCategory("S")).not.toThrow();
		expect(() => getTaskCategory("M")).not.toThrow();
		expect(() => getTaskCategory("L")).not.toThrow();
		expect(() => getTaskCategory("XL")).not.toThrow();
		expect(() => getTaskCategory(undefined)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// INVARIANT 6 — Throughput Does Not Collapse Under Moderate Load
// ---------------------------------------------------------------------------

describe("INVARIANT 6: Throughput does not collapse under moderate concurrent load", () => {
	it("ConcurrencyTracker allows at least 2 concurrent tasks per project", () => {
		const tracker = new ConcurrencyTracker();
		expect(tracker.canAcquire("proj-1", "claude-code")).toBe(true);
		tracker.acquire("proj-1", "claude-code");
		expect(tracker.canAcquire("proj-1", "codex")).toBe(true);
		tracker.acquire("proj-1", "codex");
		expect(tracker.canAcquire("proj-1", "cursor")).toBe(false);
	});

	it("ConcurrencyTracker allows different projects to run in parallel", () => {
		const tracker = new ConcurrencyTracker();
		tracker.acquire("proj-1", "claude-code");
		tracker.acquire("proj-2", "claude-code");
		expect(tracker.canAcquire("proj-3", "claude-code")).toBe(false); // provider cap = 2
	});

	it("AdaptiveSemaphore can sustain max concurrency without deadlock", async () => {
		const sem = new AdaptiveSemaphore(3);
		const acquired: number[] = [];

		const promises = Array.from({ length: 3 }, (_, i) =>
			sem.acquire().then(() => {
				acquired.push(i);
				sem.release();
			}),
		);

		await Promise.all(promises);
		expect(acquired).toHaveLength(3);
	});

	it("semaphore queue resolves all pending acquires when max increases", async () => {
		const sem = new AdaptiveSemaphore(1);
		await sem.acquire();

		const pending = [sem.acquire(), sem.acquire(), sem.acquire()];

		await new Promise((r) => setTimeout(r, 5));
		expect(sem.pendingCount).toBe(3);

		sem.maxConcurrency = 4;
		await new Promise((r) => setTimeout(r, 20));
		expect(sem.activeCount).toBe(4);

		for (let i = 0; i < 4; i++) sem.release();
		await Promise.all(pending);
	});

	it("sortAdapterChain is O(n log n) and handles 50 providers without timeout", () => {
		const adapters = Array.from({ length: 50 }, (_, i) => makeAdapter(`provider-${i}`));
		const start = performance.now();
		const sorted = sortAdapterChain(adapters, (id) => ({
			successRate: Math.random(),
			avgLatencyMs: Math.random() * 5000,
		}));
		const elapsed = performance.now() - start;

		expect(sorted).toHaveLength(50);
		expect(elapsed).toBeLessThan(100); // Should be nearly instantaneous
	});

	it("sortTasksByFairness is O(n log n) and handles 200 tasks without timeout", () => {
		const tasks = Array.from({ length: 200 }, (_, i) =>
			makeTask({
				id: `t-${i}`,
				complexity: ["S", "M", "L", "XL"][i % 4] as Task["complexity"],
				createdAt: new Date(Date.now() - i * 100).toISOString(),
			}),
		);
		const start = performance.now();
		const sorted = sortTasksByFairness(tasks);
		const elapsed = performance.now() - start;

		expect(sorted).toHaveLength(200);
		expect(elapsed).toBeLessThan(100);
	});
});

// ---------------------------------------------------------------------------
// INVARIANT 7 — Composite Pipeline Integration
// ---------------------------------------------------------------------------

describe("INVARIANT 7: Composite pipeline maintains end-to-end invariants", () => {
	beforeEach(() => {
		vi.mocked(providerState.isAvailable).mockReset().mockReturnValue(true);
		vi.mocked(providerRuntimeCache.resolveCapability).mockReset();
	});

	it("full pipeline: 20 tasks → fairness sort → retryable check → adapter sort → no violations", () => {
		// 1. Generate mixed task load
		const tasks = Array.from({ length: 20 }, (_, i) =>
			makeTask({
				id: `task-${i}`,
				complexity: ["S", "S", "M", "L", "XL"][i % 5] as Task["complexity"],
				retryCount: i % 3,
				createdAt: new Date(Date.now() - i * 200).toISOString(),
			}),
		);

		// 2. Fair scheduling
		const sorted = sortTasksByFairness(tasks);
		const lanes = groupTasksByLane(sorted);

		// 3. Invariant: short lane exists and is first
		expect(lanes[0]!.category).toBe("short");

		// 4. Simulate retry evaluation on a timeout task
		const retryDecision = evaluateRetry("timeout", 1);
		expect(retryDecision.shouldRetry).toBe(true);
		expect(retryDecision.delayMs).toBeGreaterThanOrEqual(0);

		// 5. Simulate fallback decision on a rate_limited error
		const fallbackDecision = evaluateRetry("rate_limited", 0);
		expect(fallbackDecision.shouldRetry).toBe(false);

		// 6. Adapter chain sorting with telemetry
		const adapters = [makeAdapter("codex"), makeAdapter("claude-code"), makeAdapter("cursor")];
		vi.mocked(providerState.isAvailable).mockImplementation((name: string) => name !== "cursor");
		const chain = sortAdapterChain(adapters, (id) => {
			if (id === "claude-code") return { successRate: 0.95, avgLatencyMs: 2000 };
			if (id === "codex") return { successRate: 0.7, avgLatencyMs: 4000 };
			return { successRate: 0.5, avgLatencyMs: 6000 };
		});

		expect(chain[0]!.name).toBe("claude-code");
		expect(chain[chain.length - 1]!.name).toBe("cursor");

		// 7. Concurrency tracking
		const tracker = new ConcurrencyTracker();
		expect(tracker.canAcquire("proj-1", chain[0]!.name)).toBe(true);
	});
});
