// @oscorpex/core — State machine definitions
// Canonical transition tables for Run, Task, Stage (pipeline), Phase (project),
// and AgentProcess lifecycles. These are pure data — no side effects.
// The kernel will use these to validate transitions before mutating state.

import type { ProjectStatus, ValidTransition } from "./run.js";
import type { TaskStatus } from "./task.js";
import type { PipelineStageStatus, PipelineStatus, PhaseStatus } from "./stage.js";

// ---------------------------------------------------------------------------
// ProjectStatus — from lifecycle-manager.ts VALID_TRANSITIONS
// ---------------------------------------------------------------------------

export const PROJECT_TRANSITIONS: ValidTransition[] = [
	{ from: "planning", to: "approved" },
	{ from: "planning", to: "archived" },
	{ from: "approved", to: "running" },
	{ from: "approved", to: "planning" },
	{ from: "running", to: "paused" },
	{ from: "running", to: "completed" },
	{ from: "running", to: "failed" },
	{ from: "paused", to: "running" },
	{ from: "paused", to: "failed" },
	{ from: "completed", to: "maintenance" },
	{ from: "completed", to: "archived" },
	{ from: "failed", to: "planning" },
	{ from: "failed", to: "archived" },
	{ from: "maintenance", to: "archived" },
	{ from: "maintenance", to: "planning" },
];

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
	return PROJECT_TRANSITIONS.some((t) => t.from === from && t.to === to);
}

// ---------------------------------------------------------------------------
// TaskStatus — 25 transitions from task-engine.ts inventory
// ---------------------------------------------------------------------------

export const TASK_TRANSITIONS: Array<{ from: TaskStatus | TaskStatus[]; to: TaskStatus }> = [
	// Standard lifecycle
	{ from: "queued", to: "assigned" },
	{ from: "queued", to: "running" },
	{ from: "assigned", to: "running" },
	{ from: ["queued", "assigned"], to: "waiting_approval" },
	{ from: ["queued", "assigned"], to: "failed" },
	{ from: "waiting_approval", to: "queued" },
	{ from: "waiting_approval", to: "failed" },
	// Review cycle
	{ from: ["running", "revision"], to: "review" },
	{ from: ["running", "revision"], to: "done" },
	{ from: "review", to: "done" },
	{ from: "review", to: "revision" },
	{ from: "review", to: "failed" },
	// Revision & escalation
	{ from: "revision", to: "queued" },
	// Failure & retry
	{ from: "running", to: "failed" },
	{ from: "running", to: "queued" },
	{ from: "failed", to: "queued" },
	// Blocking
	{ from: "running", to: "blocked" },
	{ from: "blocked", to: "queued" },
	// Pipeline pause/cancel
	{ from: ["running", "assigned"], to: "queued" },
	// Approval result transitions
	{ from: "waiting_approval", to: "queued" },  // approved → re-queued for execution
	{ from: "waiting_approval", to: "failed" },  // rejected or timeout
];

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
	return TASK_TRANSITIONS.some((t) => {
		const fromStatuses = Array.isArray(t.from) ? t.from : [t.from];
		return fromStatuses.includes(from) && t.to === to;
	});
}

// ---------------------------------------------------------------------------
// PipelineStatus — from pipeline-engine.ts
// ---------------------------------------------------------------------------

export const PIPELINE_STATUS_TRANSITIONS: Array<{ from: PipelineStatus | PipelineStatus[]; to: PipelineStatus }> = [
	{ from: "idle", to: "running" },
	{ from: "running", to: "paused" },
	{ from: "running", to: "completed" },
	{ from: "running", to: "failed" },
	{ from: "paused", to: "running" },
	{ from: "paused", to: "failed" },
	{ from: "failed", to: "running" },
	{ from: ["idle", "failed"], to: "running" },
];

export function canTransitionPipeline(from: PipelineStatus, to: PipelineStatus): boolean {
	return PIPELINE_STATUS_TRANSITIONS.some((t) => {
		const fromStatuses = Array.isArray(t.from) ? t.from : [t.from];
		return fromStatuses.includes(from) && t.to === to;
	});
}

// ---------------------------------------------------------------------------
// PipelineStageStatus — from pipeline-engine.ts
// ---------------------------------------------------------------------------

export const STAGE_STATUS_TRANSITIONS: Array<{ from: PipelineStageStatus | PipelineStageStatus[]; to: PipelineStageStatus }> = [
	{ from: "pending", to: "running" },
	{ from: "running", to: "completed" },
	{ from: "running", to: "failed" },
	{ from: "failed", to: "running" },
];

export function canTransitionStage(from: PipelineStageStatus, to: PipelineStageStatus): boolean {
	return STAGE_STATUS_TRANSITIONS.some((t) => {
		const fromStatuses = Array.isArray(t.from) ? t.from : [t.from];
		return fromStatuses.includes(from) && t.to === to;
	});
}

// ---------------------------------------------------------------------------
// PhaseStatus — from task-engine.ts
// ---------------------------------------------------------------------------

export const PHASE_STATUS_TRANSITIONS: Array<{ from: PhaseStatus | PhaseStatus[]; to: PhaseStatus }> = [
	{ from: "pending", to: "running" },
	{ from: "running", to: "completed" },
	{ from: "running", to: "failed" },
	{ from: "failed", to: "running" },
];

export function canTransitionPhase(from: PhaseStatus, to: PhaseStatus): boolean {
	return PHASE_STATUS_TRANSITIONS.some((t) => {
		const fromStatuses = Array.isArray(t.from) ? t.from : [t.from];
		return fromStatuses.includes(from) && t.to === to;
	});
}