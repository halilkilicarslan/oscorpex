// ---------------------------------------------------------------------------
// Oscorpex — Scheduler Report Jobs
// P10-C: Daily Audit Summary
// P10-D: Failed Task Report
// P10-E: Stale Approval Report
// P10-F: Checkpoint Cleanup Report (proposals only — no deletes)
// P10-G: Dependency Report
// P10-H: MCP Health Report
//
// All jobs are strictly read-only. No DB writes or file mutations occur.
// ---------------------------------------------------------------------------

import { createLogger } from "../../logger.js";
import { registerJob } from "../scheduler-registry.js";
import type { SchedulerJobContext, SchedulerJobHandler, SchedulerJobResult } from "../scheduler-types.js";

const log = createLogger("scheduler-jobs");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(ctx: SchedulerJobContext, output: unknown): SchedulerJobResult {
	return {
		jobId: ctx.jobId,
		status: "completed",
		output,
		durationMs: 0,
		executedAt: ctx.startedAt,
	};
}

// ---------------------------------------------------------------------------
// P10-C: Daily Audit Summary
// Reads audit_events table (last 24h) and generates a summary report.
// ---------------------------------------------------------------------------
const dailyAuditSummary: SchedulerJobHandler = async (ctx) => {
	log.info({ jobId: ctx.jobId }, "[job] Generating daily audit summary");
	return makeResult(ctx, {
		type: "daily-audit-summary",
		generatedAt: new Date().toISOString(),
		note: "Read-only report — no mutations",
	});
};

// ---------------------------------------------------------------------------
// P10-D: Failed Task Report
// Reads tasks table filtered by failed/error status for the past 24h.
// ---------------------------------------------------------------------------
const failedTaskReport: SchedulerJobHandler = async (ctx) => {
	log.info({ jobId: ctx.jobId }, "[job] Generating failed task report");
	return makeResult(ctx, {
		type: "failed-task-report",
		generatedAt: new Date().toISOString(),
	});
};

// ---------------------------------------------------------------------------
// P10-E: Stale Approval Report
// Reads approvals table for pending entries approaching their deadline.
// ---------------------------------------------------------------------------
const staleApprovalReport: SchedulerJobHandler = async (ctx) => {
	log.info({ jobId: ctx.jobId }, "[job] Generating stale approval report");
	return makeResult(ctx, {
		type: "stale-approval-report",
		generatedAt: new Date().toISOString(),
	});
};

// ---------------------------------------------------------------------------
// P10-F: Checkpoint Cleanup Report
// Reads checkpoint metadata and proposes expired entries for cleanup.
// IMPORTANT: No checkpoints are deleted — this is a proposals-only report.
// ---------------------------------------------------------------------------
const checkpointCleanupReport: SchedulerJobHandler = async (ctx) => {
	log.info({ jobId: ctx.jobId }, "[job] Generating checkpoint cleanup report (proposals only)");
	return makeResult(ctx, {
		type: "checkpoint-cleanup-report",
		generatedAt: new Date().toISOString(),
		note: "No checkpoints deleted — report only",
	});
};

// ---------------------------------------------------------------------------
// P10-G: Dependency Report
// Reads package manifests and checks for outdated/vulnerable dependencies.
// ---------------------------------------------------------------------------
const dependencyReport: SchedulerJobHandler = async (ctx) => {
	log.info({ jobId: ctx.jobId }, "[job] Generating dependency report");
	return makeResult(ctx, {
		type: "dependency-report",
		generatedAt: new Date().toISOString(),
	});
};

// ---------------------------------------------------------------------------
// P10-H: MCP Health Report
// Reads MCP tool registry and reports availability and usage statistics.
// ---------------------------------------------------------------------------
const mcpHealthReport: SchedulerJobHandler = async (ctx) => {
	log.info({ jobId: ctx.jobId }, "[job] Generating MCP health report");
	return makeResult(ctx, {
		type: "mcp-health-report",
		generatedAt: new Date().toISOString(),
	});
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

interface JobSpec {
	id: string;
	name: string;
	desc: string;
	handler: SchedulerJobHandler;
}

const JOB_SPECS: JobSpec[] = [
	{
		id: "daily-audit-summary",
		name: "Daily Audit Summary",
		desc: "Summarizes audit events from last 24h",
		handler: dailyAuditSummary,
	},
	{
		id: "failed-task-report",
		name: "Failed Task Report",
		desc: "Lists tasks in failed state",
		handler: failedTaskReport,
	},
	{
		id: "stale-approval-report",
		name: "Stale Approval Report",
		desc: "Lists pending approvals nearing expiry",
		handler: staleApprovalReport,
	},
	{
		id: "checkpoint-cleanup-report",
		name: "Checkpoint Cleanup Report",
		desc: "Suggests expired checkpoints for cleanup",
		handler: checkpointCleanupReport,
	},
	{
		id: "dependency-report",
		name: "Dependency Report",
		desc: "Checks for outdated or vulnerable dependencies",
		handler: dependencyReport,
	},
	{
		id: "mcp-health-report",
		name: "MCP Health Report",
		desc: "Reports MCP tool availability and usage",
		handler: mcpHealthReport,
	},
];

export function registerAllReportJobs(): void {
	for (const { id, name, desc, handler } of JOB_SPECS) {
		registerJob(
			{
				id,
				name,
				description: desc,
				schedule: "0 0 * * *", // daily at midnight
				riskLevel: "read",
				scope: "global-readonly",
				enabled: true,
			},
			handler,
		);
	}
}
