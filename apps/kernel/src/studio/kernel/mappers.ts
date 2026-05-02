// ---------------------------------------------------------------------------
// Kernel ↔ Core type mappers
//
// Replaces all `as unknown as` casts in the kernel facade by making the
// structural differences between kernel types and @oscorpex/core types
// explicit and auditable.
//
// Field mapping reference:
//   Kernel Task          → Core Task
//   ─────────────────────────────────
//   phaseId              → stageId
//   assignedAgent        → assignedRole
//   assignedAgentId      → assignedProvider  (best-effort)
//   taskType             → type              (same union values)
//   runId                → runId             (default "" — not in kernel schema)
//   approvalRejectionReason → (dropped — not in core contract)
//   policySnapshot       → (dropped — kernel-internal)
//   testExpectation      → (dropped — kernel-internal)
//   estimatedLines       → (dropped — kernel-internal)
//
//   Core Task            → Kernel Task (reverse, used by KernelTaskStore.create)
//   ─────────────────────────────────────────────────────────────────────────────
//   stageId              → phaseId
//   assignedRole         → assignedAgent
//   assignedProvider     → assignedAgentId   (optional)
//   type                 → taskType
// ---------------------------------------------------------------------------

import type { Task as CoreTask, TaskOutput as CoreTaskOutput, PipelineState as CorePipelineState } from "@oscorpex/core";
import type { Task as KernelTask, TaskOutput as KernelTaskOutput, PipelineState as KernelPipelineState } from "../types.js";

// ---------------------------------------------------------------------------
// Task mappers
// ---------------------------------------------------------------------------

/**
 * Converts a kernel-internal Task to the @oscorpex/core Task contract.
 * Kernel tasks lack a `runId` (stored at pipeline level); we default to "".
 */
export function toCoreTask(task: KernelTask): CoreTask {
	return {
		id: task.id,
		runId: "",
		projectId: task.projectId ?? "",
		stageId: task.phaseId,
		title: task.title,
		description: task.description,
		type: task.taskType ?? "ai",
		complexity: task.complexity,
		status: task.status,
		assignedRole: task.assignedAgent,
		assignedProvider: task.assignedAgentId,
		dependsOn: task.dependsOn,
		targetFiles: task.targetFiles,
		branch: task.branch,
		retryCount: task.retryCount,
		revisionCount: task.revisionCount,
		requiresApproval: task.requiresApproval,
		approvalStatus: task.approvalStatus ?? undefined,
		riskLevel: task.riskLevel,
		output: task.output !== undefined ? toCoreTaskOutput(task.output) : undefined,
		error: task.error ?? undefined,
		startedAt: task.startedAt,
		completedAt: task.completedAt,
		parentTaskId: task.parentTaskId,
		reviewStatus: task.reviewStatus,
		reviewerAgentId: task.reviewerAgentId,
		reviewTaskId: task.reviewTaskId,
	};
}

/**
 * Converts a @oscorpex/core Task back to a kernel-internal Task shape.
 * Used when receiving a CoreTask from external callers and persisting via the DB.
 * Fields absent from the core contract are given safe defaults.
 */
export function toKernelTask(coreTask: CoreTask): KernelTask {
	return {
		id: coreTask.id,
		phaseId: coreTask.stageId,
		title: coreTask.title,
		description: coreTask.description,
		assignedAgent: coreTask.assignedRole ?? "",
		status: coreTask.status,
		complexity: coreTask.complexity,
		dependsOn: coreTask.dependsOn,
		branch: coreTask.branch,
		taskType: coreTask.type,
		output: coreTask.output !== undefined ? toKernelTaskOutput(coreTask.output) : undefined,
		retryCount: coreTask.retryCount,
		revisionCount: coreTask.revisionCount,
		requiresApproval: coreTask.requiresApproval,
		approvalStatus: coreTask.approvalStatus,
		riskLevel: coreTask.riskLevel,
		error: coreTask.error,
		startedAt: coreTask.startedAt,
		completedAt: coreTask.completedAt,
		parentTaskId: coreTask.parentTaskId,
		targetFiles: coreTask.targetFiles,
		reviewStatus: coreTask.reviewStatus,
		reviewerAgentId: coreTask.reviewerAgentId,
		reviewTaskId: coreTask.reviewTaskId,
		assignedAgentId: coreTask.assignedProvider,
		projectId: coreTask.projectId,
	};
}

