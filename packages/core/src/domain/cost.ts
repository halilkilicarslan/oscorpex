// @oscorpex/core — Cost and budget domain types

export interface CostRecord {
	id: string;
	projectId?: string;
	runId: string;
	taskId: string;
	provider: string;
	model?: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	estimatedCostUsd?: number;
	billedCostUsd?: number;
	pricingVersion: string;
	createdAt: string;
}

export interface BudgetCheck {
	totalSpentUsd: number;
	budgetMaxUsd: number | null;
	exceeded: boolean;
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