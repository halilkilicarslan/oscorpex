// ---------------------------------------------------------------------------
// Oscorpex — Pipeline Execution Engine v2
// DAG tabanlı paralel execution: agent_dependencies'den dependency graph
// oluşturur, bağımlılıkları karşılanan agent'ları paralel çalıştırır.
//
// Backward compat: Eğer agent_dependencies tablosu boşsa, eski
// pipeline_order tabanlı lineer stage mantığına geri döner.
//
// Review Loop: Reviewer dependency'si olan agent'lar tamamlandığında
// task 'review' durumuna geçer. Reviewer onay/ret verir.
// Max 3 revizyon döngüsü sonrası tech-lead'e eskalasyon.
//
// Gate: Tüm predecessor'lar tamamlanmalı (ör: DevOps deploy).
// ---------------------------------------------------------------------------

import { evaluateReplan } from "./adaptive-replanner.js";
import {
	createPipelineRun,
	getProject,
	mutatePipelineState,
	updatePipelineRun,
} from "./db.js";
import { eventBus } from "./event-bus.js";
import { createLogger } from "./logger.js";
import { PipelineBuildService } from "./pipeline/pipeline-build-service.js";
import { PipelineCompletionService } from "./pipeline/pipeline-completion-service.js";
import { PipelineControlService } from "./pipeline/pipeline-control-service.js";
import { PipelineReviewHelpers } from "./pipeline/pipeline-review-helpers.js";
import { StageAdvanceOrchestrator } from "./pipeline/stage-advance-service.js";
import { PipelineBranchManager } from "./pipeline/vcs-phase-hooks.js";
import { PipelineStateManager, runToState } from "./pipeline/pipeline-state-service.js";
import { PipelineTaskHook } from "./pipeline/pipeline-task-hook.js";
import { taskEngine } from "./task-engine.js";
import type {
	PipelineStage,
	PipelineState,
	PipelineStatus,
	ProjectAgent,
} from "./types.js";

const log = createLogger("pipeline-engine");

// ---------------------------------------------------------------------------
// DAG wave generation is now in @oscorpex/task-graph (buildDAGWaves).
// The kernel uses buildDAGStages/buildLinearStages from task-graph
// for stage construction, and handles DB persistence + event emission locally.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pipeline Engine ana sınıfı
// ---------------------------------------------------------------------------

class PipelineEngine {
	private buildService: PipelineBuildService;
	private branchManager: PipelineBranchManager;
	private stateManager: PipelineStateManager;
	private completionService: PipelineCompletionService;
	private controlService: PipelineControlService;
	private reviewHelpers: PipelineReviewHelpers;
	private taskHook: PipelineTaskHook;
	private stageAdvanceOrchestrator: StageAdvanceOrchestrator;

	constructor() {
		this.buildService = new PipelineBuildService();
		this.branchManager = new PipelineBranchManager();
		this.stateManager = new PipelineStateManager();
		this.completionService = new PipelineCompletionService(this.stateManager, this.branchManager);
		this.controlService = new PipelineControlService(this.stateManager);
		this.reviewHelpers = new PipelineReviewHelpers();
		this.stageAdvanceOrchestrator = new StageAdvanceOrchestrator(this.stateManager, {
			completeStage: (projectId, stageIndex) => this.completeStage(projectId, stageIndex),
			markFailed: (projectId, reason) => this.markFailed(projectId, reason),
		});
		this.taskHook = new PipelineTaskHook(
			(projectId) => this.advanceStage(projectId),
			(projectId) => this.startPipeline(projectId),
		);
	}

	// -------------------------------------------------------------------------
	// Pipeline inşası
	// -------------------------------------------------------------------------

	/**
	 * Projedeki agent'ları ve plan phase'lerini okuyarak pipeline aşamalarını oluşturur.
	 *
	 * v2 stratejisi:
	 *   1. agent_dependencies tablosundan dependency graph'ı oku
	 *   2. Dependency varsa → DAG wave'leri oluştur (paralel execution)
	 *   3. Dependency yoksa → eski pipeline_order tabanlı lineer stage (backward compat)
	 *   4. Her wave bir PipelineStage olur
	 *   5. Wave'deki agent'ların task'ları plan phase'lerinden eşleştirilir
	 */
	async buildPipeline(projectId: string): Promise<PipelineState> {
		return this.buildService.buildPipeline(projectId);
	}

	// (DAG/linear stage building and agent matching now live in @oscorpex/task-graph)

