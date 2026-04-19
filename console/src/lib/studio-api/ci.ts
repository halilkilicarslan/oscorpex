// ---------------------------------------------------------------------------
// Oscorpex — CI Status API Client (V6 M3)
// ---------------------------------------------------------------------------

import { API, json } from './base.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CIProvider = 'github' | 'gitlab';
export type CIStatus = 'pending' | 'running' | 'success' | 'failure' | 'cancelled';

export interface CITracking {
	id: string;
	projectId: string;
	provider: CIProvider;
	prId: string;
	prUrl: string | null;
	status: CIStatus;
	details: Record<string, unknown>;
	pipelineUrl: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface TrackPRInput {
	projectId: string;
	provider: CIProvider;
	prId: string;
	prUrl?: string;
	pipelineUrl?: string;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Fetch all CI trackings for a project.
 */
export async function fetchCIStatus(projectId: string): Promise<CITracking[]> {
	return json<CITracking[]>(`${API}/ci/status/${encodeURIComponent(projectId)}`);
}

/**
 * Manually track a PR/MR.
 */
export async function trackPR(data: TrackPRInput): Promise<CITracking> {
	return json<CITracking>(`${API}/ci/track`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	});
}
