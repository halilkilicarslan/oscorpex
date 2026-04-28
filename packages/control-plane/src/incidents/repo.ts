// ---------------------------------------------------------------------------
// Control Plane — Incident Repository
// ---------------------------------------------------------------------------

import { execute, query, queryOne } from "../pg.ts";
import { randomUUID } from "node:crypto";

export interface IncidentRow {
	id: string;
	project_id: string | null;
	type: string;
	status: string;
	title: string;
	description: string;
	severity: string;
	acknowledged_by: string | null;
	resolved_by: string | null;
	created_at: string;
	acknowledged_at: string | null;
	resolved_at: string | null;
	assignee: string | null;
	resolution_note: string;
	linked_task_id: string | null;
	linked_run_id: string | null;
}

export interface IncidentEventRow {
	id: string;
	incident_id: string;
	event_type: string;
	actor: string;
	payload: string;
	created_at: string;
}

export async function openIncident(data: {
	id?: string;
	projectId?: string | null;
	type: string;
	title: string;
	description?: string;
	severity?: string;
}): Promise<IncidentRow> {
	const id = data.id ?? randomUUID();
	await execute(
		`INSERT INTO incidents (id, project_id, type, title, description, severity)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
		[id, data.projectId ?? null, data.type, data.title, data.description ?? "", data.severity ?? "warning"],
	);
	const row = await queryOne<IncidentRow>("SELECT * FROM incidents WHERE id = $1", [id]);
	if (!row) throw new Error("openIncident failed or duplicate");
	return row;
}

export async function ackIncident(id: string, actor: string): Promise<IncidentRow | undefined> {
	await execute(
		"UPDATE incidents SET status = 'acknowledged', acknowledged_by = $1, acknowledged_at = now() WHERE id = $2",
		[actor, id],
	);
	return queryOne<IncidentRow>("SELECT * FROM incidents WHERE id = $1", [id]) ?? undefined;
}

export async function resolveIncident(id: string, actor: string): Promise<IncidentRow | undefined> {
	await execute(
		"UPDATE incidents SET status = 'resolved', resolved_by = $1, resolved_at = now() WHERE id = $2",
		[actor, id],
	);
	return queryOne<IncidentRow>("SELECT * FROM incidents WHERE id = $1", [id]) ?? undefined;
}

export async function listIncidents(status?: string): Promise<IncidentRow[]> {
	if (status) {
		return query<IncidentRow>("SELECT * FROM incidents WHERE status = $1 ORDER BY created_at DESC", [status]);
	}
	return query<IncidentRow>("SELECT * FROM incidents ORDER BY created_at DESC");
}

export async function getIncident(id: string): Promise<IncidentRow | undefined> {
	return queryOne<IncidentRow>("SELECT * FROM incidents WHERE id = $1", [id]) ?? undefined;
}

export async function assignIncident(id: string, assignee: string, actor: string): Promise<IncidentRow | undefined> {
	await execute("UPDATE incidents SET assignee = $1 WHERE id = $2", [assignee, id]);
	await appendIncidentEvent({ incidentId: id, eventType: "assigned", actor, payload: { assignee } });
	return getIncident(id);
}

export async function addIncidentNote(id: string, note: string, actor: string): Promise<IncidentRow | undefined> {
	await execute("UPDATE incidents SET resolution_note = resolution_note || '\n' || $1 WHERE id = $2", [note, id]);
	await appendIncidentEvent({ incidentId: id, eventType: "note", actor, payload: { note } });
	return getIncident(id);
}

export async function updateIncidentSeverity(id: string, severity: string, actor: string): Promise<IncidentRow | undefined> {
	await execute("UPDATE incidents SET severity = $1 WHERE id = $2", [severity, id]);
	await appendIncidentEvent({ incidentId: id, eventType: "severity_updated", actor, payload: { severity } });
	return getIncident(id);
}

export async function reopenIncident(id: string, actor: string, reason?: string): Promise<IncidentRow | undefined> {
	await execute(
		"UPDATE incidents SET status = 'open', resolved_by = NULL, resolved_at = NULL WHERE id = $1",
		[id],
	);
	await appendIncidentEvent({ incidentId: id, eventType: "reopened", actor, payload: { reason } });
	return getIncident(id);
}

export async function appendIncidentEvent(data: {
	incidentId: string;
	eventType: string;
	actor?: string;
	payload?: Record<string, unknown>;
}): Promise<IncidentEventRow> {
	const id = randomUUID();
	await execute(
		`INSERT INTO incident_events (id, incident_id, event_type, actor, payload)
     VALUES ($1, $2, $3, $4, $5)`,
		[id, data.incidentId, data.eventType, data.actor ?? "", JSON.stringify(data.payload ?? {})],
	);
	const row = await queryOne<IncidentEventRow>("SELECT * FROM incident_events WHERE id = $1", [id]);
	if (!row) throw new Error("appendIncidentEvent failed");
	return row;
}
