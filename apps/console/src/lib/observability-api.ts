import { httpDelete, httpGet, httpPost, httpPut } from './studio-api/base.js';

export const OBSERVABILITY_API = '/api/observability';

export function observabilityGet<T>(path: string): Promise<T> {
	return httpGet<T>(`${OBSERVABILITY_API}${path}`);
}

export function observabilityPost<T>(path: string, body?: unknown): Promise<T> {
	return httpPost<T>(`${OBSERVABILITY_API}${path}`, body);
}

export function observabilityPut<T>(path: string, body?: unknown): Promise<T> {
	return httpPut<T>(`${OBSERVABILITY_API}${path}`, body);
}

export function observabilityDelete<T = void>(path: string): Promise<T> {
	return httpDelete<T>(`${OBSERVABILITY_API}${path}`);
}
