// ---------------------------------------------------------------------------
// Oscorpex — Pipeline Engine Types
// ---------------------------------------------------------------------------

import type { ProjectAgent } from "./agent-types.js";
import type { Task } from "./task-types.js";

// Bir pipeline aşamasının (stage) durumu
export type PipelineStageStatus = "pending" | "running" | "completed" | "failed";

// Genel pipeline durumu
export type PipelineStatus = "idle" | "running" | "paused" | "completed" | "failed";

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
