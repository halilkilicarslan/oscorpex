import { API, httpGet, httpPost } from './base.js';
import type {
	ApprovalState,
	ArtifactCompleteness,
	BlockingGate,
	QualityGateReadiness,
	ReleaseState,
} from './quality-gates.js';

interface ApiEnvelope<T> {
	ok: boolean;
	data: T;
}

export interface ReleaseDecisionResult {
	releaseCandidateId: string;
	decision: string;
	allowed?: boolean;
	blocked?: boolean;
	requiresOverride?: boolean;
	rollbackRequired?: boolean;
	blockingReasons?: Array<Record<string, unknown>>;
	decisionSource?: string;
	createdAt?: string;
}

export interface ManualOverridePayload {
	releaseCandidateId: string;
	gateEvaluationId: string;
	reason: string;
	expiresAt: string;
	metadata?: Record<string, unknown>;
}

export interface RollbackPayload {
	releaseCandidateId: string;
	triggerType: string;
	severity: 'info' | 'warning' | 'high' | 'critical';
	source: string;
	reason: string;
	automatic?: boolean;
	qualitySignalIds?: string[];
	artifactIds?: string[];
	incidentId?: string | null;
	metadata?: Record<string, unknown>;
}

export async function getReleaseState(goalId: string): Promise<ReleaseState> {
	const res = await httpGet<ApiEnvelope<ReleaseState>>(`${API}/release/${goalId}/state`);
	return res.data;
}

export async function evaluateRelease(goalId: string): Promise<ReleaseDecisionResult> {
	const res = await httpPost<ApiEnvelope<ReleaseDecisionResult>>(`${API}/release/${goalId}/evaluate`, {});
	return res.data;
}

export async function applyManualOverride(goalId: string, payload: ManualOverridePayload): Promise<ReleaseDecisionResult> {
	const res = await httpPost<ApiEnvelope<ReleaseDecisionResult>>(`${API}/release/${goalId}/override`, payload);
	return res.data;
}

export async function triggerRollback(goalId: string, payload: RollbackPayload): Promise<Record<string, unknown>> {
	const res = await httpPost<ApiEnvelope<Record<string, unknown>>>(`${API}/release/${goalId}/rollback`, payload);
	return res.data;
}

export async function getBlockingGates(goalId: string): Promise<BlockingGate[]> {
	const res = await httpGet<ApiEnvelope<BlockingGate[]>>(`${API}/quality-gates/${goalId}/blockers`);
	return res.data;
}

export async function getApprovalState(goalId: string): Promise<ApprovalState> {
	const res = await httpGet<ApiEnvelope<ApprovalState>>(`${API}/approvals/${goalId}/state`);
	return res.data;
}

export async function getArtifactCompleteness(goalId: string): Promise<ArtifactCompleteness> {
	const res = await httpGet<ApiEnvelope<ArtifactCompleteness>>(`${API}/artifacts/${goalId}/completeness`);
	return res.data;
}

export async function getQualityGateReadiness(goalId: string): Promise<QualityGateReadiness> {
	const res = await httpGet<ApiEnvelope<QualityGateReadiness>>(`${API}/quality-gates/${goalId}/readiness`);
	return res.data;
}
