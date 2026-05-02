// ---------------------------------------------------------------------------
// Oscorpex — Job Repo (V6 M4)
// Low-level DB operations for the durable job queue.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { createLogger } from "../logger.js";
import { execute, query, queryOne } from "../pg.js";
const log = createLogger("job-repo");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JobStatus = "created" | "active" | "completed" | "failed" | "retry";

export interface Job {
	id: string;
	queue: string;
	data: Record<string, unknown>;
	status: JobStatus;
	output: Record<string, unknown> | null;
	error: string | null;
	retryCount: number;
	maxRetries: number;
	startedAt: string | null;
	completedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface InsertJobData {
	queue?: string;
	data?: Record<string, unknown>;
	maxRetries?: number;
}

export interface ListJobsOpts {
	status?: JobStatus;
	queue?: string;
	limit?: number;
	offset?: number;
}

// ---------------------------------------------------------------------------
// Row → Model mapper
// ---------------------------------------------------------------------------

function rowToJob(row: Record<string, unknown>): Job {
	return {
		id: row.id as string,
		queue: row.queue as string,
		data: (row.data as Record<string, unknown>) ?? {},
		status: row.status as JobStatus,
		output: (row.output as Record<string, unknown> | null) ?? null,
		error: (row.error as string | null) ?? null,
		retryCount: (row.retry_count as number) ?? 0,
		maxRetries: (row.max_retries as number) ?? 3,
		startedAt: (row.started_at as string | null) ?? null,
		completedAt: (row.completed_at as string | null) ?? null,
		createdAt: row.created_at as string,
		updatedAt: row.updated_at as string,
	};
}

// ---------------------------------------------------------------------------
// insertJob — enqueue a new job in 'created' state
// ---------------------------------------------------------------------------

export async function insertJob(data: InsertJobData): Promise<Job> {
	const id = randomUUID();
	const row = await queryOne<Record<string, unknown>>(
		`INSERT INTO jobs (id, queue, data, max_retries)
		 VALUES ($1, $2, $3, $4)
		 RETURNING *`,
		[id, data.queue ?? "task-execution", data.data ?? {}, data.maxRetries ?? 3],
	);
	if (!row) throw new Error("job insert returned no row");
	return rowToJob(row);
}

// ---------------------------------------------------------------------------
// claimJobs — SELECT FOR UPDATE SKIP LOCKED; atomically move to 'active'
// ---------------------------------------------------------------------------

export async function claimJobs(queueName: string, limit = 1): Promise<Job[]> {
	const rows = await query<Record<string, unknown>>(
		`WITH claimed AS (
		   SELECT id FROM jobs
		   WHERE queue = $1 AND status IN ('created', 'retry')
		   ORDER BY created_at ASC
		   LIMIT $2
		   FOR UPDATE SKIP LOCKED
		 )
		 UPDATE jobs
		 SET status = 'active', started_at = now(), updated_at = now()
		 FROM claimed
		 WHERE jobs.id = claimed.id
		 RETURNING jobs.*`,
		[queueName, limit],
	);
	return rows.map(rowToJob);
}

// ---------------------------------------------------------------------------
// updateJobStatus — generic state transition helper
// ---------------------------------------------------------------------------

export async function updateJobStatus(
	id: string,
	status: JobStatus,
	opts?: { output?: Record<string, unknown>; error?: string },
): Promise<Job | null> {
	const completedAt = status === "completed" || status === "failed" ? "now()" : null;
	const row = await queryOne<Record<string, unknown>>(
		`UPDATE jobs
		 SET status      = $2,
		     output      = COALESCE($3::jsonb, output),
		     error       = COALESCE($4, error),
		     completed_at = ${completedAt ? "now()" : "completed_at"},
		     updated_at  = now()
		 WHERE id = $1
		 RETURNING *`,
		[id, status, opts?.output ?? null, opts?.error ?? null],
	);
	return row ? rowToJob(row) : null;
}

// ---------------------------------------------------------------------------
// incrementRetryCount — bump retry_count and reset to 'retry' state
// ---------------------------------------------------------------------------

export async function incrementRetryCount(id: string): Promise<Job | null> {
	const row = await queryOne<Record<string, unknown>>(
		`UPDATE jobs
		 SET retry_count = retry_count + 1,
		     status      = 'retry',
		     started_at  = NULL,
		     updated_at  = now()
		 WHERE id = $1
		 RETURNING *`,
		[id],
	);
	return row ? rowToJob(row) : null;
}

// ---------------------------------------------------------------------------
// listJobs — query jobs with optional status/queue/pagination filters
// ---------------------------------------------------------------------------

export async function listJobs(opts: ListJobsOpts = {}): Promise<Job[]> {
	const conditions: string[] = [];
	const params: unknown[] = [];
	let idx = 1;

	if (opts.status) {
		conditions.push(`status = $${idx++}`);
		params.push(opts.status);
	}
	if (opts.queue) {
		conditions.push(`queue = $${idx++}`);
		params.push(opts.queue);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const limit = opts.limit ?? 50;
	const offset = opts.offset ?? 0;
	params.push(limit, offset);

	const rows = await query<Record<string, unknown>>(
		`SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
		params,
	);
	return rows.map(rowToJob);
}

// ---------------------------------------------------------------------------
// getJobStats — count jobs per status for a queue (or all queues)
// ---------------------------------------------------------------------------

export async function getJobStats(queueName?: string): Promise<Record<string, number>> {
	const rows = await query<{ status: string; cnt: string }>(
		queueName
			? "SELECT status, COUNT(*) AS cnt FROM jobs WHERE queue = $1 GROUP BY status"
			: "SELECT status, COUNT(*) AS cnt FROM jobs GROUP BY status",
		queueName ? [queueName] : [],
	);
	const stats: Record<string, number> = { created: 0, active: 0, completed: 0, failed: 0, retry: 0 };
	for (const row of rows) {
		stats[row.status] = Number.parseInt(row.cnt, 10);
	}
	return stats;
}

// ---------------------------------------------------------------------------
// cleanupCompletedJobs — delete completed jobs older than threshold
// ---------------------------------------------------------------------------

export async function cleanupCompletedJobs(olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
	const cutoff = new Date(Date.now() - olderThanMs).toISOString();
	const rows = await query<{ id: string }>(
		`DELETE FROM jobs WHERE status = 'completed' AND completed_at < $1 RETURNING id`,
		[cutoff],
	);
	return rows.length;
}

// ---------------------------------------------------------------------------
// resetStaleJobs — find active jobs whose started_at is beyond threshold
// ---------------------------------------------------------------------------

export async function resetStaleJobs(staleDurationMs = 10 * 60 * 1000): Promise<Job[]> {
	const cutoff = new Date(Date.now() - staleDurationMs).toISOString();
	const rows = await query<Record<string, unknown>>(
		`UPDATE jobs
		 SET status = 'created', started_at = NULL, updated_at = now()
		 WHERE status = 'active' AND started_at < $1
		 RETURNING *`,
		[cutoff],
	);
	return rows.map(rowToJob);
}
