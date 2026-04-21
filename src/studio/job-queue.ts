// ---------------------------------------------------------------------------
// Oscorpex — Job Queue (V6 M4)
// Lightweight durable job queue backed by PostgreSQL.
// Uses SELECT FOR UPDATE SKIP LOCKED for crash-safe job claiming.
// No external pg-boss dependency — raw SQL only.
//
// @reserved — This module is reserved for v8.0 Phase 3 (Sprint 6+).
// Planned integration: async task injection dispatch via durable queue.
// Do not delete — schema and implementation are complete and tested.
// ---------------------------------------------------------------------------

import {
	type InsertJobData,
	type Job,
	type JobStatus,
	type ListJobsOpts,
	claimJobs,
	cleanupCompletedJobs,
	getJobStats,
	incrementRetryCount,
	insertJob,
	listJobs,
	resetStaleJobs,
	updateJobStatus,
} from "./db/job-repo.js";
import { execute } from "./pg.js";

export type { Job, JobStatus };

// ---------------------------------------------------------------------------
// Worker options
// ---------------------------------------------------------------------------

export interface WorkerOpts {
	/** Polling interval in ms. Default: 2000 */
	pollIntervalMs?: number;
	/** Max concurrent jobs processed by this worker. Default: 3 */
	concurrency?: number;
	/** Batch size per poll cycle. Default: same as concurrency */
	batchSize?: number;
}

// ---------------------------------------------------------------------------
// EnqueueOpts
// ---------------------------------------------------------------------------

export interface EnqueueOpts {
	maxRetries?: number;
}

// ---------------------------------------------------------------------------
// JobHandler — async function that processes a job's data
// ---------------------------------------------------------------------------

export type JobHandler = (data: Record<string, unknown>, job: Job) => Promise<Record<string, unknown> | undefined>;

// ---------------------------------------------------------------------------
// JobQueue class
// ---------------------------------------------------------------------------

export class JobQueue {
	private _workerTimer: ReturnType<typeof setInterval> | null = null;
	private _activeWorkerJobs = new Set<string>();
	private _stopping = false;

	// ---------------------------------------------------------------------------
	// init — ensure jobs table exists (idempotent, called on startup)
	// ---------------------------------------------------------------------------

	async init(): Promise<void> {
		await execute(`
			CREATE TABLE IF NOT EXISTS jobs (
			  id          TEXT PRIMARY KEY,
			  queue       TEXT NOT NULL DEFAULT 'task-execution',
			  data        JSONB NOT NULL DEFAULT '{}',
			  status      TEXT NOT NULL DEFAULT 'created',
			  output      JSONB,
			  error       TEXT,
			  retry_count INTEGER DEFAULT 0,
			  max_retries INTEGER DEFAULT 3,
			  started_at  TIMESTAMPTZ,
			  completed_at TIMESTAMPTZ,
			  created_at  TIMESTAMPTZ DEFAULT now(),
			  updated_at  TIMESTAMPTZ DEFAULT now()
			);
			CREATE INDEX IF NOT EXISTS idx_jobs_queue_status ON jobs(queue, status);
			CREATE INDEX IF NOT EXISTS idx_jobs_status       ON jobs(status);
			CREATE INDEX IF NOT EXISTS idx_jobs_created      ON jobs(created_at);
		`);
	}

	// ---------------------------------------------------------------------------
	// enqueue — add a new job to the queue
	// ---------------------------------------------------------------------------

	async enqueue(queueName: string, data: Record<string, unknown>, opts?: EnqueueOpts): Promise<Job> {
		return insertJob({ queue: queueName, data, maxRetries: opts?.maxRetries });
	}

	// ---------------------------------------------------------------------------
	// dequeue — claim next available jobs (SKIP LOCKED, crash-safe)
	// ---------------------------------------------------------------------------

	async dequeue(queueName: string, batchSize = 1): Promise<Job[]> {
		return claimJobs(queueName, batchSize);
	}

	// ---------------------------------------------------------------------------
	// complete — mark a job as successfully completed
	// ---------------------------------------------------------------------------

	async complete(jobId: string, output?: Record<string, unknown>): Promise<Job | null> {
		return updateJobStatus(jobId, "completed", { output });
	}

	// ---------------------------------------------------------------------------
	// fail — mark a job as permanently failed
	// ---------------------------------------------------------------------------

	async fail(jobId: string, error: string): Promise<Job | null> {
		return updateJobStatus(jobId, "failed", { error });
	}

	// ---------------------------------------------------------------------------
	// retry — re-enqueue a failed/active job for retry
	// Respects max_retries: if exceeded, marks as 'failed' instead.
	// ---------------------------------------------------------------------------

