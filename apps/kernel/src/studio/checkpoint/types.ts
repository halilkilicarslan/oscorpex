export type CheckpointType = "git" | "filesystem" | "task-state" | "pipeline-state" | "provider-output";
export type CheckpointRiskLevel = "low" | "medium" | "high";
export type CheckpointStatus = "active" | "rolled_back" | "expired" | "failed";
export type RollbackStatus =
	| "pending"
	| "approved"
	| "applied"
	| "failed"
	| "rejected"
	| "blocked"
	| "planned"
	| "requires_approval";

export interface CreateCheckpointInput {
	tenantId: string;
	projectId: string;
	runId?: string;
	taskId?: string;
	type: CheckpointType;
	reason: string;
	createdBy: "system" | "user" | "agent";
	riskLevel: CheckpointRiskLevel;
	metadata?: Record<string, unknown>;
}

export interface CheckpointRecord extends CreateCheckpointInput {
	id: string;
	ref: string;
	createdAt: string;
	status: CheckpointStatus;
}

export interface RollbackRequest {
	checkpointId: string;
	tenantId: string;
	projectId: string;
	requestedBy: string;
	reason: string;
	dryRun: boolean;
}

export interface RollbackResult {
	status: RollbackStatus;
	changedFiles?: string[];
	restoredState?: string[];
	warnings?: string[];
	errors?: string[];
}
