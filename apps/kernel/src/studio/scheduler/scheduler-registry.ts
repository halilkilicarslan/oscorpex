// ---------------------------------------------------------------------------
// Oscorpex — Scheduler Registry
// P10-A: Central registry for all scheduler jobs.
// Only read-only (riskLevel: "read") jobs are accepted.
// ---------------------------------------------------------------------------

import { createLogger } from "../logger.js";
import type { SchedulerJobDefinition, SchedulerJobHandler } from "./scheduler-types.js";

const log = createLogger("scheduler-registry");

const JOBS = new Map<string, { definition: SchedulerJobDefinition; handler: SchedulerJobHandler }>();

export function registerJob(definition: SchedulerJobDefinition, handler: SchedulerJobHandler): void {
	if (definition.riskLevel !== "read") {
		throw new Error(`[scheduler] Only read-only jobs allowed. Got: ${definition.riskLevel}`);
	}
	JOBS.set(definition.id, { definition, handler });
	log.info({ jobId: definition.id }, "[scheduler] Job registered");
}

export function listJobs(): SchedulerJobDefinition[] {
	return Array.from(JOBS.values()).map((j) => j.definition);
}

export function getJobHandler(id: string): SchedulerJobHandler | undefined {
	return JOBS.get(id)?.handler;
}

export function getJobDefinition(id: string): SchedulerJobDefinition | undefined {
	return JOBS.get(id)?.definition;
}

export function isSchedulerEnabled(): boolean {
	return process.env.OSCORPEX_ENABLE_SCHEDULER === "true";
}
