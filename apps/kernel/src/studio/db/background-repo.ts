// Cross-tenant discovery for background work (watchdog, startup recovery) via SECURITY DEFINER sys_* functions.
// Callers run in system scope and then process each row inside its own tenant scope.

import { query } from "../pg.js";

export interface RunningProjectPhaseRef {
	projectId: string;
	phaseId: string;
	tenantId: string | null;
}

export interface RunningProjectRef {
	projectId: string;
	tenantId: string | null;
}

export async function listRunningProjectPhasesSys(): Promise<RunningProjectPhaseRef[]> {
	const rows = await query<{ project_id: string; phase_id: string; tenant_id: string | null }>(
		"SELECT project_id, phase_id, tenant_id FROM sys_running_project_phases()",
		[],
	);
	return rows.map((r) => ({ projectId: r.project_id, phaseId: r.phase_id, tenantId: r.tenant_id }));
}

export async function listRunningProjectsSys(): Promise<RunningProjectRef[]> {
	const rows = await query<{ project_id: string; tenant_id: string | null }>(
		"SELECT project_id, tenant_id FROM sys_running_projects()",
		[],
	);
	return rows.map((r) => ({ projectId: r.project_id, tenantId: r.tenant_id }));
}
