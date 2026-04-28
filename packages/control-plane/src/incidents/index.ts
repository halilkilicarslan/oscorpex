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
export type { IncidentRow as Incident } from "./repo.ts";
export type { IncidentEventRow as IncidentEvent } from "./repo.ts";
