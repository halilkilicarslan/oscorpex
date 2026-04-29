import { API, httpGet } from './base.js';

export interface QualityGateEvaluation {
	id: string;
	gateType: string;
	outcome: 'passed' | 'failed' | 'warning' | 'blocked';
	required: boolean;
	blocking: boolean;
	reason?: string;
	metadata?: Record<string, unknown>;
}

export interface BlockingGate {
	gateType: string;
	reason: string;
	overrideAllowed: boolean;
	evaluation?: QualityGateEvaluation | null;
}

export interface GateStateSummary {
	gateType?: string;
	state: 'passed' | 'failed' | 'warning' | 'blocked' | 'missing' | 'overridden';
	blocking: boolean;
	reason: string;
	gate?: {
		gateType: string;
		required: boolean;
		blocking: boolean;
		overrideAllowed?: boolean;
	};
	evaluation?: QualityGateEvaluation | null;
}

export interface QualityGateReadiness {
	ready: boolean;
	environment: 'dev' | 'staging' | 'production';
	blockingGates: BlockingGate[];
	warnings: GateStateSummary[];
	missingEvaluations: GateStateSummary[];
	evaluations: QualityGateEvaluation[];
	requiredGates: Array<{
		id: string;
		gateType: string;
		required: boolean;
		blocking: boolean;
		overrideAllowed: boolean;
	}>;
}

export interface ApprovalState {
	goalId: string;
	satisfied: boolean;
	blocked: boolean;
	missingApprovals: number;
	pending: Array<{
		request: { id: string; approvalClass: string; requiredQuorum: number };
		missingApprovals: number;
		approvedActorIds: string[];
		rejectedActorIds: string[];
	}>;
	expired: unknown[];
	rejected: unknown[];
	states: Array<{
		request: { id: string; approvalClass: string; requiredQuorum: number };
		satisfied: boolean;
		blocked: boolean;
		expired: boolean;
		rejected: boolean;
		missingApprovals: number;
		approvedActorIds: string[];
		rejectedActorIds: string[];
	}>;
}

export interface ReleaseState {
	allowed: boolean;
	blocked: boolean;
	requiresOverride: boolean;
	rollbackRequired: boolean;
	blockingReasons: Array<{
		code: string;
		source: string;
		gateType?: string;
		detail?: string;
		overrideAllowed?: boolean;
	}>;
	latestDecision: {
		decision: string;
		releaseCandidateId: string;
		createdAt: string;
	} | null;
	rollbackTriggers: Array<{
		id: string;
		triggerType: string;
		severity: string;
		state: string;
		reason: string;
	}>;
}

export interface ArtifactCompleteness {
	satisfied: boolean;
	missingArtifacts: string[];
	staleArtifacts: Array<{ id: string; artifactType: string; title: string }>;
	rejectedArtifacts: Array<{ id: string; artifactType: string; title: string }>;
	latestArtifacts: Array<{ id: string; artifactType: string; title: string; status: string }>;
	requiredArtifacts: string[];
	environment: 'dev' | 'staging' | 'production';
}

interface ApiEnvelope<T> {
	ok: boolean;
	data: T;
}

export async function getQualityGateReadiness(goalId: string): Promise<QualityGateReadiness> {
	const res = await httpGet<ApiEnvelope<QualityGateReadiness>>(`${API}/quality-gates/${goalId}/readiness`);
	return res.data;
}

export async function getQualityGateEvaluations(goalId: string): Promise<QualityGateEvaluation[]> {
	const res = await httpGet<ApiEnvelope<QualityGateEvaluation[]>>(`${API}/quality-gates/${goalId}/evaluations`);
	return res.data;
}

export async function getQualityGateBlockers(goalId: string): Promise<BlockingGate[]> {
	const res = await httpGet<ApiEnvelope<BlockingGate[]>>(`${API}/quality-gates/${goalId}/blockers`);
	return res.data;
}

export async function getApprovalState(goalId: string): Promise<ApprovalState> {
	const res = await httpGet<ApiEnvelope<ApprovalState>>(`${API}/approvals/${goalId}/state`);
	return res.data;
}

export async function getReleaseState(goalId: string): Promise<ReleaseState> {
	const res = await httpGet<ApiEnvelope<ReleaseState>>(`${API}/release/${goalId}/state`);
	return res.data;
}

export async function getArtifactCompleteness(goalId: string): Promise<ArtifactCompleteness> {
	const res = await httpGet<ApiEnvelope<ArtifactCompleteness>>(`${API}/artifacts/${goalId}/completeness`);
	return res.data;
}
