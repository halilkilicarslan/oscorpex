// ---------------------------------------------------------------------------
// Control Plane — Agent Registry Repository
// ---------------------------------------------------------------------------

import { execute, query, queryOne } from "../../pg.js";
import { randomUUID } from "node:crypto";

export interface AgentInstanceRow {
	id: string;
	name: string;
	role: string;
	status: string;
	project_id: string | null;
	registered_at: string;
	last_seen_at: string | null;
}

export interface ProviderRuntimeRow {
	id: string;
	name: string;
	type: string;
	status: string;
	last_health_check_at: string | null;
	cooldown_until: string | null;
	capabilities: string;
	created_at: string;
	updated_at: string;
}

export interface CapabilitySnapshotRow {
	id: string;
	provider_id: string;
	capabilities: string;
	recorded_at: string;
}

// ---- Agent Instances -------------------------------------------------------

export async function insertAgentInstance(data: {
	id?: string;
	name: string;
	role: string;
	status?: string;
	projectId?: string | null;
}): Promise<AgentInstanceRow> {
	const id = data.id ?? randomUUID();
	await execute(
		`INSERT INTO agent_instances (id, name, role, status, project_id)
     VALUES ($1, $2, $3, $4, $5)`,
		[id, data.name, data.role, data.status ?? "idle", data.projectId ?? null],
	);
	const row = await queryOne<AgentInstanceRow>("SELECT * FROM agent_instances WHERE id = $1", [id]);
	if (!row) throw new Error("insertAgentInstance failed");
	return row;
}

export async function updateAgentInstanceLastSeen(id: string): Promise<void> {
	await execute("UPDATE agent_instances SET last_seen_at = now() WHERE id = $1", [id]);
}

export async function updateAgentInstanceStatus(id: string, status: string): Promise<void> {
	await execute("UPDATE agent_instances SET status = $1 WHERE id = $2", [status, id]);
}

export async function listAgentInstances(projectId?: string): Promise<AgentInstanceRow[]> {
	if (projectId) {
		return query<AgentInstanceRow>("SELECT * FROM agent_instances WHERE project_id = $1 ORDER BY name", [projectId]);
	}
	return query<AgentInstanceRow>("SELECT * FROM agent_instances ORDER BY name");
}

export async function getAgentInstance(id: string): Promise<AgentInstanceRow | undefined> {
	return queryOne<AgentInstanceRow>("SELECT * FROM agent_instances WHERE id = $1", [id]) ?? undefined;
}

// ---- Provider Runtime Registry ---------------------------------------------

export async function upsertProviderRuntime(data: {
	id: string;
	name: string;
	type: string;
	status?: string;
	lastHealthCheckAt?: string | null;
	cooldownUntil?: string | null;
	capabilities?: string[];
}): Promise<ProviderRuntimeRow> {
	const caps = JSON.stringify(data.capabilities ?? []);
	await execute(
		`INSERT INTO provider_runtime_registry (id, name, type, status, last_health_check_at, cooldown_until, capabilities, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       type = EXCLUDED.type,
       status = EXCLUDED.status,
       last_health_check_at = EXCLUDED.last_health_check_at,
       cooldown_until = EXCLUDED.cooldown_until,
       capabilities = EXCLUDED.capabilities,
       updated_at = now()`,
		[
			data.id,
			data.name,
			data.type,
			data.status ?? "available",
			data.lastHealthCheckAt ?? null,
			data.cooldownUntil ?? null,
			caps,
		],
	);
	const row = await queryOne<ProviderRuntimeRow>("SELECT * FROM provider_runtime_registry WHERE id = $1", [data.id]);
	if (!row) throw new Error("upsertProviderRuntime failed");
	return row;
}

export async function listProviderRuntimes(): Promise<ProviderRuntimeRow[]> {
	return query<ProviderRuntimeRow>("SELECT * FROM provider_runtime_registry ORDER BY name");
}

export async function getProviderRuntime(id: string): Promise<ProviderRuntimeRow | undefined> {
	return queryOne<ProviderRuntimeRow>("SELECT * FROM provider_runtime_registry WHERE id = $1", [id]) ?? undefined;
}

// ---- Capability Snapshots --------------------------------------------------

export async function upsertCapabilitySnapshot(data: {
	id?: string;
	providerId: string;
	capabilities: string[];
}): Promise<CapabilitySnapshotRow> {
	const id = data.id ?? randomUUID();
	await execute(
		`INSERT INTO capability_snapshots (id, provider_id, capabilities)
     VALUES ($1, $2, $3)`,
		[id, data.providerId, JSON.stringify(data.capabilities)],
	);
	const row = await queryOne<CapabilitySnapshotRow>("SELECT * FROM capability_snapshots WHERE id = $1", [id]);
	if (!row) throw new Error("upsertCapabilitySnapshot failed");
	return row;
}

export async function listCapabilitySnapshots(providerId?: string): Promise<CapabilitySnapshotRow[]> {
	if (providerId) {
		return query<CapabilitySnapshotRow>(
			"SELECT * FROM capability_snapshots WHERE provider_id = $1 ORDER BY recorded_at DESC",
			[providerId],
		);
	}
	return query<CapabilitySnapshotRow>("SELECT * FROM capability_snapshots ORDER BY recorded_at DESC");
}
