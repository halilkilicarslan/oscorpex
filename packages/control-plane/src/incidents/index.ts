// ---------------------------------------------------------------------------
// Minimal Incident Feed — Types, Repository, Service
// ---------------------------------------------------------------------------

export type IncidentStatus = "open" | "acknowledged" | "resolved";

export type IncidentType =
	| "degraded"
	| "repeated_timeout"
	| "queue_pressure"
	| "approval_blocked"
	| "provider_cooldown"
	| "stuck_task";

export interface Incident {
	id: string;
	projectId: string | null;
	type: IncidentType;
	status: IncidentStatus;
	title: string;
	description: string;
	severity: "warning" | "high" | "critical";
	acknowledgedBy: string | null;
	resolvedBy: string | null;
	createdAt: string;
	acknowledgedAt: string | null;
	resolvedAt: string | null;
}

export interface IncidentEvent {
	id: string;
	incidentId: string;
	eventType: "opened" | "acknowledged" | "resolved" | "updated";
	actor: string;
	payload: Record<string, unknown>;
	createdAt: string;
}
