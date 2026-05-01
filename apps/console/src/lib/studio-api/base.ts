export const BASE = import.meta.env.VITE_API_BASE ?? '';
export const API = `${BASE}/api/studio`;

/** Build auth headers — JWT token takes precedence over VITE_API_KEY */
function authHeaders(): Record<string, string> {
	// JWT token from localStorage (set by auth flow)
	const token = (typeof window !== 'undefined' && localStorage?.getItem)
		? localStorage.getItem('oscorpex_token')
		: null;
	if (token) return { Authorization: `Bearer ${token}` };
	// Fallback: static API key from env
	const key = import.meta.env.VITE_API_KEY;
	return key ? { Authorization: `Bearer ${key}` } : {};
}

export interface ApiError {
	status: number;
	message: string;
	body?: unknown;
}

export class StudioApiError extends Error {
	readonly status: number;
	readonly body?: unknown;

	constructor(message: string, status: number, body?: unknown) {
		super(message);
		this.name = 'StudioApiError';
		this.status = status;
		this.body = body;
	}
}

function notifyForbidden(message: string, status: number): void {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(
		new CustomEvent('studio:api:error', {
			detail: { status, message },
		}),
	);
}

/**
 * Central typed fetch for all studio API calls.
 *
 * Features:
 *   - Injects auth headers automatically
 *   - Parses JSON and validates HTTP status
 *   - Throws StudioApiError on non-2xx (with status + parsed body)
 *   - 401 responses throw so callers can redirect to login
 */
export async function studioFetch<T>(url: string, init?: RequestInit): Promise<T> {
	const headers = { ...authHeaders(), 'Content-Type': 'application/json', ...init?.headers };
	// Remove Content-Type for FormData / Blob bodies
	if (init?.body instanceof FormData || init?.body instanceof Blob) {
		delete (headers as Record<string, string>)['Content-Type'];
	}

	const res = await fetch(url, { ...init, headers }); // DIRECT_FETCH_INTENTIONAL: central low-level Studio API transport boundary.

	if (!res.ok) {
		const body = await res.json().catch(() => ({})) as { error?: string };
		const message = body.error ?? `HTTP ${res.status}`;
		if (res.status === 403) {
			notifyForbidden(message, res.status);
		}
		throw new StudioApiError(message, res.status, body);
	}

	// 204 No Content
	if (res.status === 204) {
		return undefined as T;
	}

	return res.json() as Promise<T>;
}

/** Shorthand: GET */
export function httpGet<T>(url: string, init?: Omit<RequestInit, 'method'>): Promise<T> {
	return studioFetch<T>(url, { ...init, method: 'GET' });
}

/** Shorthand: POST */
export function httpPost<T>(url: string, body?: unknown, init?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
	return studioFetch<T>(url, { ...init, method: 'POST', body: body ? JSON.stringify(body) : undefined });
}

/** Shorthand: PUT */
export function httpPut<T>(url: string, body?: unknown, init?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
	return studioFetch<T>(url, { ...init, method: 'PUT', body: body ? JSON.stringify(body) : undefined });
}

/** Shorthand: PATCH */
export function httpPatch<T>(url: string, body?: unknown, init?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
	return studioFetch<T>(url, { ...init, method: 'PATCH', body: body ? JSON.stringify(body) : undefined });
}

/** Shorthand: DELETE */
export function httpDelete<T>(url: string, init?: Omit<RequestInit, 'method'>): Promise<T> {
	return studioFetch<T>(url, { ...init, method: 'DELETE' });
}

/**
 * Extract a user-facing message from any error.
 * Prefers StudioApiError body, falls back to error.message, then generic text.
 */
export function getErrorMessage(err: unknown): string {
	if (err instanceof StudioApiError) {
		return err.message || `Request failed (${err.status})`;
	}
	if (err instanceof Error) {
		return err.message;
	}
	return String(err || 'An unexpected error occurred');
}

/** Legacy helper — kept for backward compat with existing modules */
export async function json<T>(url: string, init?: RequestInit): Promise<T> {
	return studioFetch<T>(url, init);
}

export interface PaginatedResult<T> {
	data: T[];
	total: number;
}

export async function fetchPaginated<T>(url: string, limit = 50, offset = 0): Promise<PaginatedResult<T>> {
	const sep = url.includes('?') ? '&' : '?';
	const fullUrl = `${url}${sep}limit=${limit}&offset=${offset}`;
	// X-Total-Count header is not available through studioFetch; keep manual for paginated
	const headers = { ...authHeaders() };
	const raw = await fetch(fullUrl, { headers }); // DIRECT_FETCH_INTENTIONAL: pagination helper must read X-Total-Count response header.
	if (!raw.ok) {
		const body = await raw.json().catch(() => ({}));
		throw new StudioApiError(body.error ?? `HTTP ${raw.status}`, raw.status, body);
	}
	const total = Number(raw.headers.get('X-Total-Count') ?? '0');
	const data = await raw.json() as T[];
	return { data, total };
}

/** Get auth headers for direct fetch calls outside json() */
export { authHeaders };
