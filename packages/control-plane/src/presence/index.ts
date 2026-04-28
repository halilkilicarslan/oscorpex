// ---------------------------------------------------------------------------
// Heartbeat / Presence — Types, Repository, Service
// ---------------------------------------------------------------------------

export type PresenceState = "online" | "degraded" | "cooldown" | "offline" | "unknown";

export interface HeartbeatRecord {
	agentId: string;
	providerId: string | null;
	projectId: string | null;
	state: PresenceState;
	payload: Record<string, unknown>;
	recordedAt: string;
}

export type { PresenceSummary } from "./service.js";
export {
	recordHeartbeat,
	markAgentOffline,
	computePresenceState,
	listPresence,
	getAgentHeartbeats,
	getProviderHeartbeats,
} from "./service.js";
