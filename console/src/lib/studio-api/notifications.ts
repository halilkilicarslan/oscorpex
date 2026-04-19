// ---------------------------------------------------------------------------
// Oscorpex — Notifications API Client (V6 M1)
// ---------------------------------------------------------------------------

import { API, json } from './base.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppNotification {
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
// API functions
// ---------------------------------------------------------------------------

export async function fetchNotifications(opts?: {
	projectId?: string;
	unreadOnly?: boolean;
	limit?: number;
	offset?: number;
}): Promise<AppNotification[]> {
	const params = new URLSearchParams();
	if (opts?.projectId) params.set('projectId', opts.projectId);
	if (opts?.unreadOnly) params.set('unreadOnly', 'true');
	if (opts?.limit != null) params.set('limit', String(opts.limit));
	if (opts?.offset != null) params.set('offset', String(opts.offset));
	const qs = params.toString() ? `?${params.toString()}` : '';
	return json<AppNotification[]>(`${API}/notifications${qs}`);
}

export async function fetchUnreadNotificationCount(projectId?: string): Promise<number> {
	const params = new URLSearchParams();
	if (projectId) params.set('projectId', projectId);
	const qs = params.toString() ? `?${params.toString()}` : '';
	const res = await json<{ count: number }>(`${API}/notifications/unread-count${qs}`);
	return res.count;
}

export async function markNotificationRead(id: string): Promise<void> {
	await json<{ ok: boolean }>(`${API}/notifications/${id}/read`, { method: 'PATCH' });
}

export async function markAllNotificationsRead(projectId?: string): Promise<void> {
	const params = new URLSearchParams();
	if (projectId) params.set('projectId', projectId);
	const qs = params.toString() ? `?${params.toString()}` : '';
	await json<{ ok: boolean }>(`${API}/notifications/mark-all-read${qs}`, { method: 'POST' });
}

export async function deleteNotification(id: string): Promise<void> {
	await json<{ ok: boolean }>(`${API}/notifications/${id}`, { method: 'DELETE' });
}
