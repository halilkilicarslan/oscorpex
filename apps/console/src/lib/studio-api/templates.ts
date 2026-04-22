// ---------------------------------------------------------------------------
// Oscorpex — Templates API Client (V6 M3)
// ---------------------------------------------------------------------------

import { API, json } from './base.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectTemplate {
	id: string;
	name: string;
	description: string;
	category: string;
	techStack: string[];
	agentConfig: Record<string, unknown>;
	phases: unknown[];
	isPublic: boolean;
	authorId: string | null;
	usageCount: number;
	rating: number;
	createdAt: string;
	updatedAt: string;
}

export interface CreateTemplatePayload {
	name: string;
	description?: string;
	category?: string;
	techStack?: string[];
	agentConfig?: Record<string, unknown>;
	phases?: unknown[];
	isPublic?: boolean;
	authorId?: string;
}

export interface UpdateTemplatePayload {
	name?: string;
	description?: string;
	category?: string;
	techStack?: string[];
	agentConfig?: Record<string, unknown>;
	phases?: unknown[];
	isPublic?: boolean;
}

export interface FetchTemplatesOpts {
	category?: string;
	search?: string;
	limit?: number;
	offset?: number;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchTemplates(opts?: FetchTemplatesOpts): Promise<ProjectTemplate[]> {
	const params = new URLSearchParams();
	if (opts?.category) params.set('category', opts.category);
	if (opts?.search) params.set('search', opts.search);
	if (opts?.limit != null) params.set('limit', String(opts.limit));
	if (opts?.offset != null) params.set('offset', String(opts.offset));
	const qs = params.toString() ? `?${params.toString()}` : '';
	return json<ProjectTemplate[]>(`${API}/templates${qs}`);
}

export async function fetchTemplate(id: string): Promise<ProjectTemplate> {
	return json<ProjectTemplate>(`${API}/templates/${id}`);
}

export async function createTemplate(data: CreateTemplatePayload): Promise<ProjectTemplate> {
	return json<ProjectTemplate>(`${API}/templates`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	});
}

export async function updateTemplate(id: string, data: UpdateTemplatePayload): Promise<ProjectTemplate> {
	return json<ProjectTemplate>(`${API}/templates/${id}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	});
}

export async function deleteTemplate(id: string): Promise<void> {
	await json<{ ok: boolean }>(`${API}/templates/${id}`, { method: 'DELETE' });
}

export async function useTemplate(id: string): Promise<ProjectTemplate> {
	return json<ProjectTemplate>(`${API}/templates/${id}/use`, { method: 'POST' });
}

export async function rateTemplate(id: string, rating: number): Promise<void> {
	await json<{ ok: boolean }>(`${API}/templates/${id}/rate`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ rating }),
	});
}
