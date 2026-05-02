// ---------------------------------------------------------------------------
// Oscorpex — Token Usage & Cost Tracking Types
// ---------------------------------------------------------------------------

export interface TokenUsage {
	id: string;
	projectId: string;
	taskId: string;
	agentId: string;
	model: string;
	provider: string;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	costUsd: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	createdAt: string;
}

export interface ProjectCostSummary {
	totalCostUsd: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalTokens: number;
	taskCount: number;
	totalCacheCreationTokens: number;
	totalCacheReadTokens: number;
}

export interface CostBreakdownEntry {
	agentId: string;
	agentName?: string;
	model: string;
	taskCount: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	costUsd: number;
}
