// ---------------------------------------------------------------------------
// Control Plane — Presence Repository
// ---------------------------------------------------------------------------

import { execute, query, queryOne } from "../pg.ts";
import { randomUUID } from "node:crypto";

export interface AgentPresenceRow {
	agent_id: string;
	state: string;
	last_heartbeat_at: string | null;
	payload: string;
	updated_at: string;
}

export interface RuntimeHeartbeatRow {
	id: string;
	agent_id: string | null;
	provider_id: string | null;
	project_id: string | null;
	state: string;
	payload: string;
	recorded_at: string;
}

// ---- Agent Presence --------------------------------------------------------

export async function upsertAgentPresence(data: {
	agentId: string;
	state: string;
	lastHeartbeatAt?: string;
	payload?: Record<string, unknown>;
}): Promise<void> {
	await execute(
		`INSERT INTO agent_presence (agent_id, state, last_heartbeat_at, payload, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (agent_id) DO UPDATE SET
       state = EXCLUDED.state,
       last_heartbeat_at = EXCLUDED.last_heartbeat_at,
       payload = EXCLUDED.payload,
       updated_at = now()`,
		[data.agentId, data.state, data.lastHeartbeatAt ?? null, JSON.stringify(data.payload ?? {})],
	);
}

export async function listAgentPresence(): Promise<AgentPresenceRow[]> {
	return query<AgentPresenceRow>("SELECT * FROM agent_presence ORDER BY updated_at DESC");
}

export async function getAgentPresence(agentId: string): Promise<AgentPresenceRow | undefined> {
	return queryOne<AgentPresenceRow>("SELECT * FROM agent_presence WHERE agent_id = $1", [agentId]) ?? undefined;
}

// ---- Runtime Heartbeats ----------------------------------------------------

export async function insertRuntimeHeartbeat(data: {
	id?: string;
	agentId?: string | null;
	providerId?: string | null;
	projectId?: string | null;
	state: string;
	payload?: Record<string, unknown>;
}): Promise<RuntimeHeartbeatRow> {
	const id = data.id ?? randomUUID();
	await execute(
		`INSERT INTO runtime_heartbeats (id, agent_id, provider_id, project_id, state, payload, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
		[id, data.agentId ?? null, data.providerId ?? null, data.projectId ?? null, data.state, JSON.stringify(data.payload ?? {})],
	);
	const row = await queryOne<RuntimeHeartbeatRow>("SELECT * FROM runtime_heartbeats WHERE id = $1", [id]);
	if (!row) throw new Error("insertRuntimeHeartbeat failed");
	return row;
}

export async function listRuntimeHeartbeats(agentId?: string, providerId?: string): Promise<RuntimeHeartbeatRow[]> {
	if (agentId) {
		return query<RuntimeHeartbeatRow>(
			"SELECT * FROM runtime_heartbeats WHERE agent_id = $1 ORDER BY recorded_at DESC LIMIT 100",
			[agentId],
		);
	}
	if (providerId) {
		return query<RuntimeHeartbeatRow>(
			"SELECT * FROM runtime_heartbeats WHERE provider_id = $1 ORDER BY recorded_at DESC LIMIT 100",
			[providerId],
		);
	}
	return query<RuntimeHeartbeatRow>("SELECT * FROM runtime_heartbeats ORDER BY recorded_at DESC LIMIT 100");
}

export async function getLatestHeartbeat(agentId?: string, providerId?: string): Promise<RuntimeHeartbeatRow | undefined> {
	if (agentId) {
		return queryOne<RuntimeHeartbeatRow>(
			"SELECT * FROM runtime_heartbeats WHERE agent_id = $1 ORDER BY recorded_at DESC LIMIT 1",
			[agentId],
		) ?? undefined;
	}
	if (providerId) {
		return queryOne<RuntimeHeartbeatRow>(
			"SELECT * FROM runtime_heartbeats WHERE provider_id = $1 ORDER BY recorded_at DESC LIMIT 1",
			[providerId],
		) ?? undefined;
	}
	return undefined;
}
