// ---------------------------------------------------------------------------
// Security Audit Layer — Types, Repository, Service
// ---------------------------------------------------------------------------

export type AuditSeverity = "info" | "warning" | "high" | "critical";

export type AuditCategory =
	| "approval"
	| "provider"
	| "policy"
	| "replay"
	| "security"
	| "operator";

// Canonical contract types — aliased from row types
export type { AuditEventRow as AuditEvent } from "./repo.js";
export type { SecurityEventRow as SecurityEvent } from "./repo.js";
export {
	appendAuditEvent,
	listAuditEvents,
	appendSecurityEvent,
	listSecurityEvents,
} from "./repo.js";
