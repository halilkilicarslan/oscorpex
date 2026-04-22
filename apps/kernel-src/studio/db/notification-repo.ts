// ---------------------------------------------------------------------------
// Oscorpex — Notification Repo (V6 M1)
// CRUD for in-app notifications.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import { createLogger } from "../logger.js";
const log = createLogger("notification-repo");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Notification {
	id: string;
	tenantId: string | null;
	userId: string | null;
	projectId: string;
	type: string;
	title: string;
	body: string;
	read: boolean;
	data: Record<string, unknown>;
	createdAt: string;
}

// ---------------------------------------------------------------------------
// Row → Model mapper
// ---------------------------------------------------------------------------

function rowToNotification(row: Record<string, unknown>): Notification {
	return {
		id: row.id as string,
		tenantId: (row.tenant_id as string | null) ?? null,
		userId: (row.user_id as string | null) ?? null,
		projectId: row.project_id as string,
		type: row.type as string,
		title: row.title as string,
		body: (row.body as string) ?? "",
		read: Boolean(row.read),
		data: (row.data as Record<string, unknown>) ?? {},
		createdAt: row.created_at as string,
	};
}

// ---------------------------------------------------------------------------
// createNotification
// ---------------------------------------------------------------------------

export async function createNotification(
	data: Omit<Notification, "id" | "read" | "createdAt">,
): Promise<Notification> {
	const id = randomUUID();
	const row = await queryOne<Record<string, unknown>>(
		`INSERT INTO notifications (id, tenant_id, user_id, project_id, type, title, body, data)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING *`,
		[id, data.tenantId ?? null, data.userId ?? null, data.projectId, data.type, data.title, data.body ?? "", data.data ?? {}],
	);
	if (!row) throw new Error("notification insert returned no row");
	return rowToNotification(row);
}

// ---------------------------------------------------------------------------
// listNotifications
// ---------------------------------------------------------------------------

export interface ListNotificationsOpts {
	userId?: string;
	projectId?: string;
	unreadOnly?: boolean;
	limit?: number;
	offset?: number;
}

export async function listNotifications(opts: ListNotificationsOpts = {}): Promise<Notification[]> {
	const { userId, projectId, unreadOnly = false, limit = 50, offset = 0 } = opts;
	const conditions: string[] = [];
	const params: unknown[] = [];
	let idx = 1;

	if (userId) {
		conditions.push(`user_id = $${idx++}`);
		params.push(userId);
	}
	if (projectId) {
		conditions.push(`project_id = $${idx++}`);
		params.push(projectId);
	}
	if (unreadOnly) {
		conditions.push(`read = false`);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	params.push(limit, offset);

	const rows = await query<Record<string, unknown>>(
		`SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
		params,
	);
	return rows.map(rowToNotification);
}

// ---------------------------------------------------------------------------
// countUnread
// ---------------------------------------------------------------------------

export interface CountUnreadOpts {
	userId?: string;
	projectId?: string;
}

export async function countUnread(opts: CountUnreadOpts = {}): Promise<number> {
	const { userId, projectId } = opts;
	const conditions: string[] = ["read = false"];
	const params: unknown[] = [];
	let idx = 1;

	if (userId) {
		conditions.push(`user_id = $${idx++}`);
		params.push(userId);
	}
	if (projectId) {
		conditions.push(`project_id = $${idx++}`);
		params.push(projectId);
	}

	const where = `WHERE ${conditions.join(" AND ")}`;
	const row = await queryOne<{ count: string }>(
		`SELECT COUNT(*) AS count FROM notifications ${where}`,
		params,
	);
	return Number(row?.count ?? 0);
}

// ---------------------------------------------------------------------------
// markAsRead
// ---------------------------------------------------------------------------

export async function markNotificationAsRead(id: string): Promise<void> {
	await execute(`UPDATE notifications SET read = true WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// markAllAsRead
// ---------------------------------------------------------------------------

export interface MarkAllAsReadOpts {
	userId?: string;
	projectId?: string;
}

export async function markAllNotificationsAsRead(opts: MarkAllAsReadOpts = {}): Promise<void> {
	const { userId, projectId } = opts;
	const conditions: string[] = ["read = false"];
	const params: unknown[] = [];
	let idx = 1;

	if (userId) {
		conditions.push(`user_id = $${idx++}`);
		params.push(userId);
	}
	if (projectId) {
		conditions.push(`project_id = $${idx++}`);
		params.push(projectId);
	}

	const where = `WHERE ${conditions.join(" AND ")}`;
	await execute(`UPDATE notifications SET read = true ${where}`, params);
}

// ---------------------------------------------------------------------------
// deleteNotification
// ---------------------------------------------------------------------------

export async function deleteNotification(id: string): Promise<void> {
	await execute(`DELETE FROM notifications WHERE id = $1`, [id]);
}
