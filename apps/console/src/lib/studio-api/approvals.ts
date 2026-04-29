import { API, httpGet, httpPost } from './base.js';
import type { ApprovalState, BlockingGate, ReleaseState } from './quality-gates.js';
import { getArtifactCompleteness, type ArtifactCompleteness } from './quality-gates.js';

export interface PendingApprovalRequest {
	id: string;
	goalId: string;
	approvalClass: string;
	requiredQuorum: number;
	requestedBy: string;
	reason: string;
	createdAt: string;
	state: 'pending' | 'in-review' | 'approved' | 'rejected' | 'expired' | 'superseded' | 'cancelled';
	metadata?: Record<string, unknown>;
}

export interface ApprovalDecisionState {
	request: {
		id: string;
		approvalClass: string;
		requiredQuorum: number;
		createdAt?: string;
		expiresAt?: string | null;
		requestedBy?: string;
		reason?: string;
		metadata?: Record<string, unknown>;
	};
	state: string;
	satisfied: boolean;
	blocked: boolean;
	expired: boolean;
	rejected: boolean;
	missingApprovals: number;
	approvedCount: number;
	rejectedCount: number;
	approvedActorIds: string[];
	rejectedActorIds: string[];
	reason: string;
}

interface ApiEnvelope<T> {
	ok: boolean;
	data: T;
}

export async function getPendingApprovals(goalId: string): Promise<PendingApprovalRequest[]> {
	const res = await httpGet<ApiEnvelope<PendingApprovalRequest[]>>(`${API}/approvals/pending?goalId=${encodeURIComponent(goalId)}`);
	return res.data;
}

export async function getApprovalState(goalId: string): Promise<ApprovalState> {
	const res = await httpGet<ApiEnvelope<ApprovalState>>(`${API}/approvals/${goalId}/state`);
	return res.data;
}

export async function approveApproval(
	id: string,
	payload?: { reason?: string; metadata?: Record<string, unknown>; artifactIds?: string[] },
): Promise<ApprovalDecisionState> {
	const res = await httpPost<ApiEnvelope<ApprovalDecisionState>>(`${API}/approvals/${id}/approve`, payload ?? {});
	return res.data;
}

export async function rejectApproval(
	id: string,
	payload: { reason: string; metadata?: Record<string, unknown>; artifactIds?: string[] },
): Promise<ApprovalDecisionState> {
	const res = await httpPost<ApiEnvelope<ApprovalDecisionState>>(`${API}/approvals/${id}/reject`, payload);
	return res.data;
}

export async function getReleaseState(goalId: string): Promise<ReleaseState> {
	const res = await httpGet<ApiEnvelope<ReleaseState>>(`${API}/release/${goalId}/state`);
	return res.data;
}

export async function getBlockingGates(goalId: string): Promise<BlockingGate[]> {
	const res = await httpGet<ApiEnvelope<BlockingGate[]>>(`${API}/quality-gates/${goalId}/blockers`);
	return res.data;
}

export async function getApprovalArtifactCompleteness(goalId: string): Promise<ArtifactCompleteness> {
	return getArtifactCompleteness(goalId);
}
