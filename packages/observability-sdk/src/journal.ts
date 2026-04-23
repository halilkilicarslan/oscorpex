// @oscorpex/observability-sdk — Execution journal types
// Immutable records of provider executions for audit and replay.

export interface ProviderExecutionRecord {
	id: string;
	runId: string;
	taskId: string;
	agentId: string;
	provider: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	costUsd: number;
	cacheCreationTokens?: number;
	cacheReadTokens?: number;
	startedAt: string;
	completedAt?: string;
	status: "success" | "failure" | "timeout" | "rate_limited";
	errorMessage?: string;
}

export interface ExecutionJournal {
	runId: string;
	entries: ProviderExecutionRecord[];
}

export interface JournalFilter {
	runId?: string;
	taskId?: string;
	agentId?: string;
	provider?: string;
	status?: ProviderExecutionRecord["status"];
	from?: string;
	to?: string;
}