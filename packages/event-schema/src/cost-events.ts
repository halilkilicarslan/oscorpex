// @oscorpex/event-schema — Cost event payloads

export interface CostRecordedPayload {
	recordId: string;
	runId: string;
	taskId: string;
	provider: string;
	model?: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	costUsd: number;
}