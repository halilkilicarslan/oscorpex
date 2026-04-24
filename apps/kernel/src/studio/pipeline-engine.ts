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
	buildDAGWaves,
	buildLinearStages,
	findReviewerAgentId,
	findDevAgentId,
} from "@oscorpex/task-graph";
import type { DependencyEdge, GraphAgent, PlanPhase, PlanTask, StagePlan } from "@oscorpex/task-graph";
import {
	createPipelineRun,
	getLatestPlan,
	getPipelineRun,
	getProject,
	getProjectSetting,
	getTask,
	listAgentDependencies,
	listPhases,
	listProjectAgents,
	listTasks,
	mutatePipelineState,
	queryOne,
	updatePipelineRun,
	updateTask,
} from "./db.js";
import { generateReadme } from "./docs-generator.js";
import { eventBus } from "./event-bus.js";
import { executionEngine } from "./execution-engine.js";
import { gitManager } from "./git-manager.js";
import { GitHubIntegration } from "./github-integration.js";
import { transitionProject } from "./lifecycle-manager.js";
import { decrypt, isEncrypted } from "./secret-vault.js";
import { taskEngine } from "./task-engine.js";
import { evaluateReplan } from "./adaptive-replanner.js";
import type {
	AgentDependency,
	Phase,
	PipelineStage,
	PipelineState,
	PipelineStatus,
	ProjectAgent,
	Task,
} from "./types.js";
import { createLogger } from "./logger.js";

const log = createLogger("pipeline-engine");

// ---------------------------------------------------------------------------
// Read-through cache (projectId → PipelineState)
// This is a PERFORMANCE CACHE ONLY. DB is the single source of truth.
// Cache is invalidated after every mutation via mutatePipelineState().
// ---------------------------------------------------------------------------
const _cache = new Map<string, PipelineState>();

// ---------------------------------------------------------------------------
// Yardımcı fonksiyonlar
// ---------------------------------------------------------------------------

function now(): string {
	return new Date().toISOString();
}

/** Convert PipelineRun (DB row) to PipelineState (runtime model) */
function runToState(run: { projectId: string; stagesJson: string; currentStage: number; status: PipelineStatus; startedAt?: string; completedAt?: string }): PipelineState {
	return {
		projectId: run.projectId,
		stages: JSON.parse(run.stagesJson) as PipelineStage[],
		currentStage: run.currentStage,
		status: run.status,
		startedAt: run.startedAt,
		completedAt: run.completedAt,
	};
}

/** Persist state to DB and update cache. Used for simple non-locked writes. */
async function persistState(state: PipelineState): Promise<void> {
	await updatePipelineRun(state.projectId, {
		currentStage: state.currentStage,
		status: state.status,
		stagesJson: JSON.stringify(state.stages),
		startedAt: state.startedAt,
		completedAt: state.completedAt,
	});
	_cache.set(state.projectId, state);
}

/** Load state from DB (single source of truth). Updates cache. */
async function loadState(projectId: string): Promise<PipelineState | null> {
	const run = await getPipelineRun(projectId);
	if (!run) return null;
	const state = runToState(run);
	_cache.set(projectId, state);
	return state;
}

/** Invalidate cache for a project — forces next read from DB */
function invalidateCache(projectId: string): void {
	_cache.delete(projectId);
}

/** Get state: cache first, then DB. Never trust cache for mutations. */
async function getState(projectId: string): Promise<PipelineState | null> {
	const cached = _cache.get(projectId);
	if (cached) return cached;
	return loadState(projectId);
}

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
		await loadState(projectId);

		if (state.stages.length > 0) {
			await this.startStage(projectId, 0);
		} else {
			await this.markCompleted(projectId);
		}

		return (await getState(projectId))!;
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
		invalidateCache(projectId);

		const state = runToState(run);
		_cache.set(projectId, state);

		if (stageIndex >= state.stages.length) {
			await this.markCompleted(projectId);
			return;
		}

		const stage = state.stages[stageIndex];

		// Phase başlarken otomatik git branch oluştur — pipeline'ı bloklamaz
		this.createPhaseBranch(projectId, stageIndex, stage).catch((err) =>
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

	/**
	 * Phase başlangıcında `phase/{stageIndex}-{agentRoles}` formatında
	 * git branch oluşturur. Başarısızlık pipeline'ı durdurmaz.
	 */
	private async createPhaseBranch(projectId: string, stageIndex: number, stage: PipelineStage): Promise<void> {
		const project = await getProject(projectId);
		if (!project?.repoPath) return;

		// Branch adı: phase/0-backend, phase/1-frontend vb.
		const roleSlug = stage.agents
			.map((a) => a.role.toLowerCase().replace(/[^a-z0-9]+/g, "-"))
			.join("-")
			.slice(0, 30); // Git branch adı sınırı
		const branchName = `phase/${stageIndex}-${roleSlug || "stage"}`;

		try {
			const branches = await gitManager.listBranches(project.repoPath);
			if (branches.includes(branchName)) {
				// Branch zaten varsa geçiş yap
				await gitManager.checkout(project.repoPath, branchName);
			} else {
				// Yeni branch oluştur
				await gitManager.createBranch(project.repoPath, branchName);
			}

			eventBus.emit({
				projectId,
				type: "pipeline:branch_created",
				payload: { branch: branchName, stageIndex },
			});
		} catch (err) {
			log.warn(`[pipeline-engine] Branch oluşturulamadı: ${branchName}` + " " + String(err));
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
		invalidateCache(projectId);

		const state = runToState(run);
		_cache.set(projectId, state);

		const stage = state.stages[stageIndex];
		if (!stage) return;

		// Phase tamamlanınca branch'i main'e merge et — pipeline'ı bloklamaz
		this.mergePhaseBranchToMain(projectId, stageIndex, stage).catch((err) =>
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

	/**
	 * Tamamlanan phase branch'ini main'e merge eder.
	 * Commit'lenecek değişiklik varsa önce commit atar.
	 * Conflict durumunda uyarı log'u bırakır ama pipeline devam eder.
	 */
	private async mergePhaseBranchToMain(projectId: string, stageIndex: number, stage: PipelineStage): Promise<void> {
		const project = await getProject(projectId);
		if (!project?.repoPath) return;

		const roleSlug = stage.agents
			.map((a) => a.role.toLowerCase().replace(/[^a-z0-9]+/g, "-"))
			.join("-")
			.slice(0, 30);
		const branchName = `phase/${stageIndex}-${roleSlug || "stage"}`;

		try {
			// Aktif branch bu phase branch'i mi kontrol et
			const currentBranch = await gitManager.getCurrentBranch(project.repoPath);
			if (currentBranch !== branchName) return; // Farklı branch'teyiz, işlem yapma

			// Uncommitted değişiklik varsa commit at
			const status = await gitManager.getStatus(project.repoPath);
			const hasChanges = status.modified.length > 0 || status.untracked.length > 0 || status.staged.length > 0;

			if (hasChanges) {
				await gitManager.commit(project.repoPath, `feat: phase ${stageIndex} tamamlandı (${roleSlug || "stage"})`);
			}

			// main branch'e merge et
			const result = await gitManager.mergeBranch(project.repoPath, branchName, "main");

			if (result.success) {
				eventBus.emit({
					projectId,
					type: "pipeline:branch_merged",
					payload: { branch: branchName, target: "main", stageIndex },
				});
			} else {
				// Conflict varsa main'e geri dön
				log.warn(`[pipeline-engine] Merge conflict tespit edildi: ${branchName} → main` + " " + String(result.conflicts));
				await gitManager.checkout(project.repoPath, "main").catch((err) => log.warn("[pipeline-engine] Non-blocking operation failed:", err?.message ?? err));
			}
		} catch (err) {
			log.warn(`[pipeline-engine] Branch merge atlandı: ${branchName}` + " " + String(err));
		}
	}

	private async markCompleted(projectId: string): Promise<void> {
		const completedAt = now();
		await mutatePipelineState(projectId, async () => ({
			status: "completed" as PipelineStatus,
			completedAt,
		}));
		invalidateCache(projectId);
		const state = await loadState(projectId);
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
		this.tryCreatePR(projectId).catch((err) => {
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

	/**
	 * Pipeline tamamlandığında otomatik PR oluşturma.
	 * GitHub token ve auto_pr ayarı kontrol edilir.
	 */
	private async tryCreatePR(projectId: string): Promise<void> {
		const autoPR = await getProjectSetting(projectId, "github", "auto_pr");
		if (autoPR !== "true") return;

		const tokenEncrypted = await getProjectSetting(projectId, "github", "token");
		if (!tokenEncrypted) return;

		const project = await getProject(projectId);
		if (!project?.repoPath) return;

		const repoInfo = GitHubIntegration.getRepoInfo(project.repoPath);
		if (!repoInfo) return;

		const token = isEncrypted(tokenEncrypted) ? decrypt(tokenEncrypted) : tokenEncrypted;
		const currentBranch = await gitManager.getCurrentBranch(project.repoPath);
		if (!currentBranch || currentBranch === "main" || currentBranch === "master") return;

		const gh = new GitHubIntegration(token);
		const pr = await gh.createPR({
			owner: repoInfo.owner,
			repo: repoInfo.repo,
			head: currentBranch,
			base: "main",
			title: `[Oscorpex] ${project.name} — Pipeline Completed`,
			body: `Automated PR from Oscorpex pipeline.\n\nProject: ${project.name}\nBranch: ${currentBranch}`,
		});

		log.info(`[pipeline-engine] PR oluşturuldu: ${pr.url}`);

		eventBus.emit({
			projectId,
			type: "git:pr-created" as any,
			payload: { prNumber: pr.number, prUrl: pr.url, branch: currentBranch },
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
		invalidateCache(projectId);
		const state = await loadState(projectId);
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
		const state = await loadState(projectId);
		if (!state) throw new Error(`${projectId} için pipeline durumu bulunamadı`);

		if (state.status === "paused" || state.status === "completed" || state.status === "failed") {
			return state;
		}

		// Block advance if there's a pending replan awaiting approval
		const pendingReplan = await queryOne(
			`SELECT id FROM replan_events WHERE project_id = $1 AND status = 'pending' LIMIT 1`,
			[projectId],
		);
		if (pendingReplan) {
			log.info(`[pipeline-engine] advanceStage blocked — pending replan ${pendingReplan.id} awaiting approval`);
			eventBus.emit({
				projectId,
				type: "plan:replanned",
				payload: { awaiting_approval: true, replanEventId: pendingReplan.id },
			});
			return state;
		}

		const currentIndex = state.currentStage;
		const currentStage = state.stages[currentIndex];
		if (!currentStage) return state;

		const freshTaskIds = await this.resolveStageTaskIds(projectId, currentIndex, state);

		if (freshTaskIds.length === 0) {
			await this.completeStage(projectId, currentIndex);
			return (await getState(projectId))!;
		}

		const statuses = await Promise.all(freshTaskIds.map((id) => this.getTaskStatus(id)));

		const anyFailed = statuses.some((s) => s === "failed");
		const allDone = statuses.every((s) => s === "done");

		if (anyFailed) {
			await this.markFailed(projectId, `Aşama ${currentIndex} (order=${currentStage.order}) görev hatası`);
		} else if (allDone) {
			await this.completeStage(projectId, currentIndex);
		}

		return (await getState(projectId))!;
	}

	private async resolveStageTaskIds(projectId: string, stageIndex: number, state: PipelineState): Promise<string[]> {
		const stage = state.stages[stageIndex];
		if (!stage) return [];

		if (stage.phaseId) {
			const latestTasks = await listTasks(stage.phaseId);
			stage.tasks = latestTasks;
			return latestTasks.map((t) => t.id);
		}

		if (stage.tasks.length > 0) {
			return stage.tasks.map((t) => t.id);
		}

		const plan = await getLatestPlan(projectId);
		if (!plan) return [];

		const phases = (await listPhases(plan.id)).sort((a, b) => a.order - b.order);
		const matchedPhase = phases[stageIndex];
		if (!matchedPhase) return [];

		stage.tasks = matchedPhase.tasks ?? [];
		return stage.tasks.map((t) => t.id);
	}

	private async getTaskStatus(taskId: string): Promise<string> {
		const task = await getTask(taskId);
		return task?.status ?? "queued";
	}

	// -------------------------------------------------------------------------
	// Durum sorgulama
	// -------------------------------------------------------------------------

	async getPipelineState(projectId: string): Promise<PipelineState | null> {
		return getState(projectId);
	}

	async getEnrichedPipelineStatus(projectId: string): Promise<{
		pipelineState: PipelineState | null;
		taskProgress: Awaited<ReturnType<typeof taskEngine.getProgress>>;
		derivedStatus: PipelineStatus;
		warning?: string;
	}> {
		let pipelineState = await this.getPipelineState(projectId);

		if (pipelineState?.status === "running") {
			try {
				await this.advanceStage(projectId);
				pipelineState = await this.getPipelineState(projectId);
			} catch {
				// status sorgusu sırasında hata olursa sessizce devam et
			}
		}

		const taskProgress = await taskEngine.getProgress(projectId);
		const overall = taskProgress.overall;

		let derivedStatus: PipelineStatus = pipelineState?.status ?? "idle";

		if (derivedStatus === "idle" || derivedStatus === "failed") {
			if (overall.running > 0) {
				derivedStatus = "running";
			} else if (overall.done > 0 && overall.running === 0 && overall.queued === 0 && overall.failed === 0) {
				derivedStatus = "completed";
			} else if (overall.failed > 0 && overall.running === 0 && overall.queued === 0) {
				derivedStatus = "failed";
			}
		}

		let warning: string | undefined;
		if (pipelineState?.status === "failed" && overall.running > 0) {
			warning = 'Pipeline kaydı "failed" gösterse de task\'lar hâlâ çalışıyor. Durum task verilerinden türetildi.';
		}

		return { pipelineState, taskProgress, derivedStatus, warning };
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
		invalidateCache(projectId);
		_cache.set(projectId, runToState(run));

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
		invalidateCache(projectId);
		_cache.set(projectId, runToState(run));

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
		invalidateCache(projectId);
		const state = runToState(run);
		_cache.set(projectId, state);

		// Failed task'ları queued'e çevir
		const taskIds = await this.resolveStageTaskIds(projectId, state.currentStage, state);
		for (const taskId of taskIds) {
			const status = await this.getTaskStatus(taskId);
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

	// v3.3: Refresh pipeline — rebuild DAG waves without resetting completed stages
	async refreshPipeline(projectId: string): Promise<void> {
		const agents = await listProjectAgents(projectId);
		const deps = await listAgentDependencies(projectId);
		const newWaves = buildDAGWaves(agents, deps);

		// DB-first: lock + validate + mutate atomically
		await mutatePipelineState(projectId, async (dbRun) => {
			if (dbRun.status !== "running") {
				throw new Error(`Pipeline refresh edilemiyor — mevcut durum: ${dbRun.status}`);
			}

			const stages = JSON.parse(dbRun.stagesJson) as PipelineStage[];
			const completedStageCount = stages.filter((s) => s.status === "completed").length;

			for (let i = completedStageCount; i < newWaves.length; i++) {
				const waveAgentIds = newWaves[i];
				const waveAgents = agents.filter((a) => waveAgentIds.includes(a.id));

				if (i < stages.length) {
					stages[i].agents = waveAgents;
				} else {
					stages.push({
						order: i,
						agents: waveAgents,
						tasks: [],
						status: "pending",
					});
				}
			}

			log.info(
				`[pipeline-engine] Pipeline refresh — ${newWaves.length} stage (${completedStageCount} completed korundu)`,
			);
			return { stagesJson: JSON.stringify(stages) };
		});
		invalidateCache(projectId);
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

	registerTaskHook(): void {
		if (this.taskHookRegistered) return;
		this.taskHookRegistered = true;

		taskEngine.onTaskCompleted((taskId, projectId) => {
			getPipelineRun(projectId)
				.then(async (run) => {
					if (run && run.status === "running") {
						try {
							await this.advanceStage(projectId);
						} catch (err) {
							log.error(`[pipeline-engine] advanceStage hatası (proje=${projectId}):` + " " + String(err));
						}
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
								await this.advanceStage(projectId);
							}
						} catch (err) {
							log.error(`[pipeline-engine] otomatik pipeline başlatma hatası (proje=${projectId}):` + " " + String(err));
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
// Singleton dışa aktarımı
// ---------------------------------------------------------------------------
export const pipelineEngine = new PipelineEngine();

// Uygulama başladığında TaskEngine hook'unu kaydet
pipelineEngine.registerTaskHook();
