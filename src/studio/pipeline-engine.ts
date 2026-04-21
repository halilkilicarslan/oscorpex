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
// DAG Helper: Agent dependency graph'ından paralel wave'ler oluştur
// ---------------------------------------------------------------------------

interface DAGNode {
	agentId: string;
	agent: ProjectAgent;
	predecessors: Set<string>; // agent IDs that must complete before this
	successors: Set<string>; // agent IDs that depend on this
}

/**
 * Agent dependency'lerinden DAG wave'leri oluşturur.
 * Her wave, tüm predecessor'ları önceki wave'lerde bulunan agent'ları içerir.
 * Aynı wave'deki agent'lar birbirinden bağımsız → paralel çalışabilir.
 *
 * Returns: agent ID grupları (wave[0] = root agents, wave[1] = next, ...)
 */
export function buildDAGWaves(agents: ProjectAgent[], deps: AgentDependency[]): string[][] {
	// DAG node'larını oluştur
	const nodes = new Map<string, DAGNode>();
	for (const agent of agents) {
		nodes.set(agent.id, {
			agentId: agent.id,
			agent,
			predecessors: new Set(),
			successors: new Set(),
		});
	}

	// v3.1: Edge tipleri sınıflandırması
	// DAG constraint olan tipler: workflow, review, gate, conditional, handoff, approval
	// DAG constraint olmayan tipler: hierarchy, notification, mentoring, escalation, fallback
	// Özel: pair — her iki agent aynı wave'e
	const NON_BLOCKING_TYPES = new Set(["hierarchy", "notification", "mentoring", "escalation", "fallback"]);
	const pairEdges: Array<{ a: string; b: string }> = [];

	for (const dep of deps) {
		if (NON_BLOCKING_TYPES.has(dep.type)) continue;

		if (dep.type === "pair") {
			pairEdges.push({ a: dep.fromAgentId, b: dep.toAgentId });
			continue;
		}

		const from = nodes.get(dep.fromAgentId);
		const to = nodes.get(dep.toAgentId);
		if (from && to) {
			// from → to: "to" depends on "from"
			// yani from tamamlanmadan to başlayamaz
			to.predecessors.add(from.agentId);
			from.successors.add(to.agentId);
		}
	}

	// Topological sort — Kahn's algorithm ile wave'lere ayır
	const inDegree = new Map<string, number>();
	for (const [id, node] of nodes) {
		inDegree.set(id, node.predecessors.size);
	}

	const waves: string[][] = [];
	const remaining = new Set(nodes.keys());

	while (remaining.size > 0) {
		// Bu wave'de: in-degree'si 0 olan node'lar
		const wave: string[] = [];
		for (const id of remaining) {
			if ((inDegree.get(id) ?? 0) === 0) {
				wave.push(id);
			}
		}

		if (wave.length === 0) {
			// Döngüsel bağımlılık — kalan agent'ları son wave'e at (graceful)
			console.warn("[pipeline-engine] Döngüsel bağımlılık tespit edildi, kalan agent'lar zorla ekleniyor");
			waves.push([...remaining]);
			break;
		}

		waves.push(wave);

		// Bu wave'deki node'ları remaining'den çıkar ve successor'ların in-degree'sini azalt
		for (const id of wave) {
			remaining.delete(id);
			const node = nodes.get(id)!;
			for (const succId of node.successors) {
				inDegree.set(succId, (inDegree.get(succId) ?? 1) - 1);
			}
		}
	}

	// v3.1: Pair edge'leri — her iki agent'ı aynı wave'e taşı (en geç olanı baz al)
	for (const { a, b } of pairEdges) {
		let waveA = -1;
		let waveB = -1;
		for (let i = 0; i < waves.length; i++) {
			if (waves[i].includes(a)) waveA = i;
			if (waves[i].includes(b)) waveB = i;
		}
		if (waveA >= 0 && waveB >= 0 && waveA !== waveB) {
			const targetWave = Math.max(waveA, waveB);
			const sourceWave = Math.min(waveA, waveB);
			const moveId = waveA < waveB ? a : b;
			waves[sourceWave] = waves[sourceWave].filter((id) => id !== moveId);
			if (!waves[targetWave].includes(moveId)) {
				waves[targetWave].push(moveId);
			}
		}
	}

	// Boş wave'leri temizle
	return waves.filter((w) => w.length > 0);
}

// ---------------------------------------------------------------------------
// Pipeline Engine ana sınıfı
// ---------------------------------------------------------------------------

class PipelineEngine {
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

		// Dependency graph'ı oku
		const deps = await listAgentDependencies(projectId);
		const hasDeps = deps.some((d) => d.type !== "hierarchy");

		let stages: PipelineStage[];

