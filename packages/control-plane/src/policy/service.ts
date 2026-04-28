// ---------------------------------------------------------------------------
// Policy Surface — Service
// ---------------------------------------------------------------------------

import { query, queryOne } from "../pg.js";
import type { PolicySummary, PolicyProfile, BudgetStatus, PolicyDecision } from "./index.js";

export { type PolicySummary, type PolicyProfile, type BudgetStatus, type PolicyDecision };

export async function getProjectPolicySummary(projectId: string): Promise<PolicySummary> {
	const [profile, budget, decisions] = await Promise.all([
		getProjectPolicyProfile(projectId),
		getProjectBudgetStatus(projectId),
		getRecentPolicyDecisions(projectId, 10),
	]);

	return {
		projectId,
		activeProfile: profile?.profile ?? null,
		budget: budget ?? null,
		recentDecisions: decisions,
		lastUpdatedAt: new Date().toISOString(),
	};
}

export async function getProjectPolicyProfile(projectId: string): Promise<PolicyProfile | undefined> {
	const row = await queryOne<{
		project_id: string;
		value: string;
		updated_at: string;
	}>(
		`SELECT project_id, value, updated_at FROM project_settings
		 WHERE project_id = $1 AND category = 'model_routing' AND key = 'provider_policy_profile'`,
		[projectId],
	);
	if (!row) return undefined;
	return {
		projectId: row.project_id,
		profile: row.value,
		modelRouting: {}, // Simplified — full routing config is in project_settings
		updatedAt: row.updated_at,
	};
}

export async function getProjectBudgetStatus(projectId: string): Promise<BudgetStatus | undefined> {
	const row = await queryOne<{
		project_id: string;
		value: string;
		updated_at: string;
	}>(
		`SELECT project_id, value, updated_at FROM project_settings
		 WHERE project_id = $1 AND category = 'budget' AND key = 'max_usd'`,
		[projectId],
	);

	const maxBudgetUsd = row ? Number(row.value) : null;

	// Aggregate cost from usage telemetry
	const costRow = await queryOne<{ total_cost: string }>(
		`SELECT COALESCE(SUM(cost_usd), 0) AS total_cost FROM usage_telemetry WHERE project_id = $1`,
		[projectId],
	);
	const spentUsd = costRow ? Number(costRow.total_cost) : 0;

	return {
		projectId,
		maxBudgetUsd,
		spentUsd,
		remainingUsd: maxBudgetUsd !== null ? Math.max(0, maxBudgetUsd - spentUsd) : null,
		alertFired: maxBudgetUsd !== null ? spentUsd >= maxBudgetUsd * 0.8 : false,
		alertThreshold: 0.8,
	};
}

export async function getRecentPolicyDecisions(projectId: string, limit = 10): Promise<PolicyDecision[]> {
	// Policy decisions are stored in replay_snapshots.policy_decisions_json
	// This is a simplified query that extracts recent decisions
	const rows = await query<{
		id: string;
		project_id: string;
		policy_decisions_json: string;
		created_at: string;
	}>(
		`SELECT id, project_id, policy_decisions_json, created_at FROM replay_snapshots
		 WHERE project_id = $1 AND policy_decisions_json IS NOT NULL
		 ORDER BY created_at DESC LIMIT $2`,
		[projectId, limit],
	);

	const decisions: PolicyDecision[] = [];
	for (const row of rows) {
		try {
			const arr = JSON.parse(row.policy_decisions_json) as Array<Record<string, unknown>>;
			for (const d of arr.slice(0, 3)) {
				decisions.push({
					id: `${row.id}-${decisions.length}`,
					projectId: row.project_id,
					taskId: (d.taskId as string) ?? null,
					agentId: (d.agentId as string) ?? null,
					action: (d.action as string) ?? "unknown",
					allowed: (d.allowed as boolean) ?? false,
					reasons: Array.isArray(d.reasons) ? (d.reasons as string[]) : [],
					violations: Array.isArray(d.violations) ? (d.violations as string[]) : [],
					policyVersion: (d.policyVersion as string) ?? "unknown",
					createdAt: row.created_at,
				});
			}
		} catch { /* skip malformed */ }
	}
	return decisions;
}

export async function getGlobalPolicySummary(): Promise<{
	projectCount: number;
	projectsWithBudget: number;
	projectsOverBudget: number;
	activeProfiles: Record<string, number>;
}> {
	const profileRows = await query<{ value: string }>(
		`SELECT value FROM project_settings WHERE category = 'model_routing' AND key = 'provider_policy_profile'`,
	);
	const budgetRows = await query<{ project_id: string; value: string }>(
		`SELECT project_id, value FROM project_settings WHERE category = 'budget' AND key = 'max_usd'`,
	);

	const activeProfiles: Record<string, number> = {};
	for (const r of profileRows) {
		activeProfiles[r.value] = (activeProfiles[r.value] ?? 0) + 1;
	}

	let projectsOverBudget = 0;
	for (const r of budgetRows) {
		const maxBudget = Number(r.value);
		if (!isNaN(maxBudget) && maxBudget > 0) {
			const costRow = await queryOne<{ total_cost: string }>(
				`SELECT COALESCE(SUM(cost_usd), 0) AS total_cost FROM usage_telemetry WHERE project_id = $1`,
				[r.project_id],
			);
			if (costRow && Number(costRow.total_cost) >= maxBudget) {
				projectsOverBudget++;
			}
		}
	}

	return {
		projectCount: profileRows.length,
		projectsWithBudget: budgetRows.length,
		projectsOverBudget,
		activeProfiles,
	};
}
