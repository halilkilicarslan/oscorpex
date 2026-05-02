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

import {
	buildDAGStages,
	buildLinearStages,
	findDevAgentId,
	findReviewerAgentId,
} from "@oscorpex/task-graph";
import type { DependencyEdge, GraphAgent, PlanPhase, PlanTask, StagePlan } from "@oscorpex/task-graph";
import { evaluateReplan } from "./adaptive-replanner.js";
import {
	createPipelineRun,
	getLatestPlan,
	getPipelineRun,
	getProject,
	listAgentDependencies,
	listPhases,
	listProjectAgents,
	mutatePipelineState,
	updatePipelineRun,
	updateTask,
} from "./db.js";
import { generateReadme } from "./docs-generator.js";
import { eventBus } from "./event-bus.js";
import { executionEngine } from "./execution-engine.js";
import { createLogger } from "./logger.js";
import { transitionProject } from "./lifecycle-manager.js";
import { canAdvance } from "./pipeline/replan-gate.js";
import { decideStageAdvance } from "./pipeline/stage-advance-service.js";
import { PipelineBranchManager } from "./pipeline/vcs-phase-hooks.js";
import { PipelineStateManager, runToState } from "./pipeline/pipeline-state-service.js";
import { taskEngine } from "./task-engine.js";
import type {
	AgentDependency,
	Phase,
	PipelineStage,
	PipelineState,
	PipelineStatus,
	ProjectAgent,
	Task,
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
	// Guard: registerTaskHook() idempotent olmalı (boot.ts + module-level çağrı)
	private taskHookRegistered = false;

	// Debounce map: prevents concurrent advanceStage calls for the same project
	// When multiple tasks complete near-simultaneously, only one advanceStage runs
	private _advancePending = new Map<string, NodeJS.Timeout>();

	private branchManager: PipelineBranchManager;
	private stateManager: PipelineStateManager;

	constructor() {
		this.branchManager = new PipelineBranchManager();
		this.stateManager = new PipelineStateManager();
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
		const project = await getProject(projectId);
		if (!project) throw new Error(`Proje bulunamadı: ${projectId}`);

		const agents = await listProjectAgents(projectId);
		const plan = await getLatestPlan(projectId);
		const phases: Phase[] = plan ? await listPhases(plan.id) : [];

		const deps = await listAgentDependencies(projectId);
		const hasDeps = deps.some((d) => d.type !== "hierarchy");

		const stagePlans: StagePlan[] = hasDeps
			? buildDAGStages(toGraphAgents(agents), toDependencyEdges(deps), toPlanPhases(phases))
			: buildLinearStages(toGraphAgents(agents), toPlanPhases(phases));

		const stages: PipelineStage[] = stagePlans.map((sp) => ({
			order: sp.order,
			agents: agents.filter((a) => sp.agents.some((ga) => ga.id === a.id)),
			tasks: toKernelTasks(phases, sp),
			status: sp.status as PipelineStage["status"],
			phaseId: sp.phaseId,
		}));

		return {
			projectId,
			stages,
			currentStage: 0,
			status: "idle",
		};
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
		const completedAt = now();
		await mutatePipelineState(projectId, async () => ({
			status: "completed" as PipelineStatus,
			completedAt,
		}));
		this.stateManager.invalidateCache(projectId);
		const state = await this.stateManager.loadState(projectId);
		if (!state) return;

		eventBus.emit({
			projectId,
			type: "pipeline:completed",
			payload: { completedAt: state.completedAt },
		});

		// Pipeline tamamlandığında README.md otomatik oluştur — non-blocking
		generateReadme(projectId, (msg) => {
			log.info(`[pipeline-engine] ${msg}`);
		}).catch((err) => {
			log.error("[pipeline-engine] README oluşturma hatası:" + " " + String(err));
		});

		// Auto PR: GitHub yapılandırılmışsa ve auto_pr aktifse PR oluştur — fire-and-forget
		this.branchManager.tryCreatePR(projectId).catch((err) => {
			log.warn("[pipeline-engine] Auto PR oluşturulamadı:" + " " + String(err));
		});

		// v3.5: Lifecycle transition — pipeline completion flips project.status to "completed"
		// so it can enter maintenance on hotfix or be archived. Best-effort: if project is
		// not in a valid starting state (e.g. paused), fall back to a notification event.
		transitionProject(projectId, "completed").catch((err) => {
			log.warn("[pipeline-engine] lifecycle transition → completed failed:" + " " + String(err));
			eventBus.emit({
				projectId,
				type: "lifecycle:transition",
				payload: { to: "completed", trigger: "pipeline_completed", skipped: true, error: String(err) },
			});
		});
	}

	private async markFailed(projectId: string, reason: string): Promise<void> {
		const completedAt = now();
		await mutatePipelineState(projectId, async (dbRun) => {
			const stages = JSON.parse(dbRun.stagesJson) as PipelineStage[];
			const currentStage = stages[dbRun.currentStage];
			if (currentStage) currentStage.status = "failed";
			return {
				status: "failed" as PipelineStatus,
				stagesJson: JSON.stringify(stages),
				completedAt,
			};
		});
		this.stateManager.invalidateCache(projectId);
		const state = await this.stateManager.loadState(projectId);
		if (!state) return;

		eventBus.emit({
			projectId,
			type: "pipeline:failed",
			payload: { reason, failedAt: state.completedAt },
		});
	}

	// -------------------------------------------------------------------------
	// Aşama ilerleme kontrolü (task tamamlandığında çağrılır)
	// -------------------------------------------------------------------------

	/**
	 * Mevcut aşamanın tüm görevlerinin tamamlanıp tamamlanmadığını kontrol eder.
	 *
	 * v2 ek kontroller:
	 *   - 'review' durumundaki task'lar henüz tamamlanmamış sayılır
	 *   - 'revision' durumundaki task'lar henüz tamamlanmamış sayılır
	 *   - Sadece 'done' durumundakiler tamamlanmış sayılır
	 */
	async advanceStage(projectId: string): Promise<PipelineState> {
		// Always read from DB for correctness (cache is just performance)
		// Use withTransaction + SELECT FOR UPDATE to prevent concurrent advanceStage race conditions
		const state = await this.stateManager.loadState(projectId);
		if (!state) throw new Error(`${projectId} için pipeline durumu bulunamadı`);

		if (state.status === "paused" || state.status === "completed" || state.status === "failed") {
			return state;
		}

		// Acquire row-level lock to prevent concurrent advanceStage from double-advancing
		const lockedRun = await this.stateManager.acquireAdvanceLock(projectId);
		if (!lockedRun) {
			log.info(`[pipeline-engine] advanceStage skipped — could not acquire lock (project=${projectId})`);
			return state;
		}

		// Block advance if there's a pending replan awaiting approval
		const replanGate = await canAdvance(projectId);
		if (!replanGate.allowed) {
			log.info(`[pipeline-engine] advanceStage blocked — pending replan ${replanGate.replanEventId} awaiting approval`);
			eventBus.emit({
				projectId,
				type: "plan:replanned",
				payload: { awaiting_approval: true, replanEventId: replanGate.replanEventId },
			});
			return state;
		}

		const currentIndex = state.currentStage;
		const currentStage = state.stages[currentIndex];
		if (!currentStage) return state;

		const freshTaskIds = await this.stateManager.resolveStageTaskIds(projectId, currentIndex, state);

		if (freshTaskIds.length === 0) {
			await this.completeStage(projectId, currentIndex);
			return (await this.stateManager.getState(projectId))!;
		}

		const statuses = await Promise.all(freshTaskIds.map((id) => this.stateManager.getTaskStatus(id)));

		const decision = decideStageAdvance(statuses);
		if (decision === "failed") {
			await this.markFailed(projectId, `Aşama ${currentIndex} (order=${currentStage.order}) görev hatası`);
		} else if (decision === "completed") {
			await this.completeStage(projectId, currentIndex);
		}

		return (await this.stateManager.getState(projectId))!;
	}

	// -------------------------------------------------------------------------
	// Durum sorgulama — delegates to stateManager
	// -------------------------------------------------------------------------

	async getPipelineState(projectId: string): Promise<PipelineState | null> {
		return this.stateManager.getPipelineState(projectId);
	}

	async getEnrichedPipelineStatus(projectId: string): Promise<{
		pipelineState: PipelineState | null;
		taskProgress: Awaited<ReturnType<typeof taskEngine.getProgress>>;
		derivedStatus: PipelineStatus;
		warning?: string;
	}> {
		return this.stateManager.getEnrichedPipelineStatus(projectId, (pid) => this.advanceStage(pid));
	}

	// -------------------------------------------------------------------------
	// Durdurma / Devam ettirme
	// -------------------------------------------------------------------------

	async pausePipeline(projectId: string): Promise<void> {
		// DB-first: lock + validate + mutate atomically
		const run = await mutatePipelineState(projectId, async (dbRun) => {
			if (dbRun.status !== "running") {
				throw new Error(`Pipeline duraklatılamaz — mevcut durum: ${dbRun.status}`);
			}
			return { status: "paused" as PipelineStatus };
		});
		this.stateManager.invalidateCache(projectId);
		this.stateManager.setCacheEntry(projectId, runToState(run));

		// Actually stop running agent processes and abort in-flight tasks
		const cancelledCount = await executionEngine.cancelRunningTasks(projectId);
		log.info(`[pipeline-engine] Pipeline paused: ${cancelledCount} task(s) cancelled for ${projectId}`);

		eventBus.emit({
			projectId,
			type: "pipeline:paused",
			payload: { pausedAt: now(), currentStage: run.currentStage, cancelledTasks: cancelledCount },
		});
	}

	async resumePipeline(projectId: string): Promise<void> {
		// DB-first: lock + validate + mutate atomically
		const run = await mutatePipelineState(projectId, async (dbRun) => {
			if (dbRun.status !== "paused") {
				throw new Error(`Pipeline devam ettirilemiyor — mevcut durum: ${dbRun.status}`);
			}
			return { status: "running" as PipelineStatus };
		});
		this.stateManager.invalidateCache(projectId);
		this.stateManager.setCacheEntry(projectId, runToState(run));

		eventBus.emit({
			projectId,
			type: "pipeline:resumed",
			payload: { resumedAt: now(), currentStage: run.currentStage },
		});

		// Re-dispatch queued tasks that were paused
		executionEngine.startProjectExecution(projectId).catch((err) => {
			log.error(`[pipeline-engine] Resume dispatch failed:` + " " + String(err));
		});

		await this.advanceStage(projectId);
	}

	/**
	 * Failed pipeline'ı kurtarır: failed task'ları queued'e çevirir,
	 * pipeline stage'i running'e döndürür ve advanceStage ile devam eder.
	 */
	async retryFailedPipeline(projectId: string): Promise<void> {
		// DB-first: lock + validate + mutate atomically
		const run = await mutatePipelineState(projectId, async (dbRun) => {
			if (dbRun.status !== "failed") {
				throw new Error(`Pipeline retry edilemiyor — mevcut durum: ${dbRun.status}`);
			}
			const stages = JSON.parse(dbRun.stagesJson) as PipelineStage[];
			const currentStage = stages[dbRun.currentStage];
			if (currentStage) currentStage.status = "running";
			return {
				status: "running" as PipelineStatus,
				stagesJson: JSON.stringify(stages),
				completedAt: undefined,
			};
		});
		this.stateManager.invalidateCache(projectId);
		const state = runToState(run);
		this.stateManager.setCacheEntry(projectId, state);

		// Failed task'ları queued'e çevir
		const taskIds = await this.stateManager.resolveStageTaskIds(projectId, state.currentStage, state);
		for (const taskId of taskIds) {
			const status = await this.stateManager.getTaskStatus(taskId);
			if (status === "failed") {
				await updateTask(taskId, { status: "queued", error: undefined, retryCount: 0 });
			}
		}

		eventBus.emit({
			projectId,
			type: "pipeline:resumed",
			payload: { resumedAt: now(), currentStage: state.currentStage, reason: "retry_failed" },
		});

		await this.advanceStage(projectId);
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
		const deps = await listAgentDependencies(projectId, "review");
		// from → to ilişkisinde: "to" review'ı yapan
		// Ama review dependency mantığı: dev (from) → reviewer (to) şeklinde
		// "dev'in çıktısı reviewer'a gider" anlamında
		const reviewDep = deps.find((d) => d.fromAgentId === agentId);
		if (!reviewDep) return null;

		const agents = await listProjectAgents(projectId);
		return agents.find((a) => a.id === reviewDep.toAgentId) ?? null;
	}

	/**
	 * Bir reviewer'ın dev agent'ını bul (review ret durumunda revision için).
	 */
	async findDevForReviewer(projectId: string, reviewerAgentId: string): Promise<ProjectAgent | null> {
		const deps = await listAgentDependencies(projectId, "review");
		const reviewDep = deps.find((d) => d.toAgentId === reviewerAgentId);
		if (!reviewDep) return null;

		const agents = await listProjectAgents(projectId);
		return agents.find((a) => a.id === reviewDep.fromAgentId) ?? null;
	}

	// -------------------------------------------------------------------------
	// TaskEngine entegrasyonu — görev tamamlama hook'u
	// -------------------------------------------------------------------------

	/**
	 * Debounced advanceStage — coalesces rapid-fire task completions into a single advance call.
	 * Prevents DB deadlock when multiple tasks complete near-simultaneously.
	 */
	private debouncedAdvance(projectId: string): void {
		const existing = this._advancePending.get(projectId);
		if (existing) clearTimeout(existing);

		const timer = setTimeout(() => {
			this._advancePending.delete(projectId);
			this.advanceStage(projectId).catch((err) => {
				log.error(`[pipeline-engine] advanceStage hatası (proje=${projectId}):` + " " + String(err));
			});
		}, 200);
		this._advancePending.set(projectId, timer);
	}

	registerTaskHook(): void {
		if (this.taskHookRegistered) return;
		this.taskHookRegistered = true;

		taskEngine.onTaskCompleted((taskId, projectId) => {
			getPipelineRun(projectId)
				.then(async (run) => {
					if (run && run.status === "running") {
						this.debouncedAdvance(projectId);
						return;
					}

					if (!run || run.status === "idle" || run.status === "failed") {
						try {
							const agents = await listProjectAgents(projectId);
							if (agents.length > 0) {
								log.info(
									`[pipeline-engine] Task tamamlandı ama pipeline başlatılmamış; otomatik başlatılıyor (proje=${projectId})`,
								);
								await this.startPipeline(projectId);
								this.debouncedAdvance(projectId);
							}
						} catch (err) {
							log.error(
								`[pipeline-engine] otomatik pipeline başlatma hatası (proje=${projectId}):` + " " + String(err),
							);
						}
					}
				})
				.catch((err) => {
					log.error(`[pipeline-engine] getPipelineRun hatası (proje=${projectId}):` + " " + String(err));
				});
		});
	}
}