		if (hasDeps) {
			// v2: DAG tabanlı wave'ler
			stages = this.buildDAGStages(agents, deps, phases);
		} else {
			// Fallback: eski pipeline_order tabanlı lineer stage'ler
			stages = this.buildLinearStages(agents, phases);
		}

		return {
			projectId,
			stages,
			currentStage: 0,
			status: "idle",
		};
	}

	/**
	 * DAG dependency graph'ından pipeline stage'leri oluşturur.
	 * Her wave bir stage olur; wave'deki agent'lar paralel çalışır.
	 */
	private buildDAGStages(agents: ProjectAgent[], deps: AgentDependency[], phases: Phase[]): PipelineStage[] {
		const waves = buildDAGWaves(agents, deps);
		const agentMap = new Map(agents.map((a) => [a.id, a]));
		const sortedPhases = [...phases].sort((a, b) => a.order - b.order);
		const usedTaskIds = new Set<string>();

		// Collect all tasks and separate review tasks for second pass
		const allTasks: Task[] = [];
		const reviewTasks: Task[] = [];
		for (const phase of sortedPhases) {
			for (const task of phase.tasks ?? []) {
				if (task.title.startsWith("Code Review: ") && task.dependsOn.length > 0) {
					reviewTasks.push(task);
				} else {
					allTasks.push(task);
				}
			}
		}

		const stages = waves.map((waveAgentIds, index) => {
			const waveAgents = waveAgentIds.map((id) => agentMap.get(id)!).filter(Boolean);
			const { ids, roles } = this.buildAgentMatchSet(waveAgents);

			// Bu wave'in agent'larına eşleşen task'ları topla (review task'lar hariç)
			const stageTasks: Task[] = [];
			let firstMatchedPhaseId: string | undefined;

			for (const task of allTasks) {
				if (usedTaskIds.has(task.id)) continue;
				const assigned = task.assignedAgent ?? "";
				if (ids.has(assigned) || roles.has(assigned.toLowerCase())) {
					stageTasks.push(task);
					usedTaskIds.add(task.id);
					if (!firstMatchedPhaseId) firstMatchedPhaseId = task.phaseId;
				}
			}

			return {
				order: index,
				agents: waveAgents,
				tasks: stageTasks,
				status: "pending" as const,
				phaseId: firstMatchedPhaseId,
			} satisfies PipelineStage;
		});

		// Second pass: place review tasks in the same stage as their dependency
		for (const reviewTask of reviewTasks) {
			if (usedTaskIds.has(reviewTask.id)) continue;
			const depId = reviewTask.dependsOn[0];
			const targetStage = stages.find((s) => s.tasks.some((t) => t.id === depId));
			if (targetStage) {
				targetStage.tasks.push(reviewTask);
				usedTaskIds.add(reviewTask.id);
			} else {
				// Fallback: put in last stage
				const last = stages[stages.length - 1];
				if (last) {
					last.tasks.push(reviewTask);
					usedTaskIds.add(reviewTask.id);
				}
			}
		}

		return stages;
	}

	/**
	 * Eski pipeline_order tabanlı lineer stage'ler (backward compat).
	 */
	private buildLinearStages(agents: ProjectAgent[], phases: Phase[]): PipelineStage[] {
		const orderGroups = new Map<number, ProjectAgent[]>();
		for (const agent of agents) {
			const order = agent.pipelineOrder ?? 0;
			if (!orderGroups.has(order)) orderGroups.set(order, []);
			orderGroups.get(order)!.push(agent);
		}

		const sortedOrders = Array.from(orderGroups.keys()).sort((a, b) => a - b);
		const sortedPhases = [...phases].sort((a, b) => a.order - b.order);
		const usedTaskIds = new Set<string>();

		return sortedOrders.map((order) => {
			const stageAgents = orderGroups.get(order)!;
			const { ids, roles } = this.buildAgentMatchSet(stageAgents);

			const stageTasks: Task[] = [];
			let firstMatchedPhaseId: string | undefined;

			for (const phase of sortedPhases) {
				for (const task of phase.tasks ?? []) {
					if (usedTaskIds.has(task.id)) continue;
					const assigned = task.assignedAgent ?? "";
					if (ids.has(assigned) || roles.has(assigned.toLowerCase())) {
						stageTasks.push(task);
						usedTaskIds.add(task.id);
						if (!firstMatchedPhaseId) firstMatchedPhaseId = phase.id;
					}
				}
			}

			return {
				order,
				agents: stageAgents,
				tasks: stageTasks,
				status: "pending" as const,
				phaseId: firstMatchedPhaseId,
			} satisfies PipelineStage;
		});
	}

	/** Agent eşleştirme için id ve role/name setleri oluşturur */
	private buildAgentMatchSet(stageAgents: ProjectAgent[]): {
		ids: Set<string>;
		roles: Set<string>;
	} {
		const ids = new Set<string>();
		const roles = new Set<string>();

		// Reverse category map: "backend-dev" → also match "backend"
		const reverseCategoryMap: Record<string, string[]> = {
			"backend-dev": ["backend", "backend-developer", "coder"],
			"backend-developer": ["backend", "backend-dev", "coder"],
			"frontend-dev": ["frontend", "frontend-developer"],
			"frontend-developer": ["frontend", "frontend-dev"],
			"backend-qa": ["qa"],
			"frontend-qa": ["qa"],
			"qa-engineer": ["qa"],
			"design-lead": ["design", "designer", "ui-designer"],
			"tech-lead": ["architect", "tech-lead"],
			"scrum-master": ["pm"],
			"product-owner": ["pm"],
			"business-analyst": ["analyst"],
		};

		for (const a of stageAgents) {
			ids.add(a.id);
			if (a.sourceAgentId) ids.add(a.sourceAgentId);
			const roleLower = a.role.toLowerCase();
			roles.add(roleLower);
			roles.add(a.name.toLowerCase());

			// Add reverse category aliases so "backend" tasks match "backend-dev" agents
			const aliases = reverseCategoryMap[roleLower];
			if (aliases) {
				for (const alias of aliases) roles.add(alias);
			}
			// Also match partial: "backend-dev" → add "backend" prefix
			const dashIdx = roleLower.indexOf("-");
			if (dashIdx > 0) {
				roles.add(roleLower.slice(0, dashIdx)); // "backend-dev" → "backend"
			}
		}
		return { ids, roles };
	}

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
			console.warn(`[pipeline-engine] Phase branch oluşturulamadı (stage ${stageIndex}):`, err),
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
			console.warn(`[pipeline-engine] Branch oluşturulamadı: ${branchName}`, err);
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
			console.warn(`[pipeline-engine] Phase branch merge edilemedi (stage ${stageIndex}):`, err),
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
			console.warn(`[pipeline-engine] Adaptive replan failed (non-blocking):`, err),
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
				console.warn(`[pipeline-engine] Merge conflict tespit edildi: ${branchName} → main`, result.conflicts);
				await gitManager.checkout(project.repoPath, "main").catch(() => {});
			}
		} catch (err) {
			console.warn(`[pipeline-engine] Branch merge atlandı: ${branchName}`, err);
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
			console.log(`[pipeline-engine] ${msg}`);
		}).catch((err) => {
			console.error("[pipeline-engine] README oluşturma hatası:", err);
		});

		// Auto PR: GitHub yapılandırılmışsa ve auto_pr aktifse PR oluştur — fire-and-forget
		this.tryCreatePR(projectId).catch((err) => {
			console.warn("[pipeline-engine] Auto PR oluşturulamadı:", err);
		});

		// v3.5: Lifecycle transition — pipeline completion flips project.status to "completed"
		// so it can enter maintenance on hotfix or be archived. Best-effort: if project is
		// not in a valid starting state (e.g. paused), fall back to a notification event.
		transitionProject(projectId, "completed").catch((err) => {
			console.warn("[pipeline-engine] lifecycle transition → completed failed:", err);
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

		console.log(`[pipeline-engine] PR oluşturuldu: ${pr.url}`);

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
		console.log(`[pipeline-engine] Pipeline paused: ${cancelledCount} task(s) cancelled for ${projectId}`);

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
			console.error(`[pipeline-engine] Resume dispatch failed:`, err);
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
		// Mevcut agent ve dependency bilgilerini çek
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

			console.log(
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
		taskEngine.onTaskCompleted((taskId, projectId) => {
			getPipelineRun(projectId)
				.then(async (run) => {
					if (run && run.status === "running") {
						try {
							await this.advanceStage(projectId);
						} catch (err) {
							console.error(`[pipeline-engine] advanceStage hatası (proje=${projectId}):`, err);
						}
						return;
					}

					if (!run || run.status === "idle" || run.status === "failed") {
						try {
							const agents = await listProjectAgents(projectId);
							if (agents.length > 0) {
								console.log(
									`[pipeline-engine] Task tamamlandı ama pipeline başlatılmamış; otomatik başlatılıyor (proje=${projectId})`,
								);
								await this.startPipeline(projectId);
								await this.advanceStage(projectId);
							}
						} catch (err) {
							console.error(`[pipeline-engine] otomatik pipeline başlatma hatası (proje=${projectId}):`, err);
						}
					}
				})
				.catch((err) => {
					console.error(`[pipeline-engine] getPipelineRun hatası (proje=${projectId}):`, err);
				});
		});
	}
}

// ---------------------------------------------------------------------------
// Singleton dışa aktarımı
// ---------------------------------------------------------------------------
export const pipelineEngine = new PipelineEngine();

// Uygulama başladığında TaskEngine hook'unu kaydet
pipelineEngine.registerTaskHook();
