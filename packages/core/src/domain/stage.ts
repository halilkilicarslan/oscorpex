// @oscorpex/core — Canonical stage and pipeline domain types
// PipelineStageStatus, PipelineStatus, PipelineStage, PipelineState, PhaseStatus

export type PipelineStageStatus = "pending" | "running" | "completed" | "failed";

export type PipelineStatus = "idle" | "running" | "paused" | "completed" | "failed";

export type PhaseStatus = "pending" | "running" | "completed" | "failed";

export interface Stage {
	id: string;
	runId: string;
	order: number;
	name: string;
	status: PipelineStageStatus;
	taskIds: string[];
	dependsOnStageIds?: string[];
}

export interface PipelineStage {
	order: number;
	agents: unknown;
	tasks: unknown[];
	status: PipelineStageStatus;
	phaseId?: string;
}

export interface PipelineState {
	projectId: string;
	stages: PipelineStage[];
	currentStage: number;
	status: PipelineStatus;
	startedAt?: string;
	completedAt?: string;
}

export interface PipelineRun {
	id: string;
	projectId: string;
	currentStage: number;
	status: PipelineStatus;
	stagesJson: string;
	version: number;
	startedAt?: string;
	completedAt?: string;
	createdAt: string;
}