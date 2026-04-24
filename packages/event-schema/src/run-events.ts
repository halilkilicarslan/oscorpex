// @oscorpex/event-schema — Run lifecycle event payloads

export interface RunCreatedPayload {
	runId: string;
	projectId: string;
	goal: string;
	mode: string;
}

export interface RunStartedPayload {
	runId: string;
	projectId: string;
	startedAt: string;
}

export interface RunPausedPayload {
	runId: string;
	projectId: string;
	pausedAt: string;
}

export interface RunResumedPayload {
	runId: string;
	projectId: string;
	resumedAt: string;
}

export interface RunFailedPayload {
	runId: string;
	projectId: string;
	reason: string;
	failedAt: string;
}

export interface RunCompletedPayload {
	runId: string;
	projectId: string;
	completedAt: string;
}