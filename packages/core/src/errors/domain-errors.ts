// @oscorpex/core — Domain error types

export class OscorpexError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "OscorpexError";
	}
}

export class TaskTransitionError extends OscorpexError {
	constructor(
		public readonly fromStatus: string,
		public readonly toStatus: string,
		public readonly taskId: string,
		reason?: string,
	) {
		super("TASK_TRANSITION_ERROR", `Invalid task transition: ${fromStatus} → ${toStatus} for task ${taskId}${reason ? ` (${reason})` : ""}`);
		this.name = "TaskTransitionError";
	}
}

export class PipelineError extends OscorpexError {
	constructor(
		message: string,
		public readonly pipelineId: string,
		details?: Record<string, unknown>,
	) {
		super("PIPELINE_ERROR", message, details);
		this.name = "PipelineError";
	}
}

export class PhaseTransitionError extends OscorpexError {
	constructor(
		public readonly fromStatus: string,
		public readonly toStatus: string,
		public readonly phaseId: string,
	) {
		super("PHASE_TRANSITION_ERROR", `Invalid phase transition: ${fromStatus} → ${toStatus} for phase ${phaseId}`);
		this.name = "PhaseTransitionError";
	}
}