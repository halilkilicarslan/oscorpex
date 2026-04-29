// @oscorpex/event-schema — Canonical event schema for the Oscorpex platform
// Each event type has a strongly-typed payload. The BaseEvent contract includes
// correlationId and causationId — the key gaps identified in the inventory.
// StudioEvent is exported for backward compatibility during migration.

import { generateId } from "@oscorpex/core";
import type { BaseEvent, EventType } from "@oscorpex/core";

// Re-export BaseEvent and EventType for convenience
export type { BaseEvent, EventType } from "@oscorpex/core";

// --- Task event payloads ---
export type {
	TaskAssignedPayload,
	TaskStartedPayload,
	TaskCompletedPayload,
	TaskFailedPayload,
	TaskTimeoutPayload,
	TaskRetryPayload,
	TaskApprovalRequiredPayload,
	TaskApprovedPayload,
	TaskRejectedPayload,
	TaskAddedPayload,
	TaskReviewRejectedPayload,
	TaskProposalCreatedPayload,
	TaskProposalApprovedPayload,
	TaskTransientFailurePayload,
	TaskTimeoutWarningPayload,
} from "./task-events.js";

// --- Agent event payloads ---
export type {
	AgentStartedPayload,
	AgentStoppedPayload,
	AgentOutputPayload,
	AgentErrorPayload,
	AgentSessionStartedPayload,
	AgentStrategySelectedPayload,
	AgentRequestedHelpPayload,
	AgentMemoryWrittenPayload,
} from "./agent-events.js";

// --- Pipeline event payloads ---
export type {
	PipelineStageStartedPayload,
	PipelineStageCompletedPayload,
	PipelineBranchCreatedPayload,
	PipelineBranchMergedPayload,
	PipelineCompletedPayload,
	PipelineFailedPayload,
	PipelinePausedPayload,
	PipelineResumedPayload,
	PipelineDegradedPayload,
	PipelineRateLimitedPayload,
} from "./pipeline-events.js";

// --- Phase & Plan event payloads ---
export type {
	PhaseStartedPayload,
	PhaseCompletedPayload,
	PlanCreatedPayload,
	PlanApprovedPayload,
	PlanPhaseAddedPayload,
	PlanReplannedPayload,
} from "./plan-events.js";

// --- Run lifecycle event payloads ---
export type {
	RunCreatedPayload,
	RunStartedPayload,
	RunPausedPayload,
	RunResumedPayload,
	RunFailedPayload,
	RunCompletedPayload,
} from "./run-events.js";

// --- Cost event payloads ---
export type {
	CostRecordedPayload,
} from "./cost-events.js";

// --- Budget event payloads ---
export type {
	BudgetWarningPayload,
	BudgetExceededPayload,
	BudgetHaltedPayload,
} from "./budget-events.js";

// --- Other event payloads ---
export type {
	ExecutionStartedPayload,
	ExecutionErrorPayload,
	EscalationUserPayload,
	GitCommitPayload,
	GitPrCreatedPayload,
	PolicyViolationPayload,
	VerificationPassedPayload,
	VerificationFailedPayload,
	QualityGateEvaluatedPayload,
	QualityGateBlockedPayload,
	QualityGateReleaseReadyPayload,
	ApprovalRequestedPayload,
	ApprovalDecisionPayload,
	ApprovalExpiredPayload,
	ApprovalSupersededPayload,
	ApprovalQuorumSatisfiedPayload,
	ApprovalBlockedPayload,
	ReleaseCandidateCreatedPayload,
	ReleaseDecisionRecordedPayload,
	ReleaseBlockedPayload,
	ReleaseAllowedPayload,
	ReleaseOverrideAppliedPayload,
	ReleaseRollbackTriggeredPayload,
	ReleaseRollbackRequiredPayload,
	ArtifactRegisteredPayload,
	ArtifactVerifiedPayload,
	ArtifactRejectedPayload,
	ArtifactSupersededPayload,
	ArtifactCompletenessSatisfiedPayload,
	ArtifactBlockedPayload,
	LifecycleTransitionPayload,
	GoalEvaluatedPayload,
	MessageCreatedPayload,
	CeremonyStandupPayload,
	CeremonyRetrospectivePayload,
	GraphMutationProposedPayload,
	GraphMutationAppliedPayload,
	ProviderDegradedPayload,
	PromptSizePayload,
	WorkItemCreatedPayload,
	WorkItemPlannedPayload,
	SprintStartedPayload,
	SprintCompletedPayload,
} from "./other-events.js";

