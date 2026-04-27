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

export interface AuditEvent {
	id: string;
	projectId: string | null;
	category: AuditCategory;
	severity: AuditSeverity;
	actor: string;
	action: string;
	details: Record<string, unknown>;
	createdAt: string;
}

export interface SecurityEvent {
	id: string;
	projectId: string | null;
	eventType: string;
	severity: AuditSeverity;
	payload: Record<string, unknown>;
	createdAt: string;
}
