// ---------------------------------------------------------------------------
// Control Plane — Audit Repository
// ---------------------------------------------------------------------------

import { execute, query, queryOne } from "../pg.js";
import { randomUUID } from "node:crypto";

export interface AuditEventRow {
	id: string;
	project_id: string | null;
	category: string;
	severity: string;
	actor: string;
	action: string;
	details: string;
	created_at: string;
}

export interface SecurityEventRow {
	id: string;
	project_id: string | null;
	event_type: string;
	severity: string;
	payload: string;
	created_at: string;
}

export async function appendAuditEvent(data: {
	projectId?: string | null;
	category: string;
	severity?: string;
	actor?: string;
	action: string;
	details?: Record<string, unknown>;
}): Promise<AuditEventRow> {
	const id = randomUUID();
	await execute(
		`INSERT INTO audit_events (id, project_id, category, severity, actor, action, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[id, data.projectId ?? null, data.category, data.severity ?? "info", data.actor ?? "system", data.action, JSON.stringify(data.details ?? {})],
	);
	const row = await queryOne<AuditEventRow>("SELECT * FROM audit_events WHERE id = $1", [id]);
	if (!row) throw new Error("appendAuditEvent failed");
	return row;
}

export async function listAuditEvents(filters?: {
	category?: string;
	severity?: string;
	actor?: string;
	projectId?: string;
	limit?: number;
}): Promise<AuditEventRow[]> {
	const conditions: string[] = [];
	const params: unknown[] = [];
	if (filters?.category) { conditions.push(`category = $${params.length + 1}`); params.push(filters.category); }
	if (filters?.severity) { conditions.push(`severity = $${params.length + 1}`); params.push(filters.severity); }
	if (filters?.actor) { conditions.push(`actor = $${params.length + 1}`); params.push(filters.actor); }
	if (filters?.projectId) { conditions.push(`project_id = $${params.length + 1}`); params.push(filters.projectId); }
	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const limit = filters?.limit ?? 100;
	return query<AuditEventRow>(`SELECT * FROM audit_events ${where} ORDER BY created_at DESC LIMIT ${limit}`, params);
}

export async function appendSecurityEvent(data: {
	projectId?: string | null;
	eventType: string;
	severity?: string;
	payload?: Record<string, unknown>;
}): Promise<SecurityEventRow> {
	const id = randomUUID();
	await execute(
		`INSERT INTO security_events (id, project_id, event_type, severity, payload)
     VALUES ($1, $2, $3, $4, $5)`,
		[id, data.projectId ?? null, data.eventType, data.severity ?? "warning", JSON.stringify(data.payload ?? {})],
	);
	const row = await queryOne<SecurityEventRow>("SELECT * FROM security_events WHERE id = $1", [id]);
	if (!row) throw new Error("appendSecurityEvent failed");
	return row;
}

export async function listSecurityEvents(filters?: {
	severity?: string;
	eventType?: string;
	projectId?: string;
	limit?: number;
}): Promise<SecurityEventRow[]> {
	const conditions: string[] = [];
	const params: unknown[] = [];
	if (filters?.severity) { conditions.push(`severity = $${params.length + 1}`); params.push(filters.severity); }
	if (filters?.eventType) { conditions.push(`event_type = $${params.length + 1}`); params.push(filters.eventType); }
	if (filters?.projectId) { conditions.push(`project_id = $${params.length + 1}`); params.push(filters.projectId); }
	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const limit = filters?.limit ?? 100;
	return query<SecurityEventRow>(`SELECT * FROM security_events ${where} ORDER BY created_at DESC LIMIT ${limit}`, params);
}
