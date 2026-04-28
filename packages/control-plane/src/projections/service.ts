// ---------------------------------------------------------------------------
// Control Plane — Dashboard Projections Service
// ---------------------------------------------------------------------------

import { query } from "../pg.ts";

export interface ControlPlaneSummary {
	pendingApprovals: number;
	activeAgents: number;
	cooldownProviders: number;
	openIncidents: number;
	projectsOverBudget: number;
	lastUpdatedAt: string;
}

export async function getControlPlaneSummary(): Promise<ControlPlaneSummary> {
	const [pendingApprovals, activeAgents, cooldownProviders, openIncidents, projectsOverBudget] = await Promise.all([
		query<{ n: string }>("SELECT COUNT(*) as n FROM approvals WHERE status = 'pending'"),
		query<{ n: string }>("SELECT COUNT(*) as n FROM agent_instances WHERE status = 'active'"),
		query<{ n: string }>("SELECT COUNT(*) as n FROM provider_runtime_registry WHERE status = 'cooldown'"),
		query<{ n: string }>("SELECT COUNT(*) as n FROM incidents WHERE status IN ('open','acknowledged')"),
		getProjectsOverBudget(),
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

async function getProjectsOverBudget(): Promise<number> {
	const rows = await query<{ project_id: string; value: string }>(
		"SELECT project_id, value FROM project_settings WHERE category = 'budget' AND key = 'max_usd'",
	);
	let overBudget = 0;
	for (const r of rows) {
		const maxBudget = Number(r.value);
		if (!isNaN(maxBudget) && maxBudget > 0) {
			const costRow = await query<{ n: string }>(
				"SELECT COALESCE(SUM(cost_usd), 0) as n FROM usage_telemetry WHERE project_id = $1",
				[r.project_id],
			);
			if (costRow[0] && Number(costRow[0].n) >= maxBudget) overBudget++;
		}
	}
	return overBudget;
}

export interface ApprovalSummary {
	pendingCount: number;
	expiredCount: number;
	escalatedCount: number;
	byKind: Record<string, number>;
}

export async function getApprovalSummary(): Promise<ApprovalSummary> {
	const [pending, expired, escalated] = await Promise.all([
		query<{ n: string }>("SELECT COUNT(*) as n FROM approvals WHERE status = 'pending'"),
		query<{ n: string }>("SELECT COUNT(*) as n FROM approvals WHERE status = 'expired'"),
		query<{ n: string }>("SELECT COUNT(*) as n FROM approvals WHERE status = 'escalated'"),
	]);
	const byKindRows = await query<{ kind: string; n: string }>(
		"SELECT kind, COUNT(*) as n FROM approvals WHERE status = 'pending' GROUP BY kind",
	);
	const byKind: Record<string, number> = {};
	for (const r of byKindRows) {
		byKind[r.kind] = Number(r.n);
	}
	return {
		pendingCount: Number(pending[0]?.n ?? 0),
		expiredCount: Number(expired[0]?.n ?? 0),
		escalatedCount: Number(escalated[0]?.n ?? 0),
		byKind,
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

export async function getQueueHealth(): Promise<QueueHealth> {
	const [pausedFlag, queued, dispatching, failedToday] = await Promise.all([
		query<{ value: string }>("SELECT value FROM operator_flags WHERE key = 'queue-paused'"),
		query<{ n: string }>("SELECT COUNT(*) as n FROM tasks WHERE status = 'queued'"),
		query<{ n: string }>("SELECT COUNT(*) as n FROM tasks WHERE status = 'running'"),
		query<{ n: string }>("SELECT COUNT(*) as n FROM tasks WHERE status = 'failed' AND completed_at > now() - INTERVAL '24 hours'"),
	]);

	return {
		paused: pausedFlag[0]?.value === "true",
		queuedCount: Number(queued[0]?.n ?? 0),
		dispatchingCount: Number(dispatching[0]?.n ?? 0),
		failedToday: Number(failedToday[0]?.n ?? 0),
	};
}
