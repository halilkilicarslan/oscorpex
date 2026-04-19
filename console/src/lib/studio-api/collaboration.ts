// ---------------------------------------------------------------------------
// Oscorpex — Collaboration API Client (V6 M6 F11)
// ---------------------------------------------------------------------------

import { API, json } from './base.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserPresence {
	userId: string;
	displayName: string;
	avatar?: string;
	projectId: string;
	activeTab?: string;
	lastSeen: number;
	color: string;
}

export interface CollaborationStats {
	totalActiveUsers: number;
	projectsWithUsers: number;
}

export interface JoinRequest {
	projectId: string;
	userId: string;
	displayName: string;
	avatar?: string;
	activeTab?: string;
}

export interface LeaveRequest {
	projectId: string;
	userId: string;
}

export interface HeartbeatRequest {
	projectId: string;
	userId: string;
}

export interface UpdatePresenceRequest {
	projectId: string;
	userId: string;
	activeTab?: string;
	displayName?: string;
	avatar?: string;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

/** Join a project — registers presence and returns assigned color. */
export async function joinProject(data: JoinRequest): Promise<{ ok: boolean; presence: UserPresence }> {
	return json(`${API}/collaboration/join`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	});
}

/** Leave a project — removes presence entry. */
export async function leaveProject(data: LeaveRequest): Promise<{ ok: boolean; removed: boolean }> {
	return json(`${API}/collaboration/leave`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	});
}

/** Send a heartbeat to keep presence alive. Returns rejoin=true if session expired. */
export async function sendHeartbeat(data: HeartbeatRequest): Promise<{ ok: boolean; rejoin?: boolean }> {
	return json(`${API}/collaboration/heartbeat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	});
}

/** Update presence data (active tab, display name, avatar). */
export async function updatePresence(data: UpdatePresenceRequest): Promise<{ ok: boolean; presence: UserPresence }> {
	return json(`${API}/collaboration/presence`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	});
}

/** Fetch all active users in a project. */
export async function fetchPresence(projectId: string): Promise<UserPresence[]> {
	return json(`${API}/collaboration/presence/${encodeURIComponent(projectId)}`);
}

/** Fetch global collaboration stats. */
export async function fetchCollaborationStats(): Promise<CollaborationStats> {
	return json(`${API}/collaboration/stats`);
}
