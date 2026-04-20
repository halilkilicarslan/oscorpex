// ---------------------------------------------------------------------------
// Oscorpex — Cost Circuit Breaker (Budget Guard)
// Prevents runaway cost escalation by auto-pausing pipeline on budget breach.
// Budget caps stored in project_settings category='budget'.
// ---------------------------------------------------------------------------

import { getProjectSetting, queryOne } from "./db.js";
import { eventBus } from "./event-bus.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetCheck {
	totalSpentUsd: number;
	budgetMaxUsd: number | null;
	exceeded: boolean;
}

// ---------------------------------------------------------------------------
// Cost queries
// ---------------------------------------------------------------------------

/** Get total project spend from token_usage table */
async function getProjectSpend(projectId: string): Promise<number> {
	const row = await queryOne<{ total: string }>(
		`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM token_usage WHERE project_id = $1`,
		[projectId],
	);
	return Number(row?.total ?? 0);
}

// ---------------------------------------------------------------------------
// Budget check
// ---------------------------------------------------------------------------

/**
 * Check if project spend exceeds the configured budget cap.
 * Budget cap is stored in project_settings: category='budget', key='max_usd'.
 * Returns the check result — caller decides whether to pause.
 */
export async function checkBudget(projectId: string): Promise<BudgetCheck> {
	const [totalSpentUsd, maxUsdStr] = await Promise.all([
		getProjectSpend(projectId),
		getProjectSetting(projectId, "budget", "max_usd"),
	]);

	const budgetMaxUsd = maxUsdStr ? Number(maxUsdStr) : null;

	if (budgetMaxUsd === null || Number.isNaN(budgetMaxUsd)) {
		return { totalSpentUsd, budgetMaxUsd: null, exceeded: false };
	}

	return {
		totalSpentUsd,
		budgetMaxUsd,
		exceeded: totalSpentUsd >= budgetMaxUsd,
	};
}

/**
 * Check budget and auto-pause pipeline if exceeded.
 * Called after token usage is recorded. Returns true if budget was exceeded.
 */
export async function enforceBudgetGuard(projectId: string): Promise<boolean> {
	const check = await checkBudget(projectId);
	if (!check.exceeded) return false;

	console.warn(
		`[budget-guard] Budget exceeded for project ${projectId}: $${check.totalSpentUsd.toFixed(2)} >= $${check.budgetMaxUsd?.toFixed(2)}`,
	);

	eventBus.emit({
		projectId,
		type: "budget:halted",
		payload: {
			totalSpentUsd: check.totalSpentUsd,
			budgetMaxUsd: check.budgetMaxUsd,
			message: `Project budget exceeded: $${check.totalSpentUsd.toFixed(2)} / $${check.budgetMaxUsd?.toFixed(2)}. Pipeline paused.`,
		},
	});

	// Auto-pause the pipeline
	try {
		const { pipelineEngine } = await import("./pipeline-engine.js");
		await pipelineEngine.pausePipeline(projectId);
	} catch (err) {
		console.error("[budget-guard] Failed to pause pipeline after budget breach:", err);
	}

	return true;
}
