// @oscorpex/core — Canonical domain types
// Run status and Run entity as defined in the master plan,
// augmented with ProjectStatus from the inventory.

export type RunStatus =
	| "created"
	| "planning"
	| "running"
	| "paused"
	| "blocked"
	| "failed"
	| "completed"
	| "cancelled";

export type RunMode = "explore" | "design" | "plan" | "execute" | "verify" | "recover";

export interface Run {
	id: string;
	projectId: string;
	goal: string;
	mode: RunMode;
	status: RunStatus;
	currentStageId?: string;
	startedAt?: string;
	completedAt?: string;
	metadata?: Record<string, unknown>;
}

export type ProjectStatus =
	| "planning"
	| "approved"
	| "running"
	| "paused"
	| "completed"
	| "failed"
	| "maintenance"
	| "archived";

export interface ValidTransition {
	from: ProjectStatus;
	to: ProjectStatus;
}
export const VALID_PROJECT_TRANSITIONS: ValidTransition[] = [
	{ from: "planning", to: "approved" },
	{ from: "planning", to: "archived" },
	{ from: "approved", to: "running" },
	{ from: "approved", to: "planning" },
	{ from: "running", to: "paused" },
	{ from: "running", to: "completed" },
	{ from: "running", to: "failed" },
	{ from: "paused", to: "running" },
	{ from: "paused", to: "failed" },
	{ from: "completed", to: "maintenance" },
	{ from: "completed", to: "archived" },
	{ from: "failed", to: "planning" },
	{ from: "failed", to: "archived" },
	{ from: "maintenance", to: "archived" },
	{ from: "maintenance", to: "planning" },
];