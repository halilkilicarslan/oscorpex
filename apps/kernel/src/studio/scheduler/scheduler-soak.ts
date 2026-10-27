// ---------------------------------------------------------------------------
// Oscorpex — Scheduler Soak Mode
// P11-H: Runs all enabled jobs sequentially with full logging and reporting.
// Soak mode is strictly read-only — jobs are observed, never mutated.
// ---------------------------------------------------------------------------

import { createLogger } from "../logger.js";
import { recordSchedulerAudit } from "./scheduler-audit.js";
import { isSchedulerEnabled, listJobs } from "./scheduler-registry.js";
import { runJob } from "./scheduler-runner.js";
import type { SchedulerJobResult } from "./scheduler-types.js";

const log = createLogger("scheduler-soak");

export interface SoakRunResult {
	totalJobs: number;
	completed: number;
	failed: number;
	skipped: number;
	results: SchedulerJobResult[];
	duration: number;
	timestamp: string;
}

/**
 * Run all enabled jobs in soak mode — sequential, with full logging.
 * Soak mode never mutates — all jobs are read-only.
 * Jobs are executed one at a time to avoid concurrency side-effects during diagnostics.
 */
export async function runSoakCycle(): Promise<SoakRunResult> {
	if (!isSchedulerEnabled()) {
		log.info("[soak] Scheduler disabled — soak cycle skipped");
		return {
			totalJobs: 0,
			completed: 0,
			failed: 0,
			skipped: 0,
			results: [],
			duration: 0,
			timestamp: new Date().toISOString(),
		};
	}

	const jobs = listJobs().filter((j) => j.enabled);
	const results: SchedulerJobResult[] = [];
	const start = Date.now();

	log.info({ jobCount: jobs.length }, "[soak] Starting soak cycle");

	for (const job of jobs) {
		log.info({ jobId: job.id, jobName: job.name }, "[soak] Running job");
		try {
			const result = await runJob(job.id);
			results.push(result);
			log.info({ jobId: job.id, status: result.status, durationMs: result.durationMs }, "[soak] Job completed");
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			log.warn({ err, jobId: job.id }, "[soak] Job threw unexpectedly");
			const failed: SchedulerJobResult = {
				jobId: job.id,
				status: "failed",
				error: errorMsg,
				durationMs: 0,
				executedAt: new Date().toISOString(),
			};
			results.push(failed);
			recordSchedulerAudit({
				jobId: job.id,
				status: "failed",
				decision: "allow",
				reason: errorMsg,
				durationMs: 0,
			});
		}
	}

	const duration = Date.now() - start;
	const summary: SoakRunResult = {
		totalJobs: jobs.length,
		completed: results.filter((r) => r.status === "completed").length,
		failed: results.filter((r) => r.status === "failed").length,
		skipped: results.filter((r) => r.status === "skipped").length,
		results,
		duration,
		timestamp: new Date().toISOString(),
	};

	log.info(
		{
			totalJobs: summary.totalJobs,
			completed: summary.completed,
			failed: summary.failed,
			skipped: summary.skipped,
			duration: summary.duration,
		},
		"[soak] Soak cycle completed",
	);

	return summary;
}
