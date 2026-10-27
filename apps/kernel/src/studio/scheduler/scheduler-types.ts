// ---------------------------------------------------------------------------
// Oscorpex — Scheduler Types
// P10-A: Read-only scheduler core type definitions.
// All scheduler jobs are strictly read-only — no mutations allowed.
// ---------------------------------------------------------------------------

export type SchedulerJobRisk = "read";
export type SchedulerJobScope = "tenant" | "project" | "global-readonly";

export interface SchedulerJobDefinition {
	id: string;
	name: string;
	description: string;
	schedule: string; // cron expression
	riskLevel: SchedulerJobRisk;
	scope: SchedulerJobScope;
	enabled: boolean;
}

export interface SchedulerJobResult {
	jobId: string;
	status: "completed" | "failed" | "skipped";
	output?: unknown;
	error?: string;
	durationMs: number;
	executedAt: string;
}

export type SchedulerJobHandler = (context: SchedulerJobContext) => Promise<SchedulerJobResult>;

export interface SchedulerJobContext {
	jobId: string;
	tenantId?: string;
	projectId?: string;
	startedAt: string;
}
