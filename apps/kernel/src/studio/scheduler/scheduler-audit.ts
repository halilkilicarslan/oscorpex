// ---------------------------------------------------------------------------
// Oscorpex — Scheduler Audit
// P10-K: In-memory audit logging for scheduler job executions.
// Records every job run — allow, deny, complete, fail, skip.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { createLogger } from "../logger.js";

const log = createLogger("scheduler-audit");

export interface SchedulerAuditEvent {
	id: string;
	jobId: string;
	status: "completed" | "failed" | "denied" | "skipped";
	decision: "allow" | "deny";
	reason?: string;
	durationMs: number;
	timestamp: string;
}

export function recordSchedulerAudit(
	event: Omit<SchedulerAuditEvent, "id" | "timestamp">,
): SchedulerAuditEvent {
	const audit: SchedulerAuditEvent = {
		...event,
		id: randomUUID(),
		timestamp: new Date().toISOString(),
	};
	log.info(
		{
			auditId: audit.id,
			jobId: audit.jobId,
			status: audit.status,
			decision: audit.decision,
			durationMs: audit.durationMs,
		},
		"[scheduler-audit] Job execution recorded",
	);
	return audit;
}
