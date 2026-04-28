// ---------------------------------------------------------------------------
// Control Plane — Usage/Cost Repository
// ---------------------------------------------------------------------------

import { query } from "../pg.js";

export interface UsageRollupRow {
	project_id: string;
	provider_id: string;
	task_count: string;
	token_input: string;
	token_output: string;
	total_tokens: string;
	cost_usd: string;
}

export async function getProjectUsageRollup(projectId: string, days = 30): Promise<UsageRollupRow[]> {
	return query<UsageRollupRow>(
		`SELECT
			project_id,
			agent_id as provider_id,
			COUNT(*) as task_count,
			SUM(input_tokens) as token_input,
			SUM(output_tokens) as token_output,
			SUM(total_tokens) as total_tokens,
			SUM(cost_usd) as cost_usd
		 FROM token_usage
		 WHERE project_id = $1 AND created_at >= now() - INTERVAL '${days} days'
		 GROUP BY project_id, agent_id`,
		[projectId],
	);
}

export async function getProviderCostRollup(days = 30): Promise<UsageRollupRow[]> {
	return query<UsageRollupRow>(
		`SELECT
			'' as project_id,
			agent_id as provider_id,
			COUNT(*) as task_count,
			SUM(input_tokens) as token_input,
			SUM(output_tokens) as token_output,
			SUM(total_tokens) as total_tokens,
			SUM(cost_usd) as cost_usd
		 FROM token_usage
		 WHERE created_at >= now() - INTERVAL '${days} days'
		 GROUP BY agent_id`,
	);
}

export async function getProjectBudgetStatus(projectId: string): Promise<{
	projectId: string;
	spentUsd: number;
	maxBudgetUsd: number | null;
	remainingUsd: number | null;
	alertFired: boolean;
} | undefined> {
	const [costRow] = await query<{ spent: string }>(
		"SELECT SUM(cost_usd) as spent FROM token_usage WHERE project_id = $1",
		[projectId],
	);
	const [settingsRow] = await query<{ budget: string }>(
		"SELECT value as budget FROM project_settings WHERE project_id = $1 AND key = 'budget.maxCostUsd'",
		[projectId],
	);
	const spent = Number(costRow?.spent ?? 0);
	const maxBudget = settingsRow?.budget ? Number.parseFloat(settingsRow.budget) : null;
	const remaining = maxBudget != null ? Math.max(0, maxBudget - spent) : null;
	return {
		projectId,
		spentUsd: spent,
		maxBudgetUsd: maxBudget,
		remainingUsd: remaining,
		alertFired: maxBudget != null ? spent >= maxBudget * 0.9 : false,
	};
}
