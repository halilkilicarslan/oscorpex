// ---------------------------------------------------------------------------
// Tests — Adaptive Concurrency (TASK 8)
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	AdaptiveSemaphore,
	ConcurrencyTracker,
	AdaptiveConcurrencyController,
	DEFAULT_MAX,
	MIN_MAX,
	ABSOLUTE_MAX,
} from "../adaptive-concurrency.js";

describe("AdaptiveSemaphore", () => {
	it("starts with default max concurrency", () => {
		const sem = new AdaptiveSemaphore();
		expect(sem.maxConcurrency).toBe(DEFAULT_MAX);
	});

	it("allows acquire up to max", async () => {
		const sem = new AdaptiveSemaphore(2);
		await sem.acquire();
		await sem.acquire();
		expect(sem.activeCount).toBe(2);
	});

	it("queues acquire beyond max", async () => {
		const sem = new AdaptiveSemaphore(1);
		await sem.acquire();
		let resolved = false;
		sem.acquire().then(() => {
			resolved = true;
		});
		await new Promise((r) => setTimeout(r, 10));
		expect(resolved).toBe(false);
		sem.release();
		await new Promise((r) => setTimeout(r, 10));
		expect(resolved).toBe(true);
	});

	it("increases max and wakes queued acquirers", async () => {
		const sem = new AdaptiveSemaphore(1);
		await sem.acquire();
		let resolved = false;
		sem.acquire().then(() => {
			resolved = true;
		});
		sem.maxConcurrency = 2;
		await new Promise((r) => setTimeout(r, 10));
		expect(resolved).toBe(true);
		expect(sem.activeCount).toBe(2);
	});

	it("clamps max to ABSOLUTE_MAX", () => {
		const sem = new AdaptiveSemaphore();
		sem.maxConcurrency = 100;
		expect(sem.maxConcurrency).toBe(ABSOLUTE_MAX);
	});

	it("clamps max to MIN_MAX", () => {
		const sem = new AdaptiveSemaphore();
		sem.maxConcurrency = 0;
		expect(sem.maxConcurrency).toBe(MIN_MAX);
	});
});

describe("ConcurrencyTracker", () => {
	let tracker: ConcurrencyTracker;

	beforeEach(() => {
		tracker = new ConcurrencyTracker();
	});

	it("allows acquire when under caps", () => {
		expect(tracker.canAcquire("p1", "claude-code")).toBe(true);
	});

	it("blocks acquire when project cap reached", () => {
		tracker.acquire("p1", "claude-code");
		tracker.acquire("p1", "cursor");
		expect(tracker.canAcquire("p1", "codex")).toBe(false);
	});

	it("blocks acquire when provider cap reached", () => {
		tracker.acquire("p1", "claude-code");
		tracker.acquire("p2", "claude-code");
		expect(tracker.canAcquire("p3", "claude-code")).toBe(false);
	});

	it("releases capacity", () => {
		tracker.acquire("p1", "claude-code");
		tracker.acquire("p1", "cursor");
		expect(tracker.canAcquire("p1", "codex")).toBe(false);
		tracker.release("p1", "cursor");
		expect(tracker.canAcquire("p1", "codex")).toBe(true);
	});

	it("never goes negative on release", () => {
		tracker.release("p1", "claude-code");
		expect(tracker.canAcquire("p1", "claude-code")).toBe(true);
	});
});

describe("AdaptiveConcurrencyController", () => {
	it("reduces max when failure rate is high", () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const sem = new AdaptiveSemaphore(4);
		const getFailureRate = vi.fn().mockReturnValue(0.8);
		const getQueueDepth = vi.fn().mockReturnValue(0);
		const controller = new AdaptiveConcurrencyController(sem, getFailureRate, getQueueDepth);
		controller.start();

		vi.advanceTimersByTime(35_000);
		expect(sem.maxConcurrency).toBeLessThan(4);

		controller.stop();
		vi.useRealTimers();
	});

	it("increases max when queue is deep and failure rate is low", () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const sem = new AdaptiveSemaphore(2);
		const getFailureRate = vi.fn().mockReturnValue(0.05);
		const getQueueDepth = vi.fn().mockReturnValue(10);
		const controller = new AdaptiveConcurrencyController(sem, getFailureRate, getQueueDepth);
		controller.start();

		vi.advanceTimersByTime(35_000);
		expect(sem.maxConcurrency).toBeGreaterThan(2);

		controller.stop();
		vi.useRealTimers();
	});

	it("does not change max when conditions are neutral", () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const sem = new AdaptiveSemaphore(3);
		const getFailureRate = vi.fn().mockReturnValue(0.2);
		const getQueueDepth = vi.fn().mockReturnValue(2);
		const controller = new AdaptiveConcurrencyController(sem, getFailureRate, getQueueDepth);
		controller.start();

		vi.advanceTimersByTime(35_000);
		expect(sem.maxConcurrency).toBe(3);

		controller.stop();
		vi.useRealTimers();
	});

	it("getRuntimeState returns current decision inputs and outputs", () => {
		const sem = new AdaptiveSemaphore(4);
		const getFailureRate = vi.fn().mockReturnValue(0.6);
		const getQueueDepth = vi.fn().mockReturnValue(10);
		const controller = new AdaptiveConcurrencyController(sem, getFailureRate, getQueueDepth);
		controller.start();

		const state = controller.getRuntimeState();
		expect(state.currentMax).toBe(4);
		expect(state.activeCount).toBe(0);
		expect(state.pendingCount).toBe(0);
		expect(state.lastFailureRate).toBe(0.6);
		expect(state.lastQueueDepth).toBe(10);
		expect(state.failureRateThreshold).toBe(0.5);
		expect(state.queueDepthThreshold).toBe(5);
		expect(state.adjustmentIntervalMs).toBe(30_000);

		controller.stop();
	});
});
