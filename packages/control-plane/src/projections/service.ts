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
	const [pendingApprovals, activeAgents, cooldownProviders, openIncidents] = await Promise.all([
		query<{ n: string }>("SELECT COUNT(*) as n FROM approvals WHERE status = 'pending'"),
		query<{ n: string }>("SELECT COUNT(*) as n FROM agent_instances WHERE status = 'active'"),
		query<{ n: string }>("SELECT COUNT(*) as n FROM provider_runtime_registry WHERE status = 'cooldown'"),
		query<{ n: string }>("SELECT COUNT(*) as n FROM incidents WHERE status IN ('open','acknowledged')"),
	]);

	return {
		pendingApprovals: Number(pendingApprovals[0]?.n ?? 0),
		activeAgents: Number(activeAgents[0]?.n ?? 0),
		cooldownProviders: Number(cooldownProviders[0]?.n ?? 0),
		openIncidents: Number(openIncidents[0]?.n ?? 0),
		projectsOverBudget: 0, // calculated via budget service
		lastUpdatedAt: new Date().toISOString(),
	};
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
