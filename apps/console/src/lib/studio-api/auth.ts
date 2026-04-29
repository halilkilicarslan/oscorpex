// ---------------------------------------------------------------------------
// Oscorpex — Auth API client
// ---------------------------------------------------------------------------

import { httpGet, httpPost, httpDelete, StudioApiError } from './base.js';

const AUTH_BASE = '/api/auth';

export interface AuthUser {
	id: string;
	email: string;
	displayName: string;
	tenantId: string;
	role: string;
}

export interface LoginResponse {
	token: string;
	user: AuthUser;
}

export interface RegisterData {
	email: string;
	password: string;
	displayName?: string;
	tenantName?: string;
}

export interface ApiKey {
	id: string;
	name: string;
	prefix: string;
	createdAt: string;
	lastUsedAt?: string;
}

export interface CreateApiKeyResponse {
	id: string;
	name: string;
	prefix: string;
	key: string;
	createdAt: string;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
	try {
		return await httpPost<LoginResponse>(`${AUTH_BASE}/login`, { email, password });
	} catch (err) {
		if (err instanceof StudioApiError) {
			throw new Error(err.message ?? `Login failed (${err.status})`);
		}
		throw err;
	}
}

export async function register(data: RegisterData): Promise<LoginResponse> {
	try {
		return await httpPost<LoginResponse>(`${AUTH_BASE}/register`, data);
	} catch (err) {
		if (err instanceof StudioApiError) {
			throw new Error(err.message ?? `Registration failed (${err.status})`);
		}
		throw err;
	}
}

export async function fetchCurrentUser(token: string): Promise<AuthUser> {
	const headers: Record<string, string> = {};
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}
	try {
		return await httpGet<AuthUser>(`${AUTH_BASE}/me`, { headers });
	} catch (err) {
		if (err instanceof StudioApiError) {
			throw new Error(err.message ?? 'Not authenticated');
		}
		throw err;
	}
}

export async function fetchAuthUsers(token: string): Promise<AuthUser[]> {
	try {
		return await httpGet<AuthUser[]>(`${AUTH_BASE}/users`, {
			headers: { Authorization: `Bearer ${token}` },
		});
	} catch (err) {
		if (err instanceof StudioApiError) {
			throw new Error(err.message ?? 'Failed to fetch users');
		}
		throw err;
	}
}

export async function createApiKey(token: string, name: string): Promise<CreateApiKeyResponse> {
	try {
		return await httpPost<CreateApiKeyResponse>(`${AUTH_BASE}/api-keys`, { name }, {
			headers: { Authorization: `Bearer ${token}` },
		});
	} catch (err) {
		if (err instanceof StudioApiError) {
			throw new Error(err.message ?? `Failed to create API key (${err.status})`);
		}
		throw err;
	}
}

export async function listApiKeys(token: string): Promise<ApiKey[]> {
	try {
		return await httpGet<ApiKey[]>(`${AUTH_BASE}/api-keys`, {
			headers: { Authorization: `Bearer ${token}` },
		});
	} catch (err) {
		if (err instanceof StudioApiError) {
			throw new Error(err.message ?? 'Failed to fetch API keys');
		}
		throw err;
	}
}

export async function revokeApiKey(token: string, id: string): Promise<void> {
	try {
		await httpDelete(`${AUTH_BASE}/api-keys/${id}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
	} catch (err) {
		if (err instanceof StudioApiError) {
			throw new Error(err.message ?? 'Failed to revoke API key');
		}
		throw err;
	}
}
