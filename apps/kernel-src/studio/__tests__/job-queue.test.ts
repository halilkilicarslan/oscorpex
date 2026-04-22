// ---------------------------------------------------------------------------
// Oscorpex — Job Queue Tests (V6 M4)
// Tests for JobQueue class and job-repo DB layer.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock pg.js — raw DB access
// ---------------------------------------------------------------------------

vi.mock("../pg.js", () => ({
	execute: vi.fn(),
	query: vi.fn(),
	queryOne: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock job-repo — all DB operations
// ---------------------------------------------------------------------------

vi.mock("../db/job-repo.js", () => ({
	insertJob: vi.fn(),
	claimJobs: vi.fn(),
	updateJobStatus: vi.fn(),
	incrementRetryCount: vi.fn(),
	listJobs: vi.fn(),
	getJobStats: vi.fn(),
	cleanupCompletedJobs: vi.fn(),
	resetStaleJobs: vi.fn(),
}));

import {
	claimJobs,
	cleanupCompletedJobs,
	getJobStats,
	incrementRetryCount,
	insertJob,
	listJobs,
	resetStaleJobs,
	updateJobStatus,
} from "../db/job-repo.js";
import { JobQueue, jobQueue } from "../job-queue.js";
import { execute, query, queryOne } from "../pg.js";

// ---------------------------------------------------------------------------
// Typed mocks
// ---------------------------------------------------------------------------

const mockExecute = vi.mocked(execute);
const mockQuery = vi.mocked(query);
const mockInsertJob = vi.mocked(insertJob);
const mockClaimJobs = vi.mocked(claimJobs);
const mockUpdateJobStatus = vi.mocked(updateJobStatus);
const mockIncrementRetryCount = vi.mocked(incrementRetryCount);
const mockListJobs = vi.mocked(listJobs);
const mockGetJobStats = vi.mocked(getJobStats);
const mockCleanupCompletedJobs = vi.mocked(cleanupCompletedJobs);
const mockResetStaleJobs = vi.mocked(resetStaleJobs);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeJob = (overrides: Record<string, unknown> = {}) => ({
	id: "job-1",
	queue: "task-execution",
	data: { taskId: "t-1", projectId: "p-1" },
	status: "created" as const,
	output: null,
	error: null,
	retryCount: 0,
	maxRetries: 3,
	startedAt: null,
	completedAt: null,
	createdAt: "2026-04-20T00:00:00.000Z",
	updatedAt: "2026-04-20T00:00:00.000Z",
	...overrides,
});

beforeEach(() => {
	vi.clearAllMocks();
	mockExecute.mockResolvedValue(undefined as never);
	mockClaimJobs.mockResolvedValue([]);
	mockListJobs.mockResolvedValue([]);
	mockGetJobStats.mockResolvedValue({ created: 0, active: 0, completed: 0, failed: 0, retry: 0 });
	mockCleanupCompletedJobs.mockResolvedValue(0);
	mockResetStaleJobs.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// init()
// ---------------------------------------------------------------------------

describe("JobQueue.init()", () => {
	it("creates the jobs table via execute()", async () => {
		const q = new JobQueue();
		await q.init();
		expect(mockExecute).toHaveBeenCalledOnce();
		const sql = mockExecute.mock.calls[0][0] as string;
		expect(sql).toContain("CREATE TABLE IF NOT EXISTS jobs");
		expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_jobs_queue_status");
		expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_jobs_status");
	});

	it("is idempotent — IF NOT EXISTS guards prevent errors on second call", async () => {
		const q = new JobQueue();
		await q.init();
		await q.init();
		expect(mockExecute).toHaveBeenCalledTimes(2);
	});
});

// ---------------------------------------------------------------------------
// enqueue()
// ---------------------------------------------------------------------------

describe("JobQueue.enqueue()", () => {
	it("calls insertJob with correct queue and data", async () => {
		const job = makeJob();
		mockInsertJob.mockResolvedValueOnce(job);
		const q = new JobQueue();
		const result = await q.enqueue("task-execution", { taskId: "t-1" });
		expect(mockInsertJob).toHaveBeenCalledWith({
			queue: "task-execution",
			data: { taskId: "t-1" },
			maxRetries: undefined,
		});
		expect(result.id).toBe("job-1");
		expect(result.queue).toBe("task-execution");
	});

	it("forwards maxRetries option to insertJob", async () => {
		const job = makeJob({ maxRetries: 5 });
		mockInsertJob.mockResolvedValueOnce(job);
		const q = new JobQueue();
		await q.enqueue("custom-queue", {}, { maxRetries: 5 });
		expect(mockInsertJob).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 5 }));
	});
});

// ---------------------------------------------------------------------------
// dequeue()
// ---------------------------------------------------------------------------

describe("JobQueue.dequeue()", () => {
	it("returns empty array when no jobs available", async () => {
		mockClaimJobs.mockResolvedValueOnce([]);
		const q = new JobQueue();
		const jobs = await q.dequeue("task-execution");
		expect(jobs).toHaveLength(0);
	});

	it("returns claimed jobs on success", async () => {
		const job = makeJob({ status: "active" });
		mockClaimJobs.mockResolvedValueOnce([job]);
		const q = new JobQueue();
		const jobs = await q.dequeue("task-execution");
		expect(jobs).toHaveLength(1);
		expect(jobs[0].status).toBe("active");
	});

	it("passes batchSize to claimJobs", async () => {
		mockClaimJobs.mockResolvedValueOnce([]);
		const q = new JobQueue();
		await q.dequeue("task-execution", 5);
		expect(mockClaimJobs).toHaveBeenCalledWith("task-execution", 5);
	});
});

// ---------------------------------------------------------------------------
// complete()
// ---------------------------------------------------------------------------

describe("JobQueue.complete()", () => {
	it("calls updateJobStatus with completed status", async () => {
		const job = makeJob({ status: "completed" });
		mockUpdateJobStatus.mockResolvedValueOnce(job);
		const q = new JobQueue();
		const result = await q.complete("job-1", { result: "ok" });
		expect(mockUpdateJobStatus).toHaveBeenCalledWith("job-1", "completed", { output: { result: "ok" } });
		expect(result?.status).toBe("completed");
	});

	it("returns null when job not found", async () => {
		mockUpdateJobStatus.mockResolvedValueOnce(null);
		const q = new JobQueue();
		const result = await q.complete("nonexistent");
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// fail()
// ---------------------------------------------------------------------------

describe("JobQueue.fail()", () => {
	it("calls updateJobStatus with failed status and error message", async () => {
		const job = makeJob({ status: "failed", error: "CLI crash" });
		mockUpdateJobStatus.mockResolvedValueOnce(job);
		const q = new JobQueue();
		const result = await q.fail("job-1", "CLI crash");
		expect(mockUpdateJobStatus).toHaveBeenCalledWith("job-1", "failed", { error: "CLI crash" });
		expect(result?.error).toBe("CLI crash");
	});
});

// ---------------------------------------------------------------------------
// retry()
// ---------------------------------------------------------------------------

describe("JobQueue.retry()", () => {
	it("increments retry_count and sets status to retry when under max", async () => {
		// Mock the dynamic import of pg.js inside retry()
		const job = makeJob({ status: "failed", retryCount: 0, maxRetries: 3 });
		mockQuery.mockResolvedValueOnce([
			{
				id: "job-1",
				queue: "task-execution",
				data: {},
				status: "failed",
				output: null,
				error: "oops",
				retry_count: 0,
				max_retries: 3,
				started_at: null,
				completed_at: null,
				created_at: "2026-04-20T00:00:00.000Z",
				updated_at: "2026-04-20T00:00:00.000Z",
			},
		] as unknown as Record<string, unknown>[]);
		const retried = makeJob({ status: "retry", retryCount: 1 });
		mockIncrementRetryCount.mockResolvedValueOnce(retried);

		const q = new JobQueue();
		const result = await q.retry("job-1");
		expect(mockIncrementRetryCount).toHaveBeenCalledWith("job-1");
		expect(result?.status).toBe("retry");
		expect(result?.retryCount).toBe(1);
	});

	it("marks job as permanently failed when max retries exceeded", async () => {
		mockQuery.mockResolvedValueOnce([
			{
				id: "job-1",
				queue: "task-execution",
				data: {},
				status: "failed",
				output: null,
				error: "oops",
				retry_count: 3,
				max_retries: 3,
				started_at: null,
				completed_at: null,
				created_at: "2026-04-20T00:00:00.000Z",
				updated_at: "2026-04-20T00:00:00.000Z",
			},
		] as unknown as Record<string, unknown>[]);
		const failed = makeJob({ status: "failed", retryCount: 3 });
		mockUpdateJobStatus.mockResolvedValueOnce(failed);

		const q = new JobQueue();
		const result = await q.retry("job-1");
		expect(mockIncrementRetryCount).not.toHaveBeenCalled();
		expect(mockUpdateJobStatus).toHaveBeenCalledWith(
			"job-1",
			"failed",
			expect.objectContaining({ error: expect.stringContaining("Max retries") }),
		);
	});

	it("returns null when job does not exist", async () => {
		mockQuery.mockResolvedValueOnce([] as unknown as Record<string, unknown>[][]);
		const q = new JobQueue();
		const result = await q.retry("nonexistent");
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// getActiveJobs() / getFailedJobs()
// ---------------------------------------------------------------------------

describe("JobQueue.getActiveJobs() / getFailedJobs()", () => {
	it("getActiveJobs filters by status=active", async () => {
		const job = makeJob({ status: "active" });
		mockListJobs.mockResolvedValueOnce([job]);
		const q = new JobQueue();
		const result = await q.getActiveJobs();
		expect(mockListJobs).toHaveBeenCalledWith({ status: "active", queue: undefined });
		expect(result[0].status).toBe("active");
	});

	it("getActiveJobs accepts optional queue filter", async () => {
		mockListJobs.mockResolvedValueOnce([]);
		const q = new JobQueue();
		await q.getActiveJobs("my-queue");
		expect(mockListJobs).toHaveBeenCalledWith({ status: "active", queue: "my-queue" });
	});

	it("getFailedJobs filters by status=failed", async () => {
		mockListJobs.mockResolvedValueOnce([]);
		const q = new JobQueue();
		await q.getFailedJobs();
		expect(mockListJobs).toHaveBeenCalledWith({ status: "failed", queue: undefined });
	});
});

// ---------------------------------------------------------------------------
// getStats()
// ---------------------------------------------------------------------------

describe("JobQueue.getStats()", () => {
	it("returns counts per status", async () => {
		mockGetJobStats.mockResolvedValueOnce({ created: 2, active: 1, completed: 10, failed: 0, retry: 1 });
		const q = new JobQueue();
		const stats = await q.getStats();
		expect(stats.created).toBe(2);
		expect(stats.active).toBe(1);
		expect(stats.completed).toBe(10);
	});

	it("passes queue name to getJobStats", async () => {
		mockGetJobStats.mockResolvedValueOnce({ created: 0, active: 0, completed: 0, failed: 0, retry: 0 });
		const q = new JobQueue();
		await q.getStats("task-execution");
		expect(mockGetJobStats).toHaveBeenCalledWith("task-execution");
	});
});

// ---------------------------------------------------------------------------
// recoverStaleJobs()
// ---------------------------------------------------------------------------

describe("JobQueue.recoverStaleJobs()", () => {
	it("resets stuck active jobs to created", async () => {
		const stale = makeJob({ status: "created", startedAt: null });
		mockResetStaleJobs.mockResolvedValueOnce([stale]);
		const q = new JobQueue();
		const recovered = await q.recoverStaleJobs();
		expect(mockResetStaleJobs).toHaveBeenCalledWith(10 * 60 * 1000);
		expect(recovered).toHaveLength(1);
	});

	it("accepts custom stale threshold", async () => {
		mockResetStaleJobs.mockResolvedValueOnce([]);
		const q = new JobQueue();
		await q.recoverStaleJobs(5 * 60 * 1000);
		expect(mockResetStaleJobs).toHaveBeenCalledWith(5 * 60 * 1000);
	});

	it("returns empty array when no stale jobs", async () => {
		mockResetStaleJobs.mockResolvedValueOnce([]);
		const q = new JobQueue();
		const result = await q.recoverStaleJobs();
		expect(result).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// cleanup()
// ---------------------------------------------------------------------------

describe("JobQueue.cleanup()", () => {
	it("delegates to cleanupCompletedJobs", async () => {
		mockCleanupCompletedJobs.mockResolvedValueOnce(7);
		const q = new JobQueue();
		const count = await q.cleanup();
		expect(mockCleanupCompletedJobs).toHaveBeenCalledOnce();
		expect(count).toBe(7);
	});

	it("passes custom threshold in ms", async () => {
		mockCleanupCompletedJobs.mockResolvedValueOnce(3);
		const q = new JobQueue();
		const threshold = 2 * 60 * 60 * 1000;
		await q.cleanup(threshold);
		expect(mockCleanupCompletedJobs).toHaveBeenCalledWith(threshold);
	});
});

// ---------------------------------------------------------------------------
// startWorker() / stopWorker()
// ---------------------------------------------------------------------------

describe("JobQueue.startWorker() / stopWorker()", () => {
	it("starts polling and processes available jobs", async () => {
		vi.useFakeTimers();
		const job = makeJob({ status: "active" });
		const handler = vi.fn().mockResolvedValue({ done: true });
		const completed = makeJob({ status: "completed" });

		mockClaimJobs.mockResolvedValueOnce([job]).mockResolvedValue([]);
		mockUpdateJobStatus.mockResolvedValue(completed);

		const q = new JobQueue();
		q.startWorker("task-execution", handler, { pollIntervalMs: 1000, concurrency: 1 });

		// Advance only enough to let the initial poll + handler complete
		await vi.advanceTimersByTimeAsync(100);
		q.stopWorker();
		vi.useRealTimers();

		expect(handler).toHaveBeenCalledWith(job.data, job);
		expect(mockUpdateJobStatus).toHaveBeenCalledWith(job.id, "completed", { output: { done: true } });
	});

	it("retries job on handler error when under max retries", async () => {
		vi.useFakeTimers();
		const job = makeJob({ status: "active", retryCount: 0, maxRetries: 3 });
		const handler = vi.fn().mockRejectedValueOnce(new Error("transient error"));
		mockClaimJobs.mockResolvedValueOnce([job]).mockResolvedValue([]);
		mockIncrementRetryCount.mockResolvedValue(makeJob({ status: "retry", retryCount: 1 }));

		const q = new JobQueue();
		q.startWorker("task-execution", handler, { pollIntervalMs: 1000 });
		await vi.advanceTimersByTimeAsync(100);
		q.stopWorker();
		vi.useRealTimers();

		expect(mockIncrementRetryCount).toHaveBeenCalledWith(job.id);
		expect(mockUpdateJobStatus).not.toHaveBeenCalledWith(job.id, "failed", expect.anything());
	});

	it("permanently fails job when handler error exceeds max retries", async () => {
		vi.useFakeTimers();
		const job = makeJob({ status: "active", retryCount: 3, maxRetries: 3 });
		const handler = vi.fn().mockRejectedValueOnce(new Error("permanent failure"));
		mockClaimJobs.mockResolvedValueOnce([job]).mockResolvedValue([]);
		mockUpdateJobStatus.mockResolvedValue(makeJob({ status: "failed" }));

		const q = new JobQueue();
		q.startWorker("task-execution", handler, { pollIntervalMs: 1000 });
		await vi.advanceTimersByTimeAsync(100);
		q.stopWorker();
		vi.useRealTimers();

		expect(mockUpdateJobStatus).toHaveBeenCalledWith(
			job.id,
			"failed",
			expect.objectContaining({ error: "permanent failure" }),
		);
	});

	it("does not start a second worker if already running", async () => {
		vi.useFakeTimers();
		mockClaimJobs.mockResolvedValue([]);
		const q = new JobQueue();
		const handler = vi.fn().mockResolvedValue(undefined);

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		q.startWorker("task-execution", handler, { pollIntervalMs: 5000 });
		q.startWorker("task-execution", handler, { pollIntervalMs: 5000 });

		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("already running"));

		q.stopWorker();
		vi.useRealTimers();
		warnSpy.mockRestore();
	});

	it("stopWorker clears the polling interval", async () => {
		vi.useFakeTimers();
		mockClaimJobs.mockResolvedValue([]);
		const q = new JobQueue();
		const handler = vi.fn().mockResolvedValue(undefined);
		q.startWorker("task-execution", handler, { pollIntervalMs: 1000 });

		// Initial async poll call will fire once (the immediate poll)
		const callsAfterStart = mockClaimJobs.mock.calls.length;
		q.stopWorker();

		// After stop, advancing time should not trigger more polls
		await vi.advanceTimersByTimeAsync(5000);
		expect(mockClaimJobs.mock.calls.length).toBe(callsAfterStart);

		vi.useRealTimers();
	});
});

// ---------------------------------------------------------------------------
// Full lifecycle: enqueue → dequeue → complete
// ---------------------------------------------------------------------------

describe("Full job lifecycle", () => {
	it("enqueue → dequeue → complete", async () => {
		const created = makeJob();
		const active = makeJob({ status: "active", startedAt: "2026-04-20T00:01:00.000Z" });
		const completed = makeJob({
			status: "completed",
			completedAt: "2026-04-20T00:02:00.000Z",
			output: { result: "done" },
		});

		mockInsertJob.mockResolvedValueOnce(created);
		mockClaimJobs.mockResolvedValueOnce([active]);
		mockUpdateJobStatus.mockResolvedValueOnce(completed);

		const q = new JobQueue();
		const enqueued = await q.enqueue("task-execution", { taskId: "t-1" });
		expect(enqueued.status).toBe("created");

		const [dequeued] = await q.dequeue("task-execution");
		expect(dequeued.status).toBe("active");

		const done = await q.complete(dequeued.id, { result: "done" });
		expect(done?.status).toBe("completed");
		expect(done?.output).toEqual({ result: "done" });
	});

	it("enqueue → dequeue → fail", async () => {
		const created = makeJob();
		const active = makeJob({ status: "active" });
		const failed = makeJob({ status: "failed", error: "agent crashed" });

		mockInsertJob.mockResolvedValueOnce(created);
		mockClaimJobs.mockResolvedValueOnce([active]);
		mockUpdateJobStatus.mockResolvedValueOnce(failed);

		const q = new JobQueue();
		await q.enqueue("task-execution", { taskId: "t-1" });
		const [dequeued] = await q.dequeue("task-execution");
		const result = await q.fail(dequeued.id, "agent crashed");
		expect(result?.status).toBe("failed");
		expect(result?.error).toBe("agent crashed");
	});
});

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

describe("jobQueue singleton", () => {
	it("is exported as a pre-created JobQueue instance", () => {
		expect(jobQueue).toBeInstanceOf(JobQueue);
	});
});

// ---------------------------------------------------------------------------
// Batch dequeue
// ---------------------------------------------------------------------------

describe("Batch dequeue", () => {
	it("claims multiple jobs atomically", async () => {
		const jobs = [makeJob({ id: "j-1" }), makeJob({ id: "j-2" }), makeJob({ id: "j-3" })];
		mockClaimJobs.mockResolvedValueOnce(jobs);
		const q = new JobQueue();
		const result = await q.dequeue("task-execution", 3);
		expect(result).toHaveLength(3);
		expect(mockClaimJobs).toHaveBeenCalledWith("task-execution", 3);
	});
});
