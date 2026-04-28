// ---------------------------------------------------------------------------
// Control Plane — Presence Service
// ---------------------------------------------------------------------------

import {
	upsertAgentPresence,
	listAgentPresence,
	getAgentPresence,
	insertRuntimeHeartbeat,
	listRuntimeHeartbeats,
	getLatestHeartbeat,
	 type AgentPresenceRow,
	 type RuntimeHeartbeatRow,
} from "./repo.js";
import type { PresenceState } from "./index.js";

const STALE_THRESHOLD_MS = 60_000; // 60 seconds

export interface PresenceSummary {
	agentId: string;
	state: PresenceState;
	lastHeartbeatAt: string | null;
	stale: boolean;
}

function computeState(row: { state: string; last_heartbeat_at: string | null }): PresenceState {
	const last = row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : 0;
	const stale = Date.now() - last > STALE_THRESHOLD_MS;
	if (stale) return "offline";
	return (row.state as PresenceState) ?? "unknown";
}

export async function recordHeartbeat(data: {
	agentId?: string;
	providerId?: string;
	projectId?: string;
	state: PresenceState;
	payload?: Record<string, unknown>;
}): Promise<RuntimeHeartbeatRow> {
	const hb = await insertRuntimeHeartbeat(data);
	if (data.agentId) {
		await upsertAgentPresence({
			agentId: data.agentId,
			state: data.state,
			lastHeartbeatAt: hb.recorded_at,
			payload: data.payload,
		});
	}
	return hb;
}

export async function markAgentOffline(agentId: string): Promise<void> {
	await upsertAgentPresence({
		agentId,
		state: "offline",
		lastHeartbeatAt: new Date().toISOString(),
	});
}

export async function computePresenceState(agentId: string): Promise<PresenceSummary> {
	const row = await getAgentPresence(agentId);
	if (!row) {
		return { agentId, state: "unknown", lastHeartbeatAt: null, stale: true };
	}
	const last = row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : 0;
	const stale = Date.now() - last > STALE_THRESHOLD_MS;
	const state = stale ? "offline" : (row.state as PresenceState);
	return { agentId, state, lastHeartbeatAt: row.last_heartbeat_at, stale };
}

export async function listPresence(): Promise<PresenceSummary[]> {
	const rows = await listAgentPresence();
	return rows.map((r) => {
		const last = r.last_heartbeat_at ? new Date(r.last_heartbeat_at).getTime() : 0;
		const stale = Date.now() - last > STALE_THRESHOLD_MS;
		const state = stale ? "offline" : (r.state as PresenceState);
		return { agentId: r.agent_id, state, lastHeartbeatAt: r.last_heartbeat_at, stale };
	});
}

export async function getAgentHeartbeats(agentId: string): Promise<RuntimeHeartbeatRow[]> {
	return listRuntimeHeartbeats(agentId);
}

export async function getProviderHeartbeats(providerId: string): Promise<RuntimeHeartbeatRow[]> {
	return listRuntimeHeartbeats(undefined, providerId);
}
