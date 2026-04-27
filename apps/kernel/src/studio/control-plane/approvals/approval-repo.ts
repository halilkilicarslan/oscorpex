// ---------------------------------------------------------------------------
// Control Plane — Approval Repository
// ---------------------------------------------------------------------------

import { execute, query, queryOne } from "../../pg.js";
import { randomUUID } from "node:crypto";

export interface ApprovalRow {
	id: string;
	project_id: string | null;
	kind: string;
	status: string;
	title: string;
	description: string;
	requested_by: string;
	approved_by: string | null;
	rejected_by: string | null;
	created_at: string;
	resolved_at: string | null;
	expires_at: string;
}

export interface ApprovalEventRow {
	id: string;
	approval_id: string;
	event_type: string;
	actor: string;
	payload: string;
	created_at: string;
}

export async function createApproval(data: {
	id?: string;
	projectId?: string | null;
	kind: string;
	title: string;
	description?: string;
	requestedBy?: string;
	expiresAt?: string;
}): Promise<ApprovalRow> {
	const id = data.id ?? randomUUID();
	const expires = data.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
	await execute(
		`INSERT INTO approvals (id, project_id, kind, title, description, requested_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[id, data.projectId ?? null, data.kind, data.title, data.description ?? "", data.requestedBy ?? "", expires],
	);
	const row = await queryOne<ApprovalRow>("SELECT * FROM approvals WHERE id = $1", [id]);
	if (!row) throw new Error("createApproval failed");
	return row;
}

export async function getApproval(id: string): Promise<ApprovalRow | undefined> {
	return queryOne<ApprovalRow>("SELECT * FROM approvals WHERE id = $1", [id]) ?? undefined;
}

export async function listPendingApprovals(): Promise<ApprovalRow[]> {
	return query<ApprovalRow>("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at DESC");
}

export async function listApprovals(status?: string): Promise<ApprovalRow[]> {
	if (status) {
		return query<ApprovalRow>("SELECT * FROM approvals WHERE status = $1 ORDER BY created_at DESC", [status]);
	}
	return query<ApprovalRow>("SELECT * FROM approvals ORDER BY created_at DESC");
}

export async function approveApproval(id: string, actor: string): Promise<ApprovalRow | undefined> {
	await execute(
		"UPDATE approvals SET status = 'approved', approved_by = $1, resolved_at = now() WHERE id = $2",
		[actor, id],
	);
	return getApproval(id);
}

export async function rejectApproval(id: string, actor: string): Promise<ApprovalRow | undefined> {
	await execute(
		"UPDATE approvals SET status = 'rejected', rejected_by = $1, resolved_at = now() WHERE id = $2",
		[actor, id],
	);
	return getApproval(id);
}

export async function expireApproval(id: string): Promise<ApprovalRow | undefined> {
	await execute("UPDATE approvals SET status = 'expired', resolved_at = now() WHERE id = $1", [id]);
	return getApproval(id);
}

export async function appendApprovalEvent(data: {
	approvalId: string;
	eventType: string;
	actor?: string;
	payload?: Record<string, unknown>;
}): Promise<ApprovalEventRow> {
	const id = randomUUID();
	await execute(
		`INSERT INTO approval_events (id, approval_id, event_type, actor, payload)
     VALUES ($1, $2, $3, $4, $5)`,
		[id, data.approvalId, data.eventType, data.actor ?? "", JSON.stringify(data.payload ?? {})],
	);
	const row = await queryOne<ApprovalEventRow>("SELECT * FROM approval_events WHERE id = $1", [id]);
	if (!row) throw new Error("appendApprovalEvent failed");
	return row;
}

export async function listApprovalEvents(approvalId: string): Promise<ApprovalEventRow[]> {
	return query<ApprovalEventRow>("SELECT * FROM approval_events WHERE approval_id = $1 ORDER BY created_at DESC", [
		approvalId,
	]);
}

export async function listExpiredApprovals(): Promise<ApprovalRow[]> {
	return query<ApprovalRow>("SELECT * FROM approvals WHERE status = 'pending' AND expires_at <= now()");
}
