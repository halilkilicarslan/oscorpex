import { API, httpGet, httpPost } from './base.js';
import type { ArtifactCompleteness } from './quality-gates.js';

interface ApiEnvelope<T> {
	ok: boolean;
	data: T;
}

export interface ArtifactRecord {
	id: string;
	goalId: string;
	artifactType: string;
	title: string;
	environment: 'dev' | 'staging' | 'production';
	status: string;
	uri?: string;
	checksum?: string;
	metadata?: Record<string, unknown>;
}

export interface RegisterArtifactPayload {
	goalId: string;
	artifactType: string;
	title: string;
	environment: 'dev' | 'staging' | 'production';
	uri?: string;
	checksum?: string;
	metadata?: Record<string, unknown>;
}

export interface VerifyArtifactPayload {
	reason?: string;
	metadata?: Record<string, unknown>;
}

export interface RejectArtifactPayload {
	reason: string;
	metadata?: Record<string, unknown>;
}

export interface SupersedeArtifactPayload {
	reason: string;
	metadata?: Record<string, unknown>;
}

export async function registerArtifact(payload: RegisterArtifactPayload): Promise<ArtifactRecord> {
	const res = await httpPost<ApiEnvelope<ArtifactRecord>>(`${API}/artifacts/register`, payload);
	return res.data;
}

export async function verifyArtifact(id: string, payload: VerifyArtifactPayload = {}): Promise<ArtifactRecord> {
	const res = await httpPost<ApiEnvelope<ArtifactRecord>>(`${API}/artifacts/${id}/verify`, payload);
	return res.data;
}

export async function rejectArtifact(id: string, payload: RejectArtifactPayload): Promise<ArtifactRecord> {
	const res = await httpPost<ApiEnvelope<ArtifactRecord>>(`${API}/artifacts/${id}/reject`, payload);
	return res.data;
}

export async function supersedeArtifact(
	id: string,
	payload: SupersedeArtifactPayload,
): Promise<{ artifactId: string; superseded: boolean }> {
	const res = await httpPost<ApiEnvelope<{ artifactId: string; superseded: boolean }>>(
		`${API}/artifacts/${id}/supersede`,
		payload,
	);
	return res.data;
}

export async function getArtifactCompleteness(goalId: string): Promise<ArtifactCompleteness> {
	const res = await httpGet<ApiEnvelope<ArtifactCompleteness>>(`${API}/artifacts/${goalId}/completeness`);
	return res.data;
}

export async function getArtifacts(goalId: string): Promise<ArtifactRecord[]> {
	const res = await httpGet<ApiEnvelope<ArtifactRecord[]>>(`${API}/artifacts/${goalId}`);
	return res.data;
}
