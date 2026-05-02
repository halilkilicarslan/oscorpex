// ---------------------------------------------------------------------------
// Oscorpex — Studio Event Factory
//
// Helper functions that build strongly-typed emit payloads ready for
// eventBus.emit(). Each factory encodes the canonical type string, required
// fields, and optional payload properties so call-sites stay terse and
// consistent.
//
// Return type is `Omit<StudioEvent, "id" | "timestamp">` — the exact shape
// accepted by eventBus.emit() — keeping factories compatible with the
// current legacy API while payload fields align with EventPayloadMap.
// ---------------------------------------------------------------------------

import type { StudioEvent } from "@oscorpex/event-schema";

/** Convenience alias: the shape accepted by eventBus.emit() */
type EmitData = Omit<StudioEvent, "id" | "timestamp">;

// ---------------------------------------------------------------------------
// Task lifecycle
// ---------------------------------------------------------------------------

/**
 * Build a "task:started" emit payload.
 *
 * @param projectId  Project that owns the task
 * @param taskId     The task being started
 * @param agentId    Agent assigned to execute the task
 * @param opts       Optional display metadata (title, agentName)
 */
export function taskStartedEvent(
	projectId: string,
	taskId: string,
	agentId: string,
	opts?: { title?: string; agentName?: string },
): EmitData {
	return {
		type: "task:started",
		projectId,
		taskId,
		agentId,
		payload: {
			title: opts?.title,
			agentName: opts?.agentName,
		},
	};
}

/**
 * Build a "task:completed" emit payload.
 *
 * @param projectId  Project that owns the task
 * @param taskId     The completed task
 * @param output     Optional completion metadata
 */
export function taskCompletedEvent(
	projectId: string,
	taskId: string,
	output?: {
		title?: string;
		durationMs?: number;
		filesCreated?: string[];
		filesModified?: string[];
	},
): EmitData {
	return {
		type: "task:completed",
		projectId,
		taskId,
		payload: {
			title: output?.title,
			durationMs: output?.durationMs,
			filesCreated: output?.filesCreated,
			filesModified: output?.filesModified,
		},
	};
}

/**
 * Build a "task:failed" emit payload.
 *
 * @param projectId  Project that owns the task
 * @param taskId     The failed task
 * @param error      Error message or Error instance describing the failure
 * @param opts       Optional metadata (retryCount, isTransient, title)
 */
export function taskFailedEvent(
	projectId: string,
	taskId: string,
	error: string | Error,
	opts?: { title?: string; retryCount?: number; isTransient?: boolean },
): EmitData {
	return {
		type: "task:failed",
		projectId,
		taskId,
		payload: {
			title: opts?.title,
			error: error instanceof Error ? error.message : error,
			retryCount: opts?.retryCount,
			isTransient: opts?.isTransient,
		},
	};
}

// ---------------------------------------------------------------------------
// Pipeline lifecycle
// ---------------------------------------------------------------------------

/**
 * Build a "pipeline:stage_started" emit payload.
 * Signals that the pipeline has advanced to a new stage.
 *
 * @param projectId   Project running the pipeline
 * @param stageIndex  Zero-based stage index in the pipeline DAG
 * @param opts        Optional stageName / phaseId for richer context
 */
export function pipelineAdvancedEvent(
	projectId: string,
	stageIndex: number,
	opts?: { stageName?: string; phaseId?: string },
): EmitData {
	return {
		type: "pipeline:stage_started",
		projectId,
		payload: {
			stageIndex,
			stageName: opts?.stageName,
			phaseId: opts?.phaseId,
		},
	};
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

/**
 * Build a "task:approval_required" emit payload.
 *
 * @param projectId  Project that owns the task
 * @param taskId     The task awaiting human or automated approval
 * @param opts       Optional riskLevel, reason, title
 */
export function approvalRequestedEvent(
	projectId: string,
	taskId: string,
	opts?: { title?: string; riskLevel?: string; reason?: string },
): EmitData {
	return {
		type: "task:approval_required",
		projectId,
		taskId,
		payload: {
			title: opts?.title,
			riskLevel: opts?.riskLevel,
			reason: opts?.reason,
		},
	};
}

// ---------------------------------------------------------------------------
// Provider fallback
// ---------------------------------------------------------------------------

/**
 * Build a "provider:degraded" emit payload signalling a provider fallback.
 *
 * The `from` provider is stored in the top-level `agentId` field (convention
 * matches existing call-sites) and as the `provider` payload field.
 * The `to` provider is stored in the payload `reason` string so the console
 * can display which fallback was selected.
 *
 * @param projectId  Project context
 * @param from       Provider that became unavailable / degraded
 * @param to         Provider selected as the fallback
 * @param reason     Optional human-readable explanation; defaults to a
 *                   generated "Falling back from X to Y" string
 */
export function providerFallbackEvent(
	projectId: string,
	from: string,
	to: string,
	reason?: string,
): EmitData {
	return {
		type: "provider:degraded",
		projectId,
		payload: {
			provider: from,
			reason: reason ?? `Falling back from ${from} to ${to}`,
			fallbackProvider: to,
		},
	};
}
