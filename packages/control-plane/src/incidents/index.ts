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

// Canonical contract types — aliased from row types
export type { IncidentRow as Incident } from "./repo.js";
export type { IncidentEventRow as IncidentEvent } from "./repo.js";
export {
	openIncident,
	ackIncident,
	resolveIncident,
	listIncidents,
	getIncident,
	appendIncidentEvent,
	assignIncident,
	addIncidentNote,
	updateIncidentSeverity,
	reopenIncident,
} from "./repo.js";
