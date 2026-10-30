// ---------------------------------------------------------------------------
// Control Plane — Dashboard Projections Service
// ---------------------------------------------------------------------------

import { query, queryOne } from "../pg.js";

export interface ControlPlaneSummary {
	pendingApprovals: number;
	activeAgents: number;
	cooldownProviders: number;
	openIncidents: number;
	projectsOverBudget: number;
	lastUpdatedAt: string;
}

export async function getControlPlaneSummary(tenantId: string): Promise<ControlPlaneSummary> {
	// Explicit JOIN projects: the tenant filter holds even when RLS is bypassed (superuser mode). Rows with a
	// NULL project_id never join, so they are not counted.
	const [pendingApprovals, activeAgents, cooldownProviders, openIncidents, projectsOverBudget] = await Promise.all([
		query<{ n: string }>(
			"SELECT COUNT(*) as n FROM approvals x JOIN projects p ON p.id = x.project_id AND p.tenant_id = $1 WHERE x.status = 'pending'",
			[tenantId],
		),
		query<{ n: string }>(
			"SELECT COUNT(*) as n FROM agent_instances x JOIN projects p ON p.id = x.project_id AND p.tenant_id = $1 WHERE x.status = 'active'",
			[tenantId],
		),
		query<{ n: string }>("SELECT COUNT(*) as n FROM provider_runtime_registry WHERE status = 'cooldown'"),
		query<{ n: string }>(
			"SELECT COUNT(*) as n FROM incidents x JOIN projects p ON p.id = x.project_id AND p.tenant_id = $1 WHERE x.status IN ('open','acknowledged')",
			[tenantId],
		),
		getProjectsOverBudget(tenantId),
	]);

	return {
		pendingApprovals: Number(pendingApprovals[0]?.n ?? 0),
		activeAgents: Number(activeAgents[0]?.n ?? 0),
		cooldownProviders: Number(cooldownProviders[0]?.n ?? 0),
		openIncidents: Number(openIncidents[0]?.n ?? 0),
		projectsOverBudget,
		lastUpdatedAt: new Date().toISOString(),
	};
}

async function getProjectsOverBudget(tenantId: string): Promise<number> {
	// Mirrors budget-guard.ts: one budget row per project, maxCostUsd preferred over max_usd.
	const rows = await query<{ n: string }>(
		`SELECT COUNT(*) AS n FROM (
		   SELECT DISTINCT ON (s.project_id) s.project_id,
		          CASE WHEN s.value ~ '^[0-9]+(\\.[0-9]+)?$' THEN s.value::numeric ELSE 0 END AS max_usd
		   FROM project_settings s
		   JOIN projects p ON p.id = s.project_id AND p.tenant_id = $1
		   WHERE s.category = 'budget' AND s.key IN ('maxCostUsd', 'max_usd')
		   ORDER BY s.project_id, CASE s.key WHEN 'maxCostUsd' THEN 0 ELSE 1 END
		 ) b
		 WHERE b.max_usd > 0
		   AND (SELECT COALESCE(SUM(t.cost_usd), 0) FROM token_usage t WHERE t.project_id = b.project_id) >= b.max_usd`,
		[tenantId],
	);
	return Number(rows[0]?.n ?? 0);
}

export interface ApprovalSummary {
	pendingCount: number;
	expiredCount: number;
	escalatedCount: number;
	byKind: Record<string, number>;
}

export async function getApprovalSummary(tenantId: string): Promise<ApprovalSummary> {
	const rows = await query<{ status: string; kind: string; n: string }>(
		`SELECT x.status, x.kind, COUNT(*) as n FROM approvals x
		 JOIN projects p ON p.id = x.project_id AND p.tenant_id = $1
		 WHERE x.status IN ('pending','expired','escalated') GROUP BY x.status, x.kind`,
		[tenantId],
	);
	const totals: Record<string, number> = { pending: 0, expired: 0, escalated: 0 };
	const byKind: Record<string, number> = {};
	for (const r of rows) {
		totals[r.status] += Number(r.n);
		if (r.status === "pending") byKind[r.kind] = Number(r.n);
	}
	return {
		pendingCount: totals.pending,
		expiredCount: totals.expired,
		escalatedCount: totals.escalated,
		byKind,
	};
}

export interface PlatformControlPlaneSummary {
	pendingApprovals: number;
	expiredApprovals: number;
	escalatedApprovals: number;
	activeAgents: number;
	openIncidents: number;
	projectsOverBudget: number;
}

