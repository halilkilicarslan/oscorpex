// ---------------------------------------------------------------------------
// Oscorpex — Studio API: Agentic Platform endpoints (Phase 2+3)
// ---------------------------------------------------------------------------

import { API, json } from './base.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentSession {
	id: string;
	projectId: string;
	agentId: string;
	taskId: string;
	strategy: string;
	status: string;
	stepsCompleted: number;
	observations: unknown[];
	createdAt: string;
	completedAt?: string;
}

export interface AgentEpisode {
	id: string;
	projectId: string;
	agentId: string;
	taskId: string;
	taskType: string;
	strategy: string;
	outcome: string;
	failureReason?: string;
	durationMs: number;
	costUsd: number;
	createdAt: string;
}

export interface TaskProposal {
	id: string;
	projectId: string;
	originatingAgentId: string;
	proposalType: string;
	title: string;
	description: string;
	status: string;
	riskLevel: string;
	createdAt: string;
}

export interface ExecutionGoal {
	id: string;
	projectId: string;
	taskId?: string;
	definition: { goal: string; constraints: string[]; success_criteria: string[] };
	status: string;
	criteriaResults: unknown[];
	createdAt: string;
	completedAt?: string;
}

export interface CapabilityGrant {
	id: string;
	projectId: string;
	agentRole: string;
	capability: string;
	granted: boolean;
	grantedBy: string;
	createdAt: string;
}

export interface AgenticMetrics {
	taskClaimLatency: { avgMs: number; p95Ms: number; samples: number };
	duplicateDispatchPrevented: number;
	verificationFailureRate: number;
	strategySuccessRates: Array<{ strategy: string; taskType: string; successRate: number; samples: number }>;
	avgRetriesBeforeCompletion: number;
	reviewRejectionByRole: Array<{ agentRole: string; rejections: number; total: number; rate: number }>;
	injectedTaskVolume: { total: number; autoApproved: number; pending: number; rejected: number };
	graphMutationStats: { total: number; byType: Record<string, number> };
	replanTriggerFrequency: { total: number; byTrigger: Record<string, number> };
	degradedProviderDuration: Array<{ provider: string; totalMs: number; incidents: number }>;
}

export interface GraphMutation {
	id: string;
	projectId: string;
	pipelineRunId: string;
	causedByAgentId?: string;
	mutationType: string;
	payload: Record<string, unknown>;
	reason?: string;
	createdAt: string;
}

export interface SandboxViolation {
	type: string;
	detail: string;
	timestamp: string;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function fetchAgentSessions(projectId: string): Promise<AgentSession[]> {
	return json<AgentSession[]>(`${API}/projects/${projectId}/sessions`);
}

// ---------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------

export function fetchEpisodes(projectId: string, agentId: string, limit = 10): Promise<AgentEpisode[]> {
	return json<AgentEpisode[]>(`${API}/projects/${projectId}/agents/${agentId}/episodes?limit=${limit}`);
}

export function fetchFailures(projectId: string, agentId: string, limit = 5): Promise<AgentEpisode[]> {
	return json<AgentEpisode[]>(`${API}/projects/${projectId}/agents/${agentId}/failures?limit=${limit}`);
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

export function fetchStrategies(): Promise<{ db: unknown[]; builtin: unknown[] }> {
	return json(`${API}/strategies`);
}

export function fetchStrategyPatterns(projectId: string, role?: string): Promise<unknown[]> {
	const qs = role ? `?role=${role}` : '';
	return json(`${API}/projects/${projectId}/strategy-patterns${qs}`);
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export function fetchProposals(projectId: string, status?: string): Promise<TaskProposal[]> {
	const qs = status ? `?status=${status}` : '';
	return json<TaskProposal[]>(`${API}/projects/${projectId}/proposals${qs}`);
}

export function approveProposal(proposalId: string): Promise<TaskProposal> {
	return json<TaskProposal>(`${API}/proposals/${proposalId}/approve`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ approvedBy: 'human' }),
	});
}

export function rejectProposal(proposalId: string, reason: string): Promise<TaskProposal> {
	return json<TaskProposal>(`${API}/proposals/${proposalId}/reject`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ reason }),
	});
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export function fetchGoals(projectId: string, status?: string): Promise<ExecutionGoal[]> {
	const qs = status ? `?status=${status}` : '';
	return json<ExecutionGoal[]>(`${API}/projects/${projectId}/goals${qs}`);
}

// ---------------------------------------------------------------------------
// Graph Mutations
// ---------------------------------------------------------------------------

export function fetchGraphMutations(projectId: string): Promise<GraphMutation[]> {
	return json<GraphMutation[]>(`${API}/projects/${projectId}/graph-mutations`);
}

// ---------------------------------------------------------------------------
// Sandbox Violations
// ---------------------------------------------------------------------------

export function fetchSandboxViolations(sessionId: string): Promise<SandboxViolation[]> {
	return json<SandboxViolation[]>(`${API}/sandbox-sessions/${sessionId}/violations`);
}

// ---------------------------------------------------------------------------
// Capability Grants
// ---------------------------------------------------------------------------

export function fetchCapabilityGrants(projectId: string, agentRole?: string): Promise<CapabilityGrant[]> {
	const qs = agentRole ? `?agentRole=${agentRole}` : '';
	return json<CapabilityGrant[]>(`${API}/projects/${projectId}/capability-grants${qs}`);
}

export function upsertCapabilityGrant(projectId: string, agentRole: string, capability: string, granted: boolean): Promise<CapabilityGrant> {
	return json<CapabilityGrant>(`${API}/projects/${projectId}/capability-grants`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ agentRole, capability, granted, grantedBy: 'human' }),
	});
}

export function fetchCapabilityDefaults(agentRole: string): Promise<{ agentRole: string; defaults: string[] }> {
	return json(`${API}/capability-grants/defaults/${agentRole}`);
}

// ---------------------------------------------------------------------------
// Agentic Metrics (Section 18)
// ---------------------------------------------------------------------------

export function fetchAgenticMetrics(projectId: string): Promise<AgenticMetrics> {
	return json<AgenticMetrics>(`${API}/projects/${projectId}/agentic-metrics`);
}

// ---------------------------------------------------------------------------
// Replan Events
// ---------------------------------------------------------------------------

export function fetchReplanEvents(projectId: string, limit = 20): Promise<unknown[]> {
	return json(`${API}/projects/${projectId}/replan-events?limit=${limit}`);
}
