// ---------------------------------------------------------------------------
// Oscorpex — Pipeline Engine Types
// ---------------------------------------------------------------------------

import type { ProjectAgent } from "./agent-types.js";
import type { Task } from "./task-types.js";

// Re-export canonical union types from @oscorpex/core
import type { PipelineStageStatus as _PipelineStageStatus, PipelineStatus as _PipelineStatus } from "@oscorpex/core";
export type PipelineStageStatus = _PipelineStageStatus;
export type PipelineStatus = _PipelineStatus;

// Pipeline aşaması: aynı pipeline_order değerine sahip agent'lar ve görevler bir arada
export interface PipelineStage {
	order: number;
	agents: ProjectAgent[];
	tasks: Task[];
	status: PipelineStageStatus;
	/** Eşleşen plan phase ID'si; stage → phase mapping için kullanılır */
	phaseId?: string;
}

// Bir projenin anlık pipeline durumu (hem bellekte hem DB'de saklanır)
export interface PipelineState {
	projectId: string;
	stages: PipelineStage[];
	currentStage: number;
	status: PipelineStatus;
	startedAt?: string;
	completedAt?: string;
}

// Veritabanındaki pipeline_runs tablosuna karşılık gelen arayüz
export interface PipelineRun {
	id: string;
	projectId: string;
	currentStage: number;
	status: PipelineStatus;
	stagesJson: string; // PipelineStage[] JSON olarak serileştirilmiş hali
	version: number;
	startedAt?: string;
	completedAt?: string;
	createdAt: string;
}
