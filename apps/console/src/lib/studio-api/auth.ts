// ---------------------------------------------------------------------------
// Oscorpex — Auth API client
// ---------------------------------------------------------------------------

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
	const res = await fetch(`${AUTH_BASE}/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password }),
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({})) as { error?: string };
		throw new Error(err.error ?? `Login failed (${res.status})`);
	}
	return res.json() as Promise<LoginResponse>;
}

export async function register(data: RegisterData): Promise<LoginResponse> {
	const res = await fetch(`${AUTH_BASE}/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({})) as { error?: string };
		throw new Error(err.error ?? `Registration failed (${res.status})`);
	}
	return res.json() as Promise<LoginResponse>;
}

export async function fetchCurrentUser(token: string): Promise<AuthUser> {
	const headers: Record<string, string> = {};
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}
	const res = await fetch(`${AUTH_BASE}/me`, { headers });
	if (!res.ok) throw new Error('Not authenticated');
	return res.json() as Promise<AuthUser>;
}

export async function fetchAuthUsers(token: string): Promise<AuthUser[]> {
	const res = await fetch(`${AUTH_BASE}/users`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!res.ok) throw new Error('Failed to fetch users');
	return res.json() as Promise<AuthUser[]>;
}

export async function createApiKey(token: string, name: string): Promise<CreateApiKeyResponse> {
	const res = await fetch(`${AUTH_BASE}/api-keys`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ name }),
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({})) as { error?: string };
		throw new Error(err.error ?? `Failed to create API key (${res.status})`);
	}
	return res.json() as Promise<CreateApiKeyResponse>;
}

export async function listApiKeys(token: string): Promise<ApiKey[]> {
	const res = await fetch(`${AUTH_BASE}/api-keys`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!res.ok) throw new Error('Failed to fetch API keys');
	return res.json() as Promise<ApiKey[]>;
}

export async function revokeApiKey(token: string, id: string): Promise<void> {
	const res = await fetch(`${AUTH_BASE}/api-keys/${id}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!res.ok) throw new Error('Failed to revoke API key');
}