// --- Event type → Payload mapping ---
// This is the canonical map from EventType string to its typed payload.
// All producers and consumers should use this mapping for type safety.

import type {
	TaskAssignedPayload,
	TaskStartedPayload,
	TaskCompletedPayload,
	TaskFailedPayload,
	TaskTimeoutPayload,
	TaskRetryPayload,
	TaskApprovalRequiredPayload,
	TaskApprovedPayload,
	TaskRejectedPayload,
	TaskAddedPayload,
	TaskReviewRejectedPayload,
	TaskProposalCreatedPayload,
	TaskProposalApprovedPayload,
	TaskTransientFailurePayload,
	TaskTimeoutWarningPayload,
} from "./task-events.js";
import type {
	AgentStartedPayload,
	AgentStoppedPayload,
	AgentOutputPayload,
	AgentErrorPayload,
	AgentSessionStartedPayload,
	AgentStrategySelectedPayload,
	AgentRequestedHelpPayload,
	AgentMemoryWrittenPayload,
} from "./agent-events.js";
import type {
	PipelineStageStartedPayload,
	PipelineStageCompletedPayload,
	PipelineBranchCreatedPayload,
	PipelineBranchMergedPayload,
	PipelineCompletedPayload,
	PipelineFailedPayload,
	PipelinePausedPayload,
	PipelineResumedPayload,
	PipelineDegradedPayload,
	PipelineRateLimitedPayload,
} from "./pipeline-events.js";
import type {
	PhaseStartedPayload,
	PhaseCompletedPayload,
	PlanCreatedPayload,
	PlanApprovedPayload,
	PlanPhaseAddedPayload,
	PlanReplannedPayload,
} from "./plan-events.js";
import type {
	RunCreatedPayload,
	RunStartedPayload,
	RunPausedPayload,
	RunResumedPayload,
	RunFailedPayload,
	RunCompletedPayload,
} from "./run-events.js";
import type {
	BudgetWarningPayload,
	BudgetExceededPayload,
	BudgetHaltedPayload,
} from "./budget-events.js";
import type {
	CostRecordedPayload,
} from "./cost-events.js";
import type {
	ExecutionStartedPayload,
	ExecutionErrorPayload,
	EscalationUserPayload,
	GitCommitPayload,
	GitPrCreatedPayload,
	PolicyViolationPayload,
	VerificationPassedPayload,
	VerificationFailedPayload,
	QualityGateEvaluatedPayload,
	QualityGateBlockedPayload,
	QualityGateReleaseReadyPayload,
	ApprovalRequestedPayload,
	ApprovalDecisionPayload,
	ApprovalExpiredPayload,
	ApprovalSupersededPayload,
	ApprovalQuorumSatisfiedPayload,
	ApprovalBlockedPayload,
	ReleaseCandidateCreatedPayload,
	ReleaseDecisionRecordedPayload,
	ReleaseBlockedPayload,
	ReleaseAllowedPayload,
	ReleaseOverrideAppliedPayload,
	ReleaseRollbackTriggeredPayload,
	ReleaseRollbackRequiredPayload,
	ArtifactRegisteredPayload,
	ArtifactVerifiedPayload,
	ArtifactRejectedPayload,
	ArtifactSupersededPayload,
	ArtifactCompletenessSatisfiedPayload,
	ArtifactBlockedPayload,
	LifecycleTransitionPayload,
	GoalEvaluatedPayload,
	MessageCreatedPayload,
	CeremonyStandupPayload,
	CeremonyRetrospectivePayload,
	GraphMutationProposedPayload,
	GraphMutationAppliedPayload,
	ProviderDegradedPayload,
	PromptSizePayload,
	WorkItemCreatedPayload,
	WorkItemPlannedPayload,
	SprintStartedPayload,
	SprintCompletedPayload,
} from "./other-events.js";

