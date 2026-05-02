// ---------------------------------------------------------------------------
// Oscorpex — Agent Runtime Types (v7.0 Phase 2: Sessions, Episodes, Strategies)
// ---------------------------------------------------------------------------

import type { TaskComplexity } from "./task-types.js";

export type AgentSessionStatus = "active" | "completed" | "failed" | "aborted";

export interface AgentSession {
	id: string;
	projectId: string;
	agentId: string;
	taskId?: string;
	strategy?: string;
	status: AgentSessionStatus;
	stepsCompleted: number;
	maxSteps: number;
	observations: AgentObservation[];
	startedAt?: string;
	completedAt?: string;
	createdAt: string;
}

export interface AgentObservation {
	step: number;
	type: "context_loaded" | "strategy_selected" | "action_executed" | "result_inspected" | "decision_made";
	summary: string;
	timestamp: string;
}

export type EpisodeOutcome = "success" | "failure" | "partial" | "skipped";

export interface AgentEpisode {
	id: string;
	projectId: string;
	agentId: string;
	taskId?: string;
	taskType: string;
	strategy: string;
	actionSummary: string;
	outcome: EpisodeOutcome;
	failureReason?: string;
	qualityScore?: number;
	costUsd?: number;
	durationMs?: number;
	createdAt: string;
}

export interface AgentStrategyPattern {
	id: string;
	projectId: string;
	agentRole: string;
	taskType: string;
	strategy: string;
	successRate: number;
	avgCostUsd?: number;
	avgQuality?: number;
	sampleCount: number;
	updatedAt: string;
}

export interface AgentStrategy {
	id: string;
	agentRole: string;
	name: string;
	description: string;
	promptAddendum?: string;
	allowedTaskTypes: string[];
	isDefault: boolean;
}

export type ProposalType = "sub_task" | "dependency_patch" | "fix_task" | "refactor" | "test_task";
export type ProposalStatus = "pending" | "approved" | "rejected" | "auto_approved";

export interface TaskProposal {
	id: string;
	projectId: string;
	originatingTaskId?: string;
	originatingAgentId: string;
	proposalType: ProposalType;
	title: string;
	description: string;
	severity?: string;
	suggestedRole?: string;
	phaseId?: string;
	complexity?: TaskComplexity;
	createdTaskId?: string;
	status: ProposalStatus;
	approvedBy?: string;
	rejectedReason?: string;
	createdAt: string;
}

export type ProtocolMessageType =
	| "request_info"
	| "provide_info"
	| "request_review"
	| "dependency_warning"
	| "handoff_artifact"
	| "design_decision"
	| "blocker_alert"
	| "plan_adjustment_request";

export type ProtocolMessageStatus = "unread" | "read" | "actioned" | "dismissed";

export interface AgentProtocolMessage {
	id: string;
	projectId: string;
	fromAgentId: string;
	toAgentId?: string;
	relatedTaskId?: string;
	messageType: ProtocolMessageType;
	payload: Record<string, unknown>;
	status: ProtocolMessageStatus;
	createdAt: string;
}
