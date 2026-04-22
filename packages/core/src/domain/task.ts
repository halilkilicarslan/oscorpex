// @oscorpex/core — Canonical task domain types
// All 11 TaskStatus values from the inventory, plus Task/TaskOutput/TaskType/etc.

export type TaskStatus =
	| "queued"
	| "assigned"
	| "running"
	| "review"
	| "revision"
	| "waiting_approval"
	| "blocked"
	| "deferred"
	| "cancelled"
	| "done"
	| "failed";

export type TaskType = "ai" | "integration-test" | "run-app";

export type TaskComplexity = "S" | "M" | "L" | "XL";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface TaskOutput {
	filesCreated: string[];
	filesModified: string[];
	testResults?: { passed: number; failed: number; total: number };
	logs: string[];
}

export interface Task {
	id: string;
	runId: string;
	projectId: string;
	stageId: string;
	title: string;
	description: string;
	type: TaskType;
	complexity: TaskComplexity;
	status: TaskStatus;
	assignedRole?: string;
	assignedProvider?: string;
	dependsOn: string[];
	targetFiles?: string[];
	branch: string;
	retryCount: number;
	revisionCount: number;
	requiresApproval: boolean;
	approvalStatus?: ApprovalStatus;
	riskLevel?: RiskLevel;
	output?: TaskOutput;
	error?: string;
	startedAt?: string;
	completedAt?: string;
	parentTaskId?: string;
	reviewStatus?: "approved" | "rejected" | null;
	reviewerAgentId?: string;
	reviewTaskId?: string;
}