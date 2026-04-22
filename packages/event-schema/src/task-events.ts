// @oscorpex/event-schema — Task event payloads

export interface TaskAssignedPayload {
	title: string;
	agentName?: string;
}

export interface TaskStartedPayload {
	title?: string;
	agentName?: string;
}

export interface TaskCompletedPayload {
	title?: string;
	durationMs?: number;
	filesCreated?: string[];
	filesModified?: string[];
}

export interface TaskFailedPayload {
	title?: string;
	error?: string;
	retryCount?: number;
	isTransient?: boolean;
}

export interface TaskTimeoutPayload {
	title?: string;
	timeoutMs?: number;
}

export interface TaskRetryPayload {
	title?: string;
	retryCount?: number;
	maxRetries?: number;
}

export interface TaskApprovalRequiredPayload {
	title?: string;
	riskLevel?: string;
	reason?: string;
}

export interface TaskApprovedPayload {
	title?: string;
	approvedBy?: string;
}

export interface TaskRejectedPayload {
	title?: string;
	rejectedBy?: string;
	reason?: string;
}

export interface TaskAddedPayload {
	title?: string;
	phaseId?: string;
	complexity?: string;
}

export interface TaskReviewRejectedPayload {
	title?: string;
	reviewerAgentId?: string;
	reason?: string;
}

export interface TaskProposalCreatedPayload {
	title?: string;
	proposalType?: string;
	originatingAgentId?: string;
}

export interface TaskProposalApprovedPayload {
	title?: string;
	approvedBy?: string;
	createdTaskId?: string;
}

export interface TaskTransientFailurePayload {
	title?: string;
	error?: string;
	classification?: string;
	willRetry?: boolean;
}

export interface TaskTimeoutWarningPayload {
	title?: string;
	elapsedMs?: number;
	timeoutMs?: number;
}