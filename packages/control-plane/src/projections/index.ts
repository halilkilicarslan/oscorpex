// ---------------------------------------------------------------------------
// Dashboard Projections (Minimal) — Types, Service
// ---------------------------------------------------------------------------

export interface ControlPlaneSummary {
	pendingApprovals: number;
	activeAgents: number;
	cooldownProviders: number;
	openIncidents: number;
	projectsOverBudget: number;
	lastUpdatedAt: string;
}

export interface ApprovalSummary {
	pendingCount: number;
	expiredCount: number;
	escalatedCount: number;
	byKind: Record<string, number>;
}

export interface RuntimeHealthSummary {
	onlineCount: number;
	degradedCount: number;
	cooldownCount: number;
	offlineCount: number;
	providerDetails: Array<{
		providerId: string;
		state: string;
		lastSeenAt: string | null;
	}>;
}

export interface CostSummary {
	projectId: string;
	totalCostUsd: number;
	budgetPercentUsed: number | null;
	providerBreakdown: Array<{ providerId: string; costUsd: number }>;
}
