// ---------------------------------------------------------------------------
// Control Plane — Approval Repository
// ---------------------------------------------------------------------------

import { execute, query, queryOne } from "../pg.js";
import { randomUUID } from "node:crypto";

/** Visibility scope: tenant's project-bound approvals; project-less ones (project_id NULL) only when includeProjectless. */
export interface ApprovalScope {
	tenantId: string;
	includeProjectless?: boolean;
}

function scopeClause(scope: ApprovalScope, param: string): string {
	const bound = `project_id IN (SELECT id FROM projects WHERE tenant_id = ${param})`;
	return scope.includeProjectless ? `(${bound} OR project_id IS NULL)` : bound;
}

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
	escalated: boolean;
	escalation_target: string | null;
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

/** Optional tenantId restricts the lookup to approvals of that tenant's projects (approvals without a project are not visible). */
export async function getApproval(id: string, scope?: ApprovalScope): Promise<ApprovalRow | undefined> {
	if (scope) {
		return queryOne<ApprovalRow>(`SELECT * FROM approvals WHERE id = $1 AND ${scopeClause(scope, "$2")}`, [
			id,
			scope.tenantId,
		]);
	}
	return queryOne<ApprovalRow>("SELECT * FROM approvals WHERE id = $1", [id]);
}

export async function listPendingApprovals(): Promise<ApprovalRow[]> {
	return query<ApprovalRow>("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at DESC");
}

export async function listApprovals(status?: string, scope?: ApprovalScope): Promise<ApprovalRow[]> {
	const where: string[] = [];
	const params: unknown[] = [];
	if (status) {
		params.push(status);
		where.push(`status = $${params.length}`);
	}
	if (scope) {
		params.push(scope.tenantId);
		where.push(scopeClause(scope, `$${params.length}`));
	}
	const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
	return query<ApprovalRow>(`SELECT * FROM approvals${clause} ORDER BY created_at DESC`, params);
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

export async function listExpiredApprovals(scope?: ApprovalScope): Promise<ApprovalRow[]> {
	if (scope) {
		return query<ApprovalRow>(
			`SELECT * FROM approvals WHERE status = 'pending' AND expires_at <= now() AND ${scopeClause(scope, "$1")}`,
			[scope.tenantId],
		);
	}
	return query<ApprovalRow>("SELECT * FROM approvals WHERE status = 'pending' AND expires_at <= now()");
}
