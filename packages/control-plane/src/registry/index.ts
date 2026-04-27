// ---------------------------------------------------------------------------
// Agent Registry — Types, Repository, Service
// ---------------------------------------------------------------------------

export interface AgentInstance {
	id: string;
	name: string;
	role: string;
	status: "active" | "idle" | "disabled";
	projectId: string | null;
	registeredAt: string;
	lastSeenAt: string | null;
}

export interface ProviderRuntime {
	id: string;
	name: string;
	type: "claude" | "codex" | "cursor" | "custom";
	status: "available" | "unavailable" | "cooldown" | "degraded";
	lastHealthCheckAt: string | null;
	cooldownUntil: string | null;
	capabilities: string[];
}

export interface CapabilitySnapshot {
	providerId: string;
	capabilities: string[];
	recordedAt: string;
}
