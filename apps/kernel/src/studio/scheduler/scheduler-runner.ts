// ---------------------------------------------------------------------------
// Oscorpex — Scheduler Runner
// P10-A: Executes registered scheduler jobs with policy and audit gating.
// Guards: scheduler enabled check → job exists → job enabled → policy → handler.
// ---------------------------------------------------------------------------

import { createLogger } from "../logger.js";
import { recordSchedulerAudit } from "./scheduler-audit.js";
import { evaluateSchedulerPolicy } from "./scheduler-policy.js";
import { getJobDefinition, getJobHandler, isSchedulerEnabled } from "./scheduler-registry.js";
import type { SchedulerJobContext, SchedulerJobResult } from "./scheduler-types.js";

const log = createLogger("scheduler-runner");

export async function runJob(
	jobId: string,
	context?: Partial<SchedulerJobContext>,
): Promise<SchedulerJobResult> {
	const executedAt = new Date().toISOString();

	if (!isSchedulerEnabled()) {
		return {
			jobId,
			status: "skipped",
			error: "Scheduler disabled",
			durationMs: 0,
			executedAt,
		};
	}

	const definition = getJobDefinition(jobId);
	if (!definition) {
		return {
			jobId,
			status: "failed",
			error: `Job not found: ${jobId}`,
			durationMs: 0,
			executedAt,
		};
	}

	if (!definition.enabled) {
		return {
			jobId,
			status: "skipped",
			error: "Job disabled",
			durationMs: 0,
			executedAt,
		};
	}

	// Policy gate — enforces read-only constraint before any execution
	const policy = evaluateSchedulerPolicy({
		jobId,
		action: "execute",
		riskLevel: "read",
		source: "scheduler",
		tenantId: context?.tenantId,
		projectId: context?.projectId,
	});

	if (policy.decision === "deny") {
		recordSchedulerAudit({
			jobId,
			status: "denied",
			decision: "deny",
			reason: policy.reason,
			durationMs: 0,
		});
		return {
			jobId,
			status: "failed",
			error: `Policy denied: ${policy.reason}`,
			durationMs: 0,
			executedAt,
		};
	}

	const handler = getJobHandler(jobId);
	if (!handler) {
		return {
			jobId,
			status: "failed",
			error: "Handler not found",
			durationMs: 0,
			executedAt,
		};
	}

	const start = Date.now();
	const ctx: SchedulerJobContext = {
		jobId,
		tenantId: context?.tenantId,
		projectId: context?.projectId,
		startedAt: executedAt,
	};

	try {
		const result = await handler(ctx);
		const durationMs = Date.now() - start;
		recordSchedulerAudit({ jobId, status: "completed", decision: "allow", durationMs });
		return { ...result, durationMs };
	} catch (err) {
		const durationMs = Date.now() - start;
		const error = err instanceof Error ? err.message : String(err);
		log.error({ err, jobId }, "[scheduler] Job execution failed");
		recordSchedulerAudit({ jobId, status: "failed", decision: "allow", reason: error, durationMs });
		return { jobId, status: "failed", error, durationMs, executedAt: ctx.startedAt };
	}
}
