// ---------------------------------------------------------------------------
// CLI API Client — native fetch, API key header, base URL resolution
// ---------------------------------------------------------------------------

export interface ApiClientOptions {
	apiUrl: string;
	apiKey?: string;
}

export interface ApiError {
	status: number;
	message: string;
	body?: unknown;
}

function buildHeaders(apiKey?: string): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Accept: "application/json",
	};
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}
	return headers;
}

async function parseResponse<T>(res: Response): Promise<T> {
	const contentType = res.headers.get("content-type") ?? "";
	const isJson = contentType.includes("application/json");

	if (!res.ok) {
		let message = `HTTP ${res.status} ${res.statusText}`;
		if (isJson) {
			try {
				const body = (await res.json()) as Record<string, unknown>;
				message = (body.error as string) ?? (body.message as string) ?? message;
			} catch {
				// ignore parse error
			}
		}
		const err: ApiError = { status: res.status, message };
		throw err;
	}

	if (isJson) {
		return res.json() as Promise<T>;
	}
	return res.text() as unknown as T;
}

export async function apiGet<T>(path: string, opts: ApiClientOptions): Promise<T> {
	const url = `${opts.apiUrl}/api/studio${path}`;
	let res: Response;
	try {
		res = await fetch(url, {
			method: "GET",
			headers: buildHeaders(opts.apiKey),
		});
	} catch (cause) {
		const err: ApiError = {
			status: 0,
			message: `Cannot connect to API at ${opts.apiUrl}. Is the server running?`,
		};
		throw err;
	}
	return parseResponse<T>(res);
}

export async function apiPost<T>(path: string, body: unknown, opts: ApiClientOptions): Promise<T> {
	const url = `${opts.apiUrl}/api/studio${path}`;
	let res: Response;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: buildHeaders(opts.apiKey),
			body: JSON.stringify(body),
		});
	} catch (cause) {
		const err: ApiError = {
			status: 0,
			message: `Cannot connect to API at ${opts.apiUrl}. Is the server running?`,
		};
		throw err;
	}
	return parseResponse<T>(res);
}

/** Human-readable error message from an ApiError or unknown value */
export function formatApiError(err: unknown): string {
	if (err && typeof err === "object" && "message" in err) {
		return (err as ApiError).message;
	}
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
}
