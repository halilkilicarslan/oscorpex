// @oscorpex/core — Canonical event base type and EventType registry
// Phase 4 will fully migrate all event types; this establishes the BaseEvent
// contract with correlation/causation IDs — the key gap identified in inventory.

export interface BaseEvent<TType extends string, TPayload> {
	id: string;
	type: TType;
	timestamp: string;
	runId: string;
	projectId: string;
	taskId?: string;
	stageId?: string;
	agentId?: string;
	provider?: string;
	correlationId: string;
	causationId?: string;
	payload: TPayload;
}

// Full EventType registry from inventory (52 types).
// These will be individually typed with specific payloads in Phase 4 (event-schema).
// For now, the union is declared to establish the canonical list.

export type EventType =
	// Task lifecycle
	| "task:assigned"
	| "task:started"
	| "task:completed"
	| "task:failed"
	| "task:timeout"
	| "task:retry"
	| "task:approval_required"
	| "task:approved"
	| "task:rejected"
	| "task:added"
	| "task:review_rejected"
	| "task:proposal_created"
	| "task:proposal_approved"
	| "task:transient_failure"
	| "task:timeout_warning"
	// Agent lifecycle
	| "agent:started"
	| "agent:stopped"
	| "agent:error"
	| "agent:session_started"
	| "agent:strategy_selected"
	| "agent:requested_help"
	| "agent:memory_written"
	| "agent:output"
	// Pipeline
	| "pipeline:stage_started"
	| "pipeline:stage_completed"
	| "pipeline:branch_created"
	| "pipeline:branch_merged"
	| "pipeline:completed"
	| "pipeline:failed"
	| "pipeline:paused"
	| "pipeline:resumed"
	| "pipeline:degraded"
	| "pipeline:rate_limited"
	// Phase & Plan
	| "phase:started"
	| "phase:completed"
	| "plan:created"
	| "plan:approved"
	| "plan:phase_added"
	| "plan:replanned"
	// Cost
	| "cost:recorded"
	// Budget
	| "budget:warning"
	| "budget:exceeded"
	| "budget:halted"
	// Execution
	| "execution:started"
	| "execution:error"
	// Escalation
	| "escalation:user"
	// Git
	| "git:commit"
	| "git:pr-created"
	// Governance
	| "policy:violation"
	| "verification:passed"
	| "verification:failed"
	| "quality_gate.evaluated"
	| "quality_gate.blocked"
	| "quality_gate.release_ready"
	| "approval.requested"
	| "approval.approved"
	| "approval.rejected"
	| "approval.expired"
	| "approval.superseded"
	| "approval.quorum_satisfied"
	| "approval.blocked"
	| "release.candidate_created"
	| "release.decision_recorded"
	| "release.blocked"
	| "release.allowed"
	| "release.override_applied"
	| "release.rollback_triggered"
	| "release.rollback_required"
	// Lifecycle
	| "lifecycle:transition"
	// Goal
	| "goal:evaluated"
	// Messaging
	| "message:created"
	// Agent protocol
	| "ceremony:standup"
	| "ceremony:retrospective"
	// Graph
	| "graph:mutation_proposed"
	| "graph:mutation_applied"
	// Provider
	| "provider:degraded"
	// Prompt
	| "prompt:size"
	// Work items & Sprints
	| "work_item:created"
	| "work_item:planned"
	| "sprint:started"
	| "sprint:completed"
	// Run lifecycle
	| "run:created"
	| "run:started"
	| "run:paused"
	| "run:resumed"
	| "run:failed"
	| "run:completed";

// Legacy event type for backward compatibility during migration
// This matches the current StudioEvent shape and will be deprecated once
// all producers migrate to BaseEvent in Phase 4.
export interface LegacyStudioEvent {
	id: string;
	projectId: string;
	type: EventType;
	agentId?: string;
	taskId?: string;
	payload: Record<string, unknown>;
	timestamp: string;
}