// ---------------------------------------------------------------------------
// Adapter helpers: kernel types → task-graph lightweight interfaces
// ---------------------------------------------------------------------------

function toGraphAgents(agents: ProjectAgent[]): GraphAgent[] {
	return agents.map((a) => ({
		id: a.id,
		name: a.name,
		role: a.role,
		skills: a.skills,
		sourceAgentId: a.sourceAgentId,
		reportsTo: a.reportsTo,
		pipelineOrder: a.pipelineOrder,
		personality: a.personality,
	}));
}

function toDependencyEdges(deps: AgentDependency[]): DependencyEdge[] {
	return deps.map((d) => ({
		fromAgentId: d.fromAgentId,
		toAgentId: d.toAgentId,
		type: d.type,
		metadata: d.metadata,
	}));
}

function toPlanPhases(phases: Phase[]): PlanPhase[] {
	return phases.map((ph) => ({
		id: ph.id,
		order: ph.order,
		name: ph.name,
		status: ph.status,
		tasks: (ph.tasks ?? []).map((t) => ({
			id: t.id,
			title: t.title,
			status: t.status,
			assignedAgent: t.assignedAgent,
			assignedAgentId: t.assignedAgentId,
			complexity: t.complexity,
			description: t.description,
			targetFiles: t.targetFiles,
			dependsOn: t.dependsOn,
			phaseId: t.phaseId,
			output: t.output,
		})),
	}));
}

function toKernelTasks(phases: Phase[], stagePlan: StagePlan): Task[] {
	const allKernelTasks = phases.flatMap((ph) => ph.tasks ?? []);
	const stageTaskIds = new Set(stagePlan.tasks.map((t) => t.id));
	return allKernelTasks.filter((t) => stageTaskIds.has(t.id));
}

// ---------------------------------------------------------------------------
// Helper functions (module-level)
// ---------------------------------------------------------------------------

function now(): string {
	return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Singleton dışa aktarımı
// ---------------------------------------------------------------------------
export const pipelineEngine = new PipelineEngine();

// Uygulama başladığında TaskEngine hook'unu kaydet
pipelineEngine.registerTaskHook();