	async retry(jobId: string): Promise<Job | null> {
		const jobs = await listJobs({ limit: 1 });
		// Fetch the specific job via listJobs filtered by id workaround: use direct query
		const { query } = await import("./pg.js");
		const rows = await query<Record<string, unknown>>("SELECT * FROM jobs WHERE id = $1", [jobId]);
		if (rows.length === 0) return null;

		const job = rows[0];
		const retryCount = (job.retry_count as number) ?? 0;
		const maxRetries = (job.max_retries as number) ?? 3;

		if (retryCount >= maxRetries) {
			return updateJobStatus(jobId, "failed", { error: `Max retries (${maxRetries}) exceeded` });
		}

		return incrementRetryCount(jobId);
	}

	// ---------------------------------------------------------------------------
	// getActiveJobs — list currently active (claimed) jobs
	// ---------------------------------------------------------------------------

	async getActiveJobs(queueName?: string): Promise<Job[]> {
		return listJobs({ status: "active", queue: queueName });
	}

	// ---------------------------------------------------------------------------
	// getFailedJobs — list permanently failed jobs
	// ---------------------------------------------------------------------------

	async getFailedJobs(queueName?: string): Promise<Job[]> {
		return listJobs({ status: "failed", queue: queueName });
	}

	// ---------------------------------------------------------------------------
	// listAll — list jobs with flexible filters (for admin routes)
	// ---------------------------------------------------------------------------

	async listAll(opts?: ListJobsOpts): Promise<Job[]> {
		return listJobs(opts);
	}

	// ---------------------------------------------------------------------------
	// getStats — queue statistics (counts per status)
	// ---------------------------------------------------------------------------

	async getStats(queueName?: string): Promise<Record<string, number>> {
		return getJobStats(queueName);
	}

	// ---------------------------------------------------------------------------
	// recoverStaleJobs — reset active jobs that have been stuck beyond threshold
	// Intended to be called on process startup for crash recovery.
	// ---------------------------------------------------------------------------

	async recoverStaleJobs(staleDurationMs = 10 * 60 * 1000): Promise<Job[]> {
		return resetStaleJobs(staleDurationMs);
	}

	// ---------------------------------------------------------------------------
	// cleanup — delete completed jobs older than threshold
	// ---------------------------------------------------------------------------

	async cleanup(olderThanMs?: number): Promise<number> {
		return cleanupCompletedJobs(olderThanMs);
	}

	// ---------------------------------------------------------------------------
	// startWorker — begin polling loop that dequeues and processes jobs
	// ---------------------------------------------------------------------------

	startWorker(queueName: string, handler: JobHandler, opts?: WorkerOpts): void {
		if (this._workerTimer) {
			console.warn("[job-queue] Worker already running — call stopWorker() first");
			return;
		}

		this._stopping = false;
		const pollIntervalMs = opts?.pollIntervalMs ?? 2000;
		const concurrency = opts?.concurrency ?? 3;
		const batchSize = opts?.batchSize ?? concurrency;

		const poll = async () => {
			if (this._stopping) return;

			const available = concurrency - this._activeWorkerJobs.size;
			if (available <= 0) return;

			let jobs: Job[];
			try {
				jobs = await claimJobs(queueName, Math.min(available, batchSize));
			} catch (err) {
				console.error("[job-queue] dequeue error:", err instanceof Error ? err.message : err);
				return;
			}

			for (const job of jobs) {
				this._activeWorkerJobs.add(job.id);
				this._processJob(job, handler).finally(() => {
					this._activeWorkerJobs.delete(job.id);
				});
			}
		};

		// Run immediately, then on interval
		poll().catch((err) => console.error("[job-queue] initial poll error:", err));
		this._workerTimer = setInterval(() => {
			poll().catch((err) => console.error("[job-queue] poll error:", err));
		}, pollIntervalMs);

		console.info(
			`[job-queue] Worker started — queue="${queueName}" concurrency=${concurrency} interval=${pollIntervalMs}ms`,
		);
	}

	// ---------------------------------------------------------------------------
	// stopWorker — gracefully stop the polling loop
	// ---------------------------------------------------------------------------

	stopWorker(): void {
		this._stopping = true;
		if (this._workerTimer) {
			clearInterval(this._workerTimer);
			this._workerTimer = null;
		}
		console.info("[job-queue] Worker stopped");
	}

	// ---------------------------------------------------------------------------
	// _processJob — internal: run handler, update status on complete/fail
	// ---------------------------------------------------------------------------

	private async _processJob(job: Job, handler: JobHandler): Promise<void> {
		try {
			const result = await handler(job.data, job);
			await updateJobStatus(job.id, "completed", {
				output: (result as Record<string, unknown>) ?? {},
			});
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			const retryCount = job.retryCount ?? 0;
			const maxRetries = job.maxRetries ?? 3;

			if (retryCount < maxRetries) {
				await incrementRetryCount(job.id);
				console.warn(`[job-queue] Job ${job.id} failed (attempt ${retryCount + 1}/${maxRetries}): ${errorMsg}`);
			} else {
				await updateJobStatus(job.id, "failed", { error: errorMsg });
				console.error(`[job-queue] Job ${job.id} permanently failed after ${maxRetries} retries: ${errorMsg}`);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const jobQueue = new JobQueue();