export interface EventPayloadMap {
	// Task lifecycle
	"task:assigned": TaskAssignedPayload;
	"task:started": TaskStartedPayload;
	"task:completed": TaskCompletedPayload;
	"task:failed": TaskFailedPayload;
	"task:timeout": TaskTimeoutPayload;
	"task:retry": TaskRetryPayload;
	"task:approval_required": TaskApprovalRequiredPayload;
	"task:approved": TaskApprovedPayload;
	"task:rejected": TaskRejectedPayload;
	"task:added": TaskAddedPayload;
	"task:review_rejected": TaskReviewRejectedPayload;
	"task:proposal_created": TaskProposalCreatedPayload;
	"task:proposal_approved": TaskProposalApprovedPayload;
	"task:transient_failure": TaskTransientFailurePayload;
	"task:timeout_warning": TaskTimeoutWarningPayload;
	// Agent lifecycle
	"agent:started": AgentStartedPayload;
	"agent:stopped": AgentStoppedPayload;
	"agent:output": AgentOutputPayload;
	"agent:error": AgentErrorPayload;
	"agent:session_started": AgentSessionStartedPayload;
	"agent:strategy_selected": AgentStrategySelectedPayload;
	"agent:requested_help": AgentRequestedHelpPayload;
	"agent:memory_written": AgentMemoryWrittenPayload;
	// Pipeline
	"pipeline:stage_started": PipelineStageStartedPayload;
	"pipeline:stage_completed": PipelineStageCompletedPayload;
	"pipeline:branch_created": PipelineBranchCreatedPayload;
	"pipeline:branch_merged": PipelineBranchMergedPayload;
	"pipeline:completed": PipelineCompletedPayload;
	"pipeline:failed": PipelineFailedPayload;
	"pipeline:paused": PipelinePausedPayload;
	"pipeline:resumed": PipelineResumedPayload;
	"pipeline:degraded": PipelineDegradedPayload;
	"pipeline:rate_limited": PipelineRateLimitedPayload;
	// Phase & Plan
	"phase:started": PhaseStartedPayload;
	"phase:completed": PhaseCompletedPayload;
	"plan:created": PlanCreatedPayload;
	"plan:approved": PlanApprovedPayload;
	"plan:phase_added": PlanPhaseAddedPayload;
	"plan:replanned": PlanReplannedPayload;
	// Run lifecycle
	"run:created": RunCreatedPayload;
	"run:started": RunStartedPayload;
	"run:paused": RunPausedPayload;
	"run:resumed": RunResumedPayload;
	"run:failed": RunFailedPayload;
	"run:completed": RunCompletedPayload;
	// Cost
	"cost:recorded": CostRecordedPayload;
	// Budget
	"budget:warning": BudgetWarningPayload;
	"budget:exceeded": BudgetExceededPayload;
	"budget:halted": BudgetHaltedPayload;
	// Execution
	"execution:started": ExecutionStartedPayload;
	"execution:error": ExecutionErrorPayload;
	// Escalation
	"escalation:user": EscalationUserPayload;
	// Git
	"git:commit": GitCommitPayload;
	"git:pr-created": GitPrCreatedPayload;
	// Governance
	"policy:violation": PolicyViolationPayload;
	"verification:passed": VerificationPassedPayload;
	"verification:failed": VerificationFailedPayload;
	"quality_gate.evaluated": QualityGateEvaluatedPayload;
	"quality_gate.blocked": QualityGateBlockedPayload;
	"quality_gate.release_ready": QualityGateReleaseReadyPayload;
	"approval.requested": ApprovalRequestedPayload;
	"approval.approved": ApprovalDecisionPayload;
	"approval.rejected": ApprovalDecisionPayload;
	"approval.expired": ApprovalExpiredPayload;
	"approval.superseded": ApprovalSupersededPayload;
	"approval.quorum_satisfied": ApprovalQuorumSatisfiedPayload;
	"approval.blocked": ApprovalBlockedPayload;
	"release.candidate_created": ReleaseCandidateCreatedPayload;
	"release.decision_recorded": ReleaseDecisionRecordedPayload;
	"release.blocked": ReleaseBlockedPayload;
	"release.allowed": ReleaseAllowedPayload;
	"release.override_applied": ReleaseOverrideAppliedPayload;
	"release.rollback_triggered": ReleaseRollbackTriggeredPayload;
	"release.rollback_required": ReleaseRollbackRequiredPayload;
	"artifact.registered": ArtifactRegisteredPayload;
	"artifact.verified": ArtifactVerifiedPayload;
	"artifact.rejected": ArtifactRejectedPayload;
	"artifact.superseded": ArtifactSupersededPayload;
	"artifact.completeness_satisfied": ArtifactCompletenessSatisfiedPayload;
	"artifact.blocked": ArtifactBlockedPayload;
	// Lifecycle
	"lifecycle:transition": LifecycleTransitionPayload;
	// Goal
	"goal:evaluated": GoalEvaluatedPayload;
	// Messaging
	"message:created": MessageCreatedPayload;
	// Ceremony
	"ceremony:standup": CeremonyStandupPayload;
	"ceremony:retrospective": CeremonyRetrospectivePayload;
	// Graph
	"graph:mutation_proposed": GraphMutationProposedPayload;
	"graph:mutation_applied": GraphMutationAppliedPayload;
	// Provider
	"provider:degraded": ProviderDegradedPayload;
	// Prompt
	"prompt:size": PromptSizePayload;
	// Work items & Sprints
	"work_item:created": WorkItemCreatedPayload;
	"work_item:planned": WorkItemPlannedPayload;
	"sprint:started": SprintStartedPayload;
	"sprint:completed": SprintCompletedPayload;
}

