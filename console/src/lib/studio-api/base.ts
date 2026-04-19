export const BASE = import.meta.env.VITE_API_BASE ?? '';
export const API = `${BASE}/api/studio`;

/** Build auth headers when VITE_API_KEY is configured */
function authHeaders(): Record<string, string> {
	const key = import.meta.env.VITE_API_KEY;
	return key ? { Authorization: `Bearer ${key}` } : {};
}

export async function json<T>(url: string, init?: RequestInit): Promise<T> {
	const headers = { ...authHeaders(), ...init?.headers };
	const res = await fetch(url, { ...init, headers });
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body.error ?? `HTTP ${res.status}`);
	}
	return res.json();
}

export interface PaginatedResult<T> {
	data: T[];
	total: number;
}

export async function fetchPaginated<T>(url: string, limit = 50, offset = 0): Promise<PaginatedResult<T>> {
	const sep = url.includes('?') ? '&' : '?';
	const fullUrl = `${url}${sep}limit=${limit}&offset=${offset}`;
	const headers = { ...authHeaders() };
	const res = await fetch(fullUrl, { headers });
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body.error ?? `HTTP ${res.status}`);
	}
	const total = Number(res.headers.get('X-Total-Count') ?? '0');
	const data = await res.json() as T[];
	return { data, total };
}

/** Get auth headers for direct fetch calls outside json() */
export { authHeaders };
