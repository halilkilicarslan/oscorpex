// ---------------------------------------------------------------------------
// Oscorpex — Scheduler Policy
// P10-B: Policy engine for scheduler job execution.
// Enforces read-only constraint and denies any mutating actions.
// ---------------------------------------------------------------------------

export interface SchedulerPolicyRequest {
	jobId: string;
	action: string;
	riskLevel: "read";
	source: "scheduler";
	tenantId?: string;
	projectId?: string;
}

export interface SchedulerPolicyDecision {
	decision: "allow" | "deny";
	reason: string;
	code?: string;
}

const DENIED_ACTIONS = new Set([
	"file.write",
	"file.delete",
	"git.commit",
	"git.push",
	"git.reset",
	"shell.run",
	"deploy.run",
	"container.run",
	"db.mutate",
	"credential.read",
	"memory.delete",
	"task.update",
	"project.update",
	"checkpoint.delete",
]);

export function evaluateSchedulerPolicy(request: SchedulerPolicyRequest): SchedulerPolicyDecision {
	if (request.riskLevel !== "read") {
		return {
			decision: "deny",
			reason: "Scheduler only supports read-only jobs",
			code: "SCHEDULER_WRITE_DENIED",
		};
	}
	if (DENIED_ACTIONS.has(request.action)) {
		return {
			decision: "deny",
			reason: `Action '${request.action}' denied for scheduler`,
			code: "SCHEDULER_ACTION_DENIED",
		};
	}
	return {
		decision: "allow",
		reason: `Scheduler read-only action allowed: ${request.action}`,
	};
}
