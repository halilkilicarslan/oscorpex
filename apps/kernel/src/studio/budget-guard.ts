// ---------------------------------------------------------------------------
// Oscorpex — Cost Circuit Breaker (Budget Guard)
// Prevents runaway cost escalation by auto-pausing pipeline on budget breach.
// Budget caps stored in project_settings category='budget'.
// ---------------------------------------------------------------------------

import { queryOne } from "./db.js";
import { eventBus } from "./event-bus.js";
import { createLogger } from "./logger.js";
const log = createLogger("budget-guard");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetCheck {
	totalSpentUsd: number;
	budgetMaxUsd: number | null;
	exceeded: boolean;
}

// ---------------------------------------------------------------------------
// Budget check (atomic)
// ---------------------------------------------------------------------------

/**
 * Check if project spend exceeds the configured budget cap.
 * Budget cap is stored in project_settings: category='budget', key='maxCostUsd'
 * (fallback: 'max_usd').
 *
 * Uses a single atomic query so there is no window between reading spend and
 * reading limit — prevents TOCTOU race under concurrent token recording.
 */
export async function checkBudget(projectId: string): Promise<BudgetCheck> {
	const row = await queryOne<{ total_spent: string; max_budget: string | null }>(
		`WITH budget AS (
			SELECT value FROM project_settings
			WHERE project_id = $1
			  AND category = 'budget'
			  AND key IN ('maxCostUsd', 'max_usd')
			ORDER BY CASE key WHEN 'maxCostUsd' THEN 0 ELSE 1 END
			LIMIT 1
		)
		SELECT
			COALESCE(SUM(tu.cost_usd), 0) AS total_spent,
			(SELECT value FROM budget) AS max_budget
		FROM token_usage tu
		WHERE tu.project_id = $1`,
		[projectId],
	);

	const totalSpentUsd = Number(row?.total_spent ?? 0);
	const rawBudget = row?.max_budget ?? null;
	const budgetMaxUsd = rawBudget ? Number(rawBudget) : null;

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

	log.warn(
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
		await pipelineEngine().pausePipeline(projectId);
	} catch (err) {
		log.error("[budget-guard] Failed to pause pipeline after budget breach:" + " " + String(err));
	}

	return true;
}
