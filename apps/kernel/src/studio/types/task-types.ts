// ---------------------------------------------------------------------------
// Oscorpex — Task Domain Types (foundational — no cross-domain imports)
// Union types sourced from @oscorpex/core (single source of truth).
// Interfaces kept here — kernel has extra fields not in core contract.
// ---------------------------------------------------------------------------

// Import + re-export canonical union types from @oscorpex/core
import type {
	TaskStatus as _TaskStatus,
	ApprovalStatus as _ApprovalStatus,
	TaskComplexity as _TaskComplexity,
	TaskType as _TaskType,
	RiskLevel as _RiskLevel,
} from "@oscorpex/core";
export type TaskStatus = _TaskStatus;
export type ApprovalStatus = _ApprovalStatus;
export type TaskComplexity = _TaskComplexity;
export type TaskType = _TaskType;
export type RiskLevel = _RiskLevel;

export type TestExpectation = "none" | "optional" | "required";

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