/** Platform-wide aggregates from sys_control_plane_summary() (SECURITY DEFINER). Callers run in system scope. */
// Platform totals include rows with a NULL project_id, which tenant totals exclude.
export async function getPlatformControlPlaneSummary(): Promise<PlatformControlPlaneSummary> {
	const row = await queryOne<{ s: Record<string, number> }>("SELECT sys_control_plane_summary() AS s");
	const s = row?.s ?? {};
	return {
		pendingApprovals: Number(s.pending_approvals ?? 0),
		expiredApprovals: Number(s.expired_approvals ?? 0),
		escalatedApprovals: Number(s.escalated_approvals ?? 0),
		activeAgents: Number(s.active_agents ?? 0),
		openIncidents: Number(s.open_incidents ?? 0),
		projectsOverBudget: Number(s.projects_over_budget ?? 0),
	};
}

export interface RuntimeHealthSummary {
	onlineCount: number;
	degradedCount: number;
	cooldownCount: number;
	offlineCount: number;
	providerDetails: Array<{ providerId: string; state: string; lastSeenAt: string | null }>;
}

export async function getRuntimeHealthSummary(): Promise<RuntimeHealthSummary> {
	const rows = await query<{ id: string; status: string; last_health_check_at: string | null }>(
		"SELECT id, status, last_health_check_at FROM provider_runtime_registry",
	);
	let online = 0, degraded = 0, cooldown = 0, offline = 0;
	const details: RuntimeHealthSummary["providerDetails"] = [];
	for (const r of rows) {
		switch (r.status) {
			case "available": online++; break;
			case "degraded": degraded++; break;
			case "cooldown": cooldown++; break;
			default: offline++; break;
		}
		details.push({ providerId: r.id, state: r.status, lastSeenAt: r.last_health_check_at });
	}
	return { onlineCount: online, degradedCount: degraded, cooldownCount: cooldown, offlineCount: offline, providerDetails: details };
}

// ---------------------------------------------------------------------------
// Provider Ops Panel
// ---------------------------------------------------------------------------

export interface ProviderOpsDetail {
	providerId: string;
	name: string;
	state: string;
	consecutiveFailures: number;
	cooldownRemainingMinutes: number | null;
	lastHealthCheckAt: string | null;
}

export async function getProviderOps(): Promise<ProviderOpsDetail[]> {
	const rows = await query<{
		id: string;
		name: string;
		status: string;
		cooldown_until: string | null;
		last_health_check_at: string | null;
	}>("SELECT id, name, status, cooldown_until, last_health_check_at FROM provider_runtime_registry ORDER BY name");

	const result: ProviderOpsDetail[] = [];
	for (const r of rows) {
		// Get consecutive failures from provider_state
		const stateRow = await query<{ consecutive_failures: string }>(
			"SELECT consecutive_failures FROM provider_state WHERE adapter = $1",
			[r.id],
		);
		const failures = stateRow[0] ? Number(stateRow[0].consecutive_failures) : 0;

		let cooldownRemaining: number | null = null;
		if (r.cooldown_until) {
			const remaining = new Date(r.cooldown_until).getTime() - Date.now();
			cooldownRemaining = remaining > 0 ? Math.ceil(remaining / 60_000) : 0;
		}

		result.push({
			providerId: r.id,
			name: r.name,
			state: r.status,
			consecutiveFailures: failures,
			cooldownRemainingMinutes: cooldownRemaining,
			lastHealthCheckAt: r.last_health_check_at,
		});
	}
	return result;
}

// ---------------------------------------------------------------------------
// Queue Governance
// ---------------------------------------------------------------------------

export interface QueueHealth {
	paused: boolean;
	queuedCount: number;
	dispatchingCount: number;
	failedToday: number;
}

export async function getQueueHealth(tenantId: string): Promise<QueueHealth> {
	const [pausedFlag, queued, dispatching, failedToday] = await Promise.all([
		query<{ value: string }>("SELECT value FROM operator_flags WHERE key = 'queue-paused'"),
		query<{ n: string }>("SELECT COUNT(*) as n FROM tasks WHERE tenant_id = $1 AND status = 'queued'", [tenantId]),
		query<{ n: string }>("SELECT COUNT(*) as n FROM tasks WHERE tenant_id = $1 AND status = 'running'", [tenantId]),
		query<{ n: string }>(
			"SELECT COUNT(*) as n FROM tasks WHERE tenant_id = $1 AND status = 'failed' AND completed_at > now() - INTERVAL '24 hours'",
			[tenantId],
		),
	]);

	return {
		paused: pausedFlag[0]?.value === "true",
		queuedCount: Number(queued[0]?.n ?? 0),
		dispatchingCount: Number(dispatching[0]?.n ?? 0),
		failedToday: Number(failedToday[0]?.n ?? 0),
	};
}
