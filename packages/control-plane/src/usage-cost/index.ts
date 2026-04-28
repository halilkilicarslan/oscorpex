// ---------------------------------------------------------------------------
// Usage Telemetry + Cost Visibility — Types, Repository, Service
// ---------------------------------------------------------------------------

export interface UsageRollup {
	projectId: string;
	providerId: string;
	taskCount: number;
	tokenInput: number;
	tokenOutput: number;
	totalTokens: number;
	periodStart: string;
	periodEnd: string;
}

export interface CostRollup {
	projectId: string;
	providerId: string;
	costUsd: number;
	fallbackCostUsd: number;
	retryCostUsd: number;
	periodStart: string;
	periodEnd: string;
}

export interface BudgetSnapshot {
	projectId: string;
	maxBudgetUsd: number | null;
	spentUsd: number;
	remainingUsd: number | null;
	alertThreshold: number;
	alertFired: boolean;
}

export {
	getProjectUsageRollup,
	getProviderCostRollup,
	getProjectBudgetStatus,
} from "./repo.js";
