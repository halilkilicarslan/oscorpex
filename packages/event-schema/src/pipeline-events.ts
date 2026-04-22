// @oscorpex/event-schema — Pipeline event payloads

export interface PipelineStageStartedPayload {
	stageIndex?: number;
	stageName?: string;
	phaseId?: string;
}

export interface PipelineStageCompletedPayload {
	stageIndex?: number;
	stageName?: string;
	phaseId?: string;
}

export interface PipelineBranchCreatedPayload {
	branchName?: string;
	fromStage?: number;
}

export interface PipelineBranchMergedPayload {
	branchName?: string;
	intoStage?: number;
}

export interface PipelineCompletedPayload {
	totalStages?: number;
	durationMs?: number;
}

export interface PipelineFailedPayload {
	error?: string;
	stageIndex?: number;
}

export interface PipelinePausedPayload {
	reason?: string;
	stageIndex?: number;
}

export interface PipelineResumedPayload {
	stageIndex?: number;
	resumedBy?: string;
}

export interface PipelineDegradedPayload {
	reason?: string;
	provider?: string;
}

export interface PipelineRateLimitedPayload {
	provider?: string;
	retryAfterMs?: number;
}