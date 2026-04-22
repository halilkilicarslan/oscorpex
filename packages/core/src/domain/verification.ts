// @oscorpex/core — Verification domain types
// Canonical types for verification gates and reports.

export type VerificationStrictness = "strict" | "lenient";

export type VerificationType = "files_exist" | "files_modified" | "output_non_empty";

export type TestPolicy = "required" | "optional" | "skip";

export type GoalEnforcementMode = "enforce" | "advisory";

export type GoalStatus = "pending" | "active" | "achieved" | "failed" | "partial";

export interface VerificationDetail {
	file?: string;
	expected: string;
	actual: string;
}

export interface VerificationResult {
	type: VerificationType;
	passed: boolean;
	details: VerificationDetail[];
}

export interface VerificationReport {
	runId: string;
	taskId: string;
	passed: boolean;
	checks: VerificationResult[];
	createdAt: string;
}

export interface GateResult {
	passed: boolean;
	failedChecks?: string;
}

export interface CriterionResult {
	criterion: string;
	met: boolean;
	evidence?: string;
	confidence?: number;
}

export interface GoalDefinition {
	goal: string;
	constraints: string[];
	successCriteria: string[];
}

export interface ExecutionGoal {
	id: string;
	projectId: string;
	taskId?: string;
	definition: GoalDefinition;
	status: GoalStatus;
	criteriaResults: CriterionResult[];
	createdAt: string;
	completedAt?: string;
}

export interface VerificationInput {
	runId: string;
	task: import("./task.js").Task;
	artifact: import("./artifact.js").ArtifactManifest;
	repoPath: string;
}