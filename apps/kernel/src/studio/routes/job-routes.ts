// ---------------------------------------------------------------------------
// Oscorpex — Job Routes (V6 M4)
// Admin endpoints for inspecting and managing the durable job queue.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { type JobStatus, cleanupCompletedJobs, getJobStats, incrementRetryCount, listJobs } from "../db.js";
import { createLogger } from "../logger.js";
const log = createLogger("job-routes");

const router = new Hono();

// ---------------------------------------------------------------------------
// GET /jobs — list jobs with optional filters
// Query: status, queue, limit, offset
// ---------------------------------------------------------------------------

router.get("/", async (c) => {
	try {
		const status = c.req.query("status") as JobStatus | undefined;
		const queue = c.req.query("queue");
		const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "50", 10), 200);
		const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);

		const jobs = await listJobs({ status, queue, limit, offset });
		return c.json({ jobs, count: jobs.length });
	} catch (err) {
		log.error("[job-routes] GET /jobs error: " + (err instanceof Error ? err.message : String(err)));
		return c.json({ error: "Failed to list jobs" }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /jobs/stats — queue statistics (counts by status)
// Query: queue (optional, filter by specific queue)
// ---------------------------------------------------------------------------

router.get("/stats", async (c) => {
	try {
		const queue = c.req.query("queue");
		const stats = await getJobStats(queue);
		return c.json({ stats, queue: queue ?? "all" });
	} catch (err) {
		log.error("[job-routes] GET /jobs/stats error: " + (err instanceof Error ? err.message : String(err)));
		return c.json({ error: "Failed to get job stats" }, 500);
	}
});

// ---------------------------------------------------------------------------
// POST /jobs/:id/retry — retry a failed job
// Resets it to 'retry' state and increments retry_count.
// Returns 409 if job has already exceeded max_retries.
// ---------------------------------------------------------------------------

router.post("/:id/retry", async (c) => {
	try {
		const id = c.req.param("id");

		// Fetch current job state to check retry eligibility
		const jobs = await listJobs({ limit: 200 });
		const job = jobs.find((j) => j.id === id);
		if (!job) {
			return c.json({ error: "Job not found" }, 404);
		}

		if (job.status !== "failed" && job.status !== "active") {
			return c.json(
				{ error: `Cannot retry job in '${job.status}' state — only failed/active jobs can be retried` },
				409,
			);
		}

		if (job.retryCount >= job.maxRetries) {
			return c.json(
				{ error: `Job has exceeded max retries (${job.maxRetries}). Force-reset the status manually if needed.` },
				409,
			);
		}

		const updated = await incrementRetryCount(id);
		if (!updated) {
			return c.json({ error: "Job not found or already updated" }, 404);
		}

		return c.json({ job: updated });
	} catch (err) {
		log.error("[job-routes] POST /jobs/:id/retry error: " + (err instanceof Error ? err.message : String(err)));
		return c.json({ error: "Failed to retry job" }, 500);
	}
});

// ---------------------------------------------------------------------------
// DELETE /jobs/cleanup — remove completed jobs older than threshold
// Query: olderThanHours (default: 24)
// ---------------------------------------------------------------------------

router.delete("/cleanup", async (c) => {
	try {
		const hoursStr = c.req.query("olderThanHours") ?? "24";
		const olderThanMs = Number.parseFloat(hoursStr) * 60 * 60 * 1000;
		if (Number.isNaN(olderThanMs) || olderThanMs <= 0) {
			return c.json({ error: "Invalid olderThanHours parameter" }, 400);
		}

		const deleted = await cleanupCompletedJobs(olderThanMs);
		return c.json({ deleted, message: `Deleted ${deleted} completed jobs older than ${hoursStr}h` });
	} catch (err) {
		log.error("[job-routes] DELETE /jobs/cleanup error: " + (err instanceof Error ? err.message : String(err)));
		return c.json({ error: "Failed to cleanup jobs" }, 500);
	}
});

export { router as jobRoutes };