	// -------------------------------------------------------------------------
	// Pipeline başlatma
	// -------------------------------------------------------------------------

	async startPipeline(projectId: string): Promise<PipelineState> {
		const project = await getProject(projectId);
		if (!project) throw new Error(`Proje bulunamadı: ${projectId}`);

		const state = await this.buildPipeline(projectId);
		state.status = "running";
		state.startedAt = now();

		// DB-first: create pipeline run in DB, then populate cache
		await createPipelineRun({
			projectId,
			status: "running",
			stagesJson: JSON.stringify(state.stages),
		});
		await updatePipelineRun(projectId, {
			currentStage: 0,
			status: "running",
			startedAt: state.startedAt,
		});

		// Refresh cache from DB to ensure consistency
		await this.stateManager.loadState(projectId);

		if (state.stages.length > 0) {
			await this.startStage(projectId, 0);
		} else {
			await this.markCompleted(projectId);
		}

		return (await this.stateManager.getState(projectId))!;
	}

	// -------------------------------------------------------------------------
	// Aşama yönetimi
	// -------------------------------------------------------------------------

	private async startStage(projectId: string, stageIndex: number): Promise<void> {
		// DB-first: mutate via locked transaction
		const run = await mutatePipelineState(projectId, async (run) => {
			const stages = JSON.parse(run.stagesJson) as PipelineStage[];
			if (stageIndex >= stages.length) return {};
			stages[stageIndex].status = "running";
			return {
				currentStage: stageIndex,
				stagesJson: JSON.stringify(stages),
			};
		});
		this.stateManager.invalidateCache(projectId);

		const state = runToState(run);
		this.stateManager.setCacheEntry(projectId, state);

		if (stageIndex >= state.stages.length) {
			await this.markCompleted(projectId);
			return;
		}

		const stage = state.stages[stageIndex];

		// Phase başlarken otomatik git branch oluştur — pipeline'ı bloklamaz
		this.branchManager.createPhaseBranch(projectId, stageIndex, stage).catch((err) =>
			log.warn(`[pipeline-engine] Phase branch oluşturulamadı (stage ${stageIndex}):` + " " + String(err)),
		);

		eventBus.emit({
			projectId,
			type: "pipeline:stage_started",
			payload: {
				stageIndex,
				stageOrder: stage.order,
				agentCount: stage.agents.length,
				taskCount: stage.tasks.length,
			},
		});

		if (stage.tasks.length === 0) {
			await this.completeStage(projectId, stageIndex);
		}
	}

	private async completeStage(projectId: string, stageIndex: number): Promise<void> {
		// DB-first: mark stage completed via locked transaction
		const run = await mutatePipelineState(projectId, async (dbRun) => {
			const stages = JSON.parse(dbRun.stagesJson) as PipelineStage[];
			if (!stages[stageIndex]) return {};
			stages[stageIndex].status = "completed";
			return { stagesJson: JSON.stringify(stages) };
		});
		this.stateManager.invalidateCache(projectId);

		const state = runToState(run);
		this.stateManager.setCacheEntry(projectId, state);

		const stage = state.stages[stageIndex];
		if (!stage) return;

		// Phase tamamlanınca branch'i main'e merge et — pipeline'ı bloklamaz
		this.branchManager.mergePhaseBranchToMain(projectId, stageIndex, stage).catch((err) =>
			log.warn(`[pipeline-engine] Phase branch merge edilemedi (stage ${stageIndex}):` + " " + String(err)),
		);

		eventBus.emit({
			projectId,
			type: "pipeline:stage_completed",
			payload: {
				stageIndex,
				stageOrder: stage.order,
			},
		});

		// --- Adaptive Replanning: evaluate at phase boundary ---
		evaluateReplan({ projectId, trigger: "phase_end", phaseId: stage.phaseId }).catch((err) =>
			log.warn(`[pipeline-engine] Adaptive replan failed (non-blocking):` + " " + String(err)),
		);

		const nextIndex = stageIndex + 1;
		if (nextIndex < state.stages.length) {
			await this.startStage(projectId, nextIndex);
		} else {
			await this.markCompleted(projectId);
		}
	}

	private async markCompleted(projectId: string): Promise<void> {
		return this.completionService.markCompleted(projectId);
	}

	private async markFailed(projectId: string, reason: string): Promise<void> {
		return this.completionService.markFailed(projectId, reason);
	}