// --- Typed event factory ---
// Creates a fully-typed event with correlationId and causationId.
// The 'id' and 'timestamp' are auto-generated by the event bus on persistence.

export type TypedEvent<T extends EventType> = BaseEvent<T, EventPayloadMap[T]>;

// --- Emit input type ---
// The shape callers provide when emitting — id/timestamp are omitted
// (they are generated by insertEvent or emitTransient).

export type EmitInput<T extends EventType> = Omit<TypedEvent<T>, "id" | "timestamp">;

// --- Legacy StudioEvent ---
// Backward-compatible type matching the current kernel shape.
// Will be deprecated once all producers migrate to TypedEvent.

export interface StudioEvent {
	id: string;
	projectId: string;
	type: EventType;
	agentId?: string;
	taskId?: string;
	payload: Record<string, unknown>;
	timestamp: string;
	correlationId?: string;
	causationId?: string;
}

// --- Helper: Create a typed emit input ---
export function createEventInput<T extends EventType>(
	type: T,
	projectId: string,
	payload: EventPayloadMap[T],
	options?: { agentId?: string; taskId?: string; correlationId?: string; causationId?: string; stageId?: string; provider?: string },
): EmitInput<T> {
	return {
		type,
		projectId,
		payload,
		correlationId: options?.correlationId ?? generateId(),
		causationId: options?.causationId,
		stageId: options?.stageId,
		provider: options?.provider,
		agentId: options?.agentId,
		taskId: options?.taskId,
	} as EmitInput<T>;
}