// ---------------------------------------------------------------------------
// TaskOutput mappers
// ---------------------------------------------------------------------------

/**
 * Converts a kernel TaskOutput to the core TaskOutput contract.
 * The shapes are currently identical; this function makes the boundary
 * explicit so future divergence is caught at compile time.
 */
export function toCoreTaskOutput(output: KernelTaskOutput): CoreTaskOutput {
	return {
		filesCreated: output.filesCreated,
		filesModified: output.filesModified,
		testResults: output.testResults,
		logs: output.logs,
	};
}

/**
 * Converts a core TaskOutput back to a kernel TaskOutput.
 */
export function toKernelTaskOutput(output: CoreTaskOutput): KernelTaskOutput {
	return {
		filesCreated: output.filesCreated,
		filesModified: output.filesModified,
		testResults: output.testResults,
		logs: output.logs,
	};
}

// ---------------------------------------------------------------------------
// PipelineState mapper
// ---------------------------------------------------------------------------

/**
 * Converts a kernel PipelineState to the core PipelineState contract.
 *
 * Core PipelineStage uses `agents: unknown` and `tasks: unknown[]`, so the
 * kernel's strongly-typed agents/tasks arrays are assignable without casting.
 * We spread the stage fields to produce a shape that satisfies the core type.
 */
export function toCorePipelineState(state: KernelPipelineState): CorePipelineState {
	return {
		projectId: state.projectId,
		currentStage: state.currentStage,
		status: state.status,
		startedAt: state.startedAt,
		completedAt: state.completedAt,
		stages: state.stages.map((stage) => ({
			order: stage.order,
			status: stage.status,
			phaseId: stage.phaseId,
			// Core types use `unknown` for agents/tasks — no narrowing required.
			agents: stage.agents,
			tasks: stage.tasks,
		})),
	};
}

// ---------------------------------------------------------------------------
// Event adapter helper
// ---------------------------------------------------------------------------

import type { BaseEvent } from "@oscorpex/core";
import type { StudioEvent } from "../types.js";

/**
 * Adapts a @oscorpex/core BaseEvent to the legacy Omit<StudioEvent, "id" | "timestamp">
 * shape expected by the kernel event-bus.
 *
 * BaseEvent has additional required fields (correlationId, runId) that StudioEvent
 * does not model — they are carried through the payload or discarded gracefully.
 */
export function toStudioEventInput(
	event: BaseEvent<string, unknown>,
): Omit<StudioEvent, "id" | "timestamp"> {
	return {
		projectId: event.projectId,
		type: event.type as StudioEvent["type"],
		agentId: event.agentId,
		taskId: event.taskId,
		payload: (event.payload as Record<string, unknown>) ?? {},
		correlationId: event.correlationId,
		causationId: event.causationId,
	};
}

// ---------------------------------------------------------------------------
// Null-safe wrappers — used by KernelTaskStore where DB calls may return
// `Task | undefined` / `Task | null` instead of `Task`.
// ---------------------------------------------------------------------------

/**
 * Maps a kernel Task that may be null/undefined to CoreTask | null.
 */
export function toCoreTaskOrNull(task: KernelTask | null | undefined): CoreTask | null {
	return task != null ? toCoreTask(task) : null;
}

/**
 * Maps a kernel Task that may be null/undefined to CoreTask, throwing if absent.
 * Use only when the caller contract guarantees the record exists.
 */
export function toCoreTaskOrThrow(task: KernelTask | null | undefined, id: string): CoreTask {
	if (task == null) throw new Error(`Task ${id} not found`);
	return toCoreTask(task);
}