	// -------------------------------------------------------------------------
	// Aşama ilerleme kontrolü (task tamamlandığında çağrılır)
	// -------------------------------------------------------------------------

	/**
	 * Mevcut aşamanın tüm görevlerinin tamamlanıp tamamlanmadığını kontrol eder.
	 * Orchestration logic StageAdvanceOrchestrator'a devredilmiştir.
	 *
	 * v2 ek kontroller:
	 *   - 'review' durumundaki task'lar henüz tamamlanmamış sayılır
	 *   - 'revision' durumundaki task'lar henüz tamamlanmamış sayılır
	 *   - Sadece 'done' durumundakiler tamamlanmış sayılır
	 */
	async advanceStage(projectId: string): Promise<PipelineState> {
		return this.stageAdvanceOrchestrator.advance(projectId);
	}

	// -------------------------------------------------------------------------
	// Durum sorgulama — delegates to stateManager
	// -------------------------------------------------------------------------

	async getPipelineState(projectId: string): Promise<PipelineState | null> {
		return this.stateManager.getPipelineState(projectId);
	}

	async getEnrichedPipelineStatus(projectId: string): Promise<{
		pipelineState: PipelineState | null;
		taskProgress: Awaited<ReturnType<ReturnType<typeof taskEngine>["getProgress"]>>;
		derivedStatus: PipelineStatus;
		warning?: string;
	}> {
		return this.stateManager.getEnrichedPipelineStatus(projectId, (pid) => this.advanceStage(pid));
	}

	// -------------------------------------------------------------------------
	// Durdurma / Devam ettirme
	// -------------------------------------------------------------------------

	async pausePipeline(projectId: string): Promise<void> {
		return this.controlService.pausePipeline(projectId);
	}

	async resumePipeline(projectId: string): Promise<void> {
		return this.controlService.resumePipeline(projectId, (pid) => this.advanceStage(pid));
	}

	/**
	 * Failed pipeline'ı kurtarır: failed task'ları queued'e çevirir,
	 * pipeline stage'i running'e döndürür ve advanceStage ile devam eder.
	 */
	async retryFailedPipeline(projectId: string): Promise<void> {
		return this.controlService.retryFailedPipeline(projectId, (pid) => this.advanceStage(pid));
	}

	// v3.3: Refresh pipeline — delegates to stateManager
	async refreshPipeline(projectId: string): Promise<void> {
		return this.stateManager.refreshPipeline(projectId);
	}

	// -------------------------------------------------------------------------
	// Review loop helper: Bir agent'ın reviewer'ını bul
	// -------------------------------------------------------------------------

	/**
	 * Verilen agent'ın review dependency'si olan reviewer agent'ı döner.
	 * agent_dependencies tablosunda type='review' olan edge'i arar.
	 * fromAgentId = dev agent, toAgentId = reviewer agent
	 */
	async findReviewerForAgent(projectId: string, agentId: string): Promise<ProjectAgent | null> {
		return this.reviewHelpers.findReviewerForAgent(projectId, agentId);
	}

	/**
	 * Bir reviewer'ın dev agent'ını bul (review ret durumunda revision için).
	 */
	async findDevForReviewer(projectId: string, reviewerAgentId: string): Promise<ProjectAgent | null> {
		return this.reviewHelpers.findDevForReviewer(projectId, reviewerAgentId);
	}

	// -------------------------------------------------------------------------
	// TaskEngine entegrasyonu — görev tamamlama hook'u
	// -------------------------------------------------------------------------

	/**
	 * Debounced advanceStage — coalesces rapid-fire task completions into a single advance call.
	 * Prevents DB deadlock when multiple tasks complete near-simultaneously.
	 */
	private debouncedAdvance(projectId: string): void {
		this.taskHook.debouncedAdvance(projectId);
	}

	registerTaskHook(): void {
		this.taskHook.register();
	}
}

// ---------------------------------------------------------------------------
// Helper functions (module-level)
// ---------------------------------------------------------------------------

function now(): string {
	return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Factory — lazy singleton accessed via pipelineEngine()
// ---------------------------------------------------------------------------

let _instance: PipelineEngine | null = null;

export function pipelineEngine(): PipelineEngine {
	if (!_instance) throw new Error("PipelineEngine not initialized — call initPipelineEngine() first");
	return _instance;
}

export function initPipelineEngine(): PipelineEngine {
	if (_instance) return _instance;
	_instance = new PipelineEngine();
	return _instance;
}
