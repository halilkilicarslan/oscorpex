// @oscorpex/event-schema — Execution, Escalation, Git, Governance, and other payloads

export interface ExecutionStartedPayload {
	taskId?: string;
	agentId?: string;
	provider?: string;
}

export interface ExecutionErrorPayload {
	taskId?: string;
	agentId?: string;
	error?: string;
	provider?: string;
}

export interface EscalationUserPayload {
	taskId?: string;
	reason?: string;
	agentName?: string;
}

export interface GitCommitPayload {
	hash?: string;
	message?: string;
	branch?: string;
	fileCount?: number;
}

export interface GitPrCreatedPayload {
	prNumber?: number;
	branch?: string;
	title?: string;
}

export interface PolicyViolationPayload {
	ruleId?: string;
	action?: string;
	violations?: string[];
	blocked?: boolean;
}

export interface VerificationPassedPayload {
	taskId?: string;
	checkCount?: number;
}

export interface VerificationFailedPayload {
	taskId?: string;
	failedChecks?: string[];
}

export interface QualityGateEvaluatedPayload {
	goalId?: string;
	gateType?: string;
	evaluationId?: string;
	outcome?: string;
	environment?: string;
	blocking?: boolean;
	required?: boolean;
	reason?: string;
}

export interface QualityGateBlockedPayload {
	goalId?: string;
	gateType?: string;
	evaluationId?: string;
	environment?: string;
	reason?: string;
	overrideAllowed?: boolean;
}

export interface QualityGateReleaseReadyPayload {
	goalId?: string;
	environment?: string;
	ready?: boolean;
	blockingCount?: number;
	warningCount?: number;
	missingEvaluationCount?: number;
}

export interface ApprovalRequestedPayload {
	approvalRequestId?: string;
	goalId?: string;
	approvalClass?: string;
	environment?: string;
	requiredRoles?: string[];
	requiredQuorum?: number;
	expiresAt?: string;
}

export interface ApprovalDecisionPayload {
	approvalRequestId?: string;
	approvalDecisionId?: string;
	goalId?: string;
	approvalClass?: string;
	actorId?: string;
	decision?: string;
	reason?: string;
}

export interface ApprovalExpiredPayload {
	approvalRequestId?: string;
	goalId?: string;
	approvalClass?: string;
	expiredAt?: string;
}

export interface ApprovalSupersededPayload {
	approvalRequestId?: string;
	goalId?: string;
	approvalClass?: string;
	supersededAt?: string;
	reason?: string;
}

export interface ApprovalQuorumSatisfiedPayload {
	approvalRequestId?: string;
	goalId?: string;
	approvalClass?: string;
	approvedCount?: number;
	requiredQuorum?: number;
}

export interface ApprovalBlockedPayload {
	approvalRequestId?: string;
	goalId?: string;
	approvalClass?: string;
	reason?: string;
}

export interface ReleaseCandidateCreatedPayload {
	goalId?: string;
	releaseCandidateId?: string;
	environment?: string;
	actorId?: string;
	correlationId?: string;
}

export interface ReleaseDecisionRecordedPayload {
	goalId?: string;
	releaseCandidateId?: string;
	releaseDecisionId?: string;
	decision?: string;
	allowed?: boolean;
	blocked?: boolean;
	rollbackRequired?: boolean;
	blockingReasonCount?: number;
}

export interface ReleaseBlockedPayload {
	goalId?: string;
	releaseCandidateId?: string;
	releaseDecisionId?: string;
	reasonSummary?: string;
	blockingReasonCount?: number;
	requiresOverride?: boolean;
}

export interface ReleaseAllowedPayload {
	goalId?: string;
	releaseCandidateId?: string;
	releaseDecisionId?: string;
}

export interface ReleaseOverrideAppliedPayload {
	goalId?: string;
	releaseCandidateId?: string;
	gateEvaluationId?: string;
	gateType?: string;
	actorId?: string;
	reason?: string;
	expiresAt?: string;
}

export interface ReleaseRollbackTriggeredPayload {
	goalId?: string;
	releaseCandidateId?: string;
	triggerType?: string;
	severity?: string;
	state?: string;
	source?: string;
	reason?: string;
}

export interface ReleaseRollbackRequiredPayload {
	goalId?: string;
	releaseCandidateId?: string;
	triggerType?: string;
	severity?: string;
	reason?: string;
}

export interface LifecycleTransitionPayload {
	entityType?: string;
	entityId?: string;
	fromStatus?: string;
	toStatus?: string;
	reason?: string;
}

export interface GoalEvaluatedPayload {
	goalId?: string;
	met?: boolean;
	confidence?: number;
	criterionResults?: Array<{ criterion: string; met: boolean; evidence?: string }>;
}

export interface MessageCreatedPayload {
	messageId?: string;
	fromAgentId?: string;
	toAgentId?: string;
	messageType?: string;
	subject?: string;
}

export interface CeremonyStandupPayload {
	agentCount?: number;
	summary?: string;
}

export interface CeremonyRetrospectivePayload {
	completionPercent?: number;
	lessonsLearned?: number;
}

export interface GraphMutationProposedPayload {
	mutationType?: string;
	targetTaskId?: string;
	proposedByAgentId?: string;
}

export interface GraphMutationAppliedPayload {
	mutationType?: string;
	targetTaskId?: string;
	appliedByAgentId?: string;
}

export interface ProviderDegradedPayload {
	provider?: string;
	reason?: string;
	cooldownUntilMs?: number;
}

export interface PromptSizePayload {
	chars?: number;
	estimatedTokens?: number;
	mode?: string;
}

export interface WorkItemCreatedPayload {
	workItemId?: string;
	title?: string;
	type?: string;
	priority?: string;
	source?: string;
}

export interface WorkItemPlannedPayload {
	workItemId?: string;
	plannedTaskId?: string;
}

export interface SprintStartedPayload {
	sprintId?: string;
	name?: string;
	goal?: string;
}

export interface SprintCompletedPayload {
	sprintId?: string;
	name?: string;
	completedTasks?: number;
	totalTasks?: number;
}
