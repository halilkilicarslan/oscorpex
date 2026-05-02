// ---------------------------------------------------------------------------
// Oscorpex — Task Domain Types (foundational — no cross-domain imports)
// ---------------------------------------------------------------------------

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

// Human-in-the-Loop onay durumu
export type ApprovalStatus = "pending" | "approved" | "rejected";

export type TaskComplexity = "S" | "M" | "L" | "XL";

export type TaskType = "ai" | "integration-test" | "run-app";
export type TestExpectation = "none" | "optional" | "required";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface TaskOutput {
	filesCreated: string[];
	filesModified: string[];
	testResults?: { passed: number; failed: number; total: number };
	logs: string[];
}

export interface Task {
	id: string;
	phaseId: string;
	title: string;
	description: string;
	assignedAgent: string;
	status: TaskStatus;
	complexity: TaskComplexity;
	dependsOn: string[]; // Task IDs
	branch: string;
	taskType?: TaskType;
	testExpectation?: TestExpectation;
	output?: TaskOutput;
	retryCount: number;
	error?: string | null;
	startedAt?: string;
	completedAt?: string;
	// v2: review loop fields
	reviewStatus?: "approved" | "rejected" | null;
	reviewerAgentId?: string;
	reviewTaskId?: string;
	revisionCount: number;
	assignedAgentId?: string; // FK to project_agents.id
	// Human-in-the-Loop onay alanları
	requiresApproval: boolean;
	approvalStatus?: ApprovalStatus | null;
	approvalRejectionReason?: string;
	// v3.0: Micro-task decomposition
	parentTaskId?: string;
	targetFiles?: string[];
	estimatedLines?: number;
	// v4.2: Direct project reference (eliminates JOIN chain for lookups)
	projectId?: string;
	// v8.0: Auto-classified risk level for governance enforcement
	riskLevel?: RiskLevel;
	// v8.1: Persisted policy evaluation snapshot for replay truth
	policySnapshot?: string;
	// EPIC Performance: task creation timestamp for queue-wait metrics
	createdAt?: string;
}
