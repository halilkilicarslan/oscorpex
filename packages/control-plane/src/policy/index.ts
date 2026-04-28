// ---------------------------------------------------------------------------
// Policy Surface — Explainability & Visibility
// ---------------------------------------------------------------------------

import { query, queryOne } from "../pg.ts";

export interface PolicyProfile {
	projectId: string;
	profile: string;
	modelRouting: Record<string, unknown>;
	updatedAt: string;
}

export interface BudgetStatus {
	projectId: string;
	maxBudgetUsd: number | null;
	spentUsd: number;
	remainingUsd: number | null;
	alertFired: boolean;
	alertThreshold: number;
}

export interface PolicyDecision {
	id: string;
	projectId: string;
	taskId: string | null;
	agentId: string | null;
	action: string;
	allowed: boolean;
	reasons: string[];
	violations: string[];
	policyVersion: string;
	createdAt: string;
}

export interface PolicySummary {
	projectId: string;
	activeProfile: string | null;
	budget: BudgetStatus | null;
	recentDecisions: PolicyDecision[];
	lastUpdatedAt: string;
}
