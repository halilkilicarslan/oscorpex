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
	// Same precedence as budget-guard.ts: maxCostUsd preferred over max_usd.
	const row = await queryOne<{ value: string }>(
		`SELECT value FROM project_settings
		 WHERE project_id = $1 AND category = 'budget' AND key IN ('maxCostUsd', 'max_usd')
		 ORDER BY CASE key WHEN 'maxCostUsd' THEN 0 ELSE 1 END LIMIT 1`,
		[projectId],
	);

	const parsed = row ? Number(row.value) : null;
	const maxBudgetUsd = parsed !== null && !Number.isNaN(parsed) ? parsed : null;

	const costRow = await queryOne<{ total_cost: string }>(
		`SELECT COALESCE(SUM(cost_usd), 0) AS total_cost FROM token_usage WHERE project_id = $1`,
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
	// replay_snapshots.run_id holds a runs.id, or the projectId itself as a fallback (replay-store) — never a
	// pipeline_runs.id. The project id is already ownership-checked by the caller's route.
	const rows = await query<{
		id: string;
		project_id: string;
		policy_decisions_json: string;
		created_at: string;
	}>(
		`SELECT rs.id, $1::text AS project_id, rs.policy_decisions_json, rs.created_at FROM replay_snapshots rs
		 WHERE rs.policy_decisions_json IS NOT NULL
		   AND (rs.run_id = $1 OR rs.run_id IN (SELECT r.id FROM runs r WHERE r.project_id = $1))
		 ORDER BY rs.created_at DESC LIMIT $2`,
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

export async function getGlobalPolicySummary(tenantId: string): Promise<{
	projectCount: number;
	projectsWithBudget: number;
	projectsOverBudget: number;
	activeProfiles: Record<string, number>;
}> {
	// Explicit tenant filter via JOIN projects: holds even when RLS is bypassed (superuser mode).
	const profileRows = await query<{ value: string }>(
		`SELECT s.value FROM project_settings s JOIN projects p ON p.id = s.project_id AND p.tenant_id = $1
		 WHERE s.category = 'model_routing' AND s.key = 'provider_policy_profile'`,
		[tenantId],
	);
	// One row per project, maxCostUsd preferred over max_usd (budget-guard.ts).
	const budget = await queryOne<{ with_budget: string; over_budget: string }>(
		`SELECT COUNT(*) AS with_budget,
		        COUNT(*) FILTER (WHERE b.max_usd > 0 AND b.spent >= b.max_usd) AS over_budget
		 FROM (
		   SELECT DISTINCT ON (s.project_id) s.project_id,
		          CASE WHEN s.value ~ '^[0-9]+(\\.[0-9]+)?$' THEN s.value::numeric ELSE 0 END AS max_usd,
		          (SELECT COALESCE(SUM(t.cost_usd), 0) FROM token_usage t WHERE t.project_id = s.project_id) AS spent
		   FROM project_settings s
		   JOIN projects p ON p.id = s.project_id AND p.tenant_id = $1
		   WHERE s.category = 'budget' AND s.key IN ('maxCostUsd', 'max_usd')
		   ORDER BY s.project_id, CASE s.key WHEN 'maxCostUsd' THEN 0 ELSE 1 END
		 ) b`,
		[tenantId],
	);

	const activeProfiles: Record<string, number> = {};
	for (const r of profileRows) {
		activeProfiles[r.value] = (activeProfiles[r.value] ?? 0) + 1;
	}

	return {
		projectCount: profileRows.length,
		projectsWithBudget: Number(budget?.with_budget ?? 0),
		projectsOverBudget: Number(budget?.over_budget ?? 0),
		activeProfiles,
	};
}
