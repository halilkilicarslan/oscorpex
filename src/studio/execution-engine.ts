// ---------------------------------------------------------------------------
// Oscorpex — Execution Engine
// Orchestrates task execution: dispatches tasks to agents running in Docker
// containers (or falls back to local AI SDK execution when Docker unavailable).
// ---------------------------------------------------------------------------

import { persistAgentLog } from "./agent-log-store.js";
import { agentRuntime } from "./agent-runtime.js";
import { startApp, stopApp } from "./app-runner.js";
import { composeSystemPrompt } from "./behavioral-prompt.js";
import { enforceBudgetGuard } from "./budget-guard.js";
import { resolveAllowedTools } from "./capability-resolver.js";
import { getAdapter, getAdapterChain } from "./cli-adapter.js";
import { executeWithCLI, isClaudeCliAvailable, resolveFilePaths } from "./cli-runtime.js";
import { buildPolicyPromptSection, getDefaultPolicy } from "./command-policy.js";
import { buildRAGContext, formatRAGContext } from "./context-builder.js";
import { compactCrossAgentContext } from "./context-sandbox.js";
import { buildResumeSnapshot, formatResumeSnapshot } from "./context-session.js";
import {
	claimTask,
	getAgentConfig,
	getLatestPlan,
	getProject,
	getProjectSetting,
	getTask,
	listAgentConfigs,
	listPhases,
	listProjectAgents,
	listProjectTasks,
	listProjects,
	recordTokenUsage,
	releaseTaskClaim,
	updatePhaseStatus,
	updateProject,
	updateTask,
} from "./db.js";
import { updateDocsAfterTask } from "./docs-generator.js";
import { eventBus } from "./event-bus.js";
import { runLintFix } from "./lint-runner.js";
import {
	acknowledgeMessages,
	completeSession,
	failSession,
	initSession,
	loadProtocolContext,
	recordStep,
} from "./agent-runtime/index.js";
import { getGoalForTask, formatGoalPrompt, validateCriteriaFromOutput, evaluateGoal } from "./goal-engine.js";
import { resolveModel } from "./model-router.js";
import { verifyTaskOutput } from "./output-verifier.js";
import { resolveTaskPolicy, startSandboxSession, endSandboxSession, checkToolAllowed, checkPathAllowed } from "./sandbox-manager.js";
import { runTestGate } from "./test-gate.js";
import { execute as pgExecute } from "./pg.js";
import { PROMPT_LIMITS, capText, enforcePromptBudget } from "./prompt-budget.js";
import { providerState } from "./provider-state.js";
import { taskEngine } from "./task-engine.js";
import { runIntegrationTest } from "./task-runners.js";
import type { AgentConfig, Project, Task, TaskOutput } from "./types.js";

// ---------------------------------------------------------------------------
// Rate-limit detection
// ---------------------------------------------------------------------------

const RATE_LIMIT_PATTERNS = [
	/you['']ve hit your limit/i,
	/rate limit/i,
	/resets?\s+\d{1,2}[:.]\d{2}\s*(am|pm)/i,
	/too many requests/i,
	/429/,
	/quota exceeded/i,
];

function isRateLimitError(message: string): boolean {
	return RATE_LIMIT_PATTERNS.some((rx) => rx.test(message));
}

// ---------------------------------------------------------------------------
// Timeout configuration
// ---------------------------------------------------------------------------

/**
 * Complexity'ye göre temel timeout değerleri (milisaniye):
 *   S  → 5 dakika
 *   M  → 15 dakika
 *   L  → 30 dakika
 *   XL → 60 dakika
 */
const COMPLEXITY_TIMEOUT_MS: Record<string, number> = {
	S: 30 * 60 * 1000,
	M: 30 * 60 * 1000,
	L: 45 * 60 * 1000,
	XL: 60 * 60 * 1000,
};

/** Bilinmeyen complexity için varsayılan: 5 dakika */
const DEFAULT_TASK_TIMEOUT_MS = COMPLEXITY_TIMEOUT_MS.S;

/**
 * Timeout'a yaklaşıldığında uyarı vermek için eşik: son %20.
 * Örneğin 30 dk'lık timeout'ta 24. dakikada warning emit edilir.
 */
const TIMEOUT_WARNING_THRESHOLD = 0.8; // Timeout'un %80'i geçince warning

/**
 * Task complexity ve proje timeout_multiplier ayarına göre efektif timeout hesaplar.
 * Öncelik sırası: agent.taskTimeout > complexity tabanlı değer × multiplier
 */
async function resolveTaskTimeoutMs(
	projectId: string,
	complexity: string | undefined,
	agentTimeout: number | undefined,
): Promise<number> {
	// Agent seviyesinde açıkça belirlenmiş timeout önceliklidir
	if (agentTimeout != null && agentTimeout > 0) return agentTimeout;

	// Complexity bazlı temel timeout
	const baseMs = COMPLEXITY_TIMEOUT_MS[complexity ?? "S"] ?? DEFAULT_TASK_TIMEOUT_MS;

	// Proje ayarlarından kullanıcının belirlediği çarpan (varsayılan 1.0)
	const multiplierStr = await getProjectSetting(projectId, "execution", "task_timeout_multiplier");
	const multiplier = multiplierStr ? Number.parseFloat(multiplierStr) : 1.0;
	const safeMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1.0;

	return Math.round(baseMs * safeMultiplier);
}

/**
 * Wraps a promise with a timeout using AbortController.
 * If the promise does not resolve within `timeoutMs`, the AbortController is
 * aborted and a TaskTimeoutError is thrown.
 *
 * @param operation   - Factory that receives an AbortSignal and returns the promise to race.
 * @param timeoutMs   - Maximum allowed duration in milliseconds.
 * @param onWarning   - Timeout'un %80'i dolduğunda çağrılır (opsiyonel).
 * @returns The resolved value of the operation promise.
 */
function withTimeout<T>(
	operation: (signal: AbortSignal, extendTimeout: (ms: number) => void) => Promise<T>,
	timeoutMs: number,
	onWarning?: () => void,
): Promise<T> {
	const controller = new AbortController();
	let remainingMs = timeoutMs;
	let timer: ReturnType<typeof setTimeout>;
	let warningTimer: ReturnType<typeof setTimeout> | null = null;

	const resetTimers = () => {
		clearTimeout(timer);
		if (warningTimer) clearTimeout(warningTimer);

		const warningMs = Math.round(remainingMs * TIMEOUT_WARNING_THRESHOLD);
		warningTimer = onWarning
			? setTimeout(() => {
					onWarning();
				}, warningMs)
			: null;

		timer = setTimeout(() => {
			if (warningTimer) clearTimeout(warningTimer);
			controller.abort();
		}, remainingMs);
	};

	const extendTimeout = (ms: number) => {
		remainingMs += ms;
		resetTimers();
	};

	resetTimers();

	const timeoutPromise = new Promise<never>((_, reject) => {
		controller.signal.addEventListener("abort", () => {
			clearTimeout(timer);
			if (warningTimer) clearTimeout(warningTimer);
			reject(new TaskTimeoutError(timeoutMs));
		});
	});

	return Promise.race([operation(controller.signal, extendTimeout), timeoutPromise]);
}

/** Thrown when a task exceeds its configured timeout */
class TaskTimeoutError extends Error {
	readonly timeoutMs: number;

	constructor(timeoutMs: number) {
		const minutes = (timeoutMs / 60_000).toFixed(1);
		super(`Task timed out after ${minutes} minute(s) (${timeoutMs}ms). The task was aborted.`);
		this.name = "TaskTimeoutError";
		this.timeoutMs = timeoutMs;
	}
}

// ---------------------------------------------------------------------------
// Semaphore — limits concurrent CLI process executions
// ---------------------------------------------------------------------------

class Semaphore {
	private current = 0;
	private queue: (() => void)[] = [];
	constructor(private max: number) {}
	async acquire(): Promise<void> {
		if (this.current < this.max) {
			this.current++;
			return;
		}
		return new Promise<void>((resolve) => this.queue.push(resolve));
	}
	release(): void {
		this.current--;
		const next = this.queue.shift();
		if (next) {
			this.current++;
			next();
		}
	}
	get activeCount(): number {
		return this.current;
	}
	get pendingCount(): number {
		return this.queue.length;
	}
}

// ---------------------------------------------------------------------------
// Execution Engine
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_TASKS = Number(process.env.OSCORPEX_MAX_CONCURRENT_TASKS) || 3;

class ExecutionEngine {
	/** Guard: prevents the same task from being dispatched concurrently */
	private _dispatchingTasks = new Set<string>();

	/** Active AbortControllers for running tasks, keyed by `projectId:taskId` */
	private _activeControllers = new Map<string, AbortController>();

	/** Semaphore limiting concurrent CLI executions */
	private _semaphore = new Semaphore(MAX_CONCURRENT_TASKS);

	/** Unique worker ID for distributed task claiming (PID-based) */
	private _workerId = `worker-${process.pid}-${Date.now()}`;

	constructor() {
		// Register completion callback: when a task completes and a new phase starts,
		// dispatch the newly ready tasks automatically
		taskEngine.onTaskCompleted(async (_taskId, projectId) => {
			// After checkAndAdvancePhase runs, check all phases for ready tasks
			const plan = await getLatestPlan(projectId);
			if (!plan) return;
			const phases = await listPhases(plan.id);
			for (const phase of phases) {
				// Review task'ları completed phase'lerde de çalışabilir —
				// pipeline stage advance olmuş olsa bile review devam etmeli
				if (phase.status === "running" || phase.status === "completed") {
					const ready = await taskEngine.getReadyTasks(phase.id);
					if (ready.length > 0) {
						Promise.allSettled(ready.map((task: any) => this.executeTask(projectId, task))).catch(() => {});
					}
				}
			}
		});
	}

	// -------------------------------------------------------------------------
	// Startup recovery — restart sonrası "running" kalan task'ları kurtarır
	// -------------------------------------------------------------------------

	/**
	 * Backend restart sonrası çalışır. Tüm projelerdeki "running" durumundaki
	 * task'ları "queued" durumuna geri alır ve ilgili projelerin execution'ını
	 * yeniden başlatır. Bu sayede yarıda kalmış görevler yeniden çalıştırılır.
	 */
	async recoverStuckTasks(): Promise<void> {
		const projects = await listProjects();
		for (const project of projects) {
			if (project.status !== "running") continue;

			const plan = await getLatestPlan(project.id);
			if (!plan || plan.status !== "approved") continue;

			const phases = await listPhases(plan.id);
			let hasRecovered = false;

			for (const phase of phases) {
				if (phase.status !== "running" && phase.status !== "failed") continue;
				let phaseRecovered = false;
				for (const task of phase.tasks ?? []) {
					if (task.status === "running" || task.status === "assigned") {
						await updateTask(task.id, { status: "queued", startedAt: undefined });
						await releaseTaskClaim(task.id);
						console.log(`[execution-engine] Recovery: "${task.title}" → queued (was ${task.status})`);
						phaseRecovered = true;
					}
				}
				if (phaseRecovered && phase.status === "failed") {
					await updatePhaseStatus(phase.id, "running");
					console.log(`[execution-engine] Recovery: phase "${phase.name}" → running (was failed)`);
				}
				hasRecovered = hasRecovered || phaseRecovered;
			}

			if (hasRecovered) {
				console.log(`[execution-engine] Recovering project "${project.name}" — restarting execution`);
				this.startProjectExecution(project.id).catch((err) => {
					console.error(`[execution-engine] Recovery failed for "${project.name}":`, err);
				});
			}

			// Restart revision tasks that were left in 'revision' status
			for (const phase of phases) {
				if (phase.status !== "running" && phase.status !== "completed") continue;
				for (const task of phase.tasks ?? []) {
					if (task.status === "revision") {
						console.log(`[execution-engine] Recovery: restarting revision "${task.title}"`);
						try {
							await taskEngine.restartRevision(task.id);
							const fresh = await getTask(task.id);
							if (fresh) {
								this.executeTask(project.id, fresh).catch(() => {});
							}
						} catch (e) {
							console.error(`[execution-engine] Revision recovery failed for "${task.title}":`, e);
						}
					}
				}
			}

			// Dispatch orphaned queued tasks (e.g. review tasks created before restart)
			// These may sit in running OR completed phases with satisfied dependencies
			for (const phase of phases) {
				if (phase.status !== "running" && phase.status !== "completed") continue;
				const ready = await taskEngine.getReadyTasks(phase.id);
				if (ready.length > 0) {
					console.log(
						`[execution-engine] Recovery: ${ready.length} orphaned ready task(s) in phase "${phase.name}" — dispatching`,
					);
					Promise.allSettled(ready.map((task: any) => this.executeTask(project.id, task))).catch(() => {});
				}

				// Recover orphaned running tasks — stuck in "running" with no active CLI process
				// These arise when revision re-execution fails silently (fire-and-forget .catch)
				for (const task of phase.tasks ?? []) {
					if (
						task.status === "running" &&
						!this._dispatchingTasks.has(task.id) &&
						!this._activeControllers.has(`${project.id}:${task.id}`)
					) {
						console.log(`[execution-engine] Recovery: orphaned running task "${task.title}" → queued`);
						await updateTask(task.id, { status: "queued", startedAt: undefined });
						await releaseTaskClaim(task.id);
						hasRecovered = true;
					}
				}
			}

			// Re-dispatch if orphaned running tasks were recovered
			if (hasRecovered) {
				for (const phase of phases) {
					if (phase.status !== "running") continue;
					const ready = await taskEngine.getReadyTasks(phase.id);
					if (ready.length > 0) {
						Promise.allSettled(ready.map((task: any) => this.executeTask(project.id, task))).catch(() => {});
					}
				}
			}
		}
	}

	// -------------------------------------------------------------------------
	// Cancel running tasks — used by pipeline pause
	// -------------------------------------------------------------------------

	/**
	 * Projedeki tüm çalışan görevleri iptal eder:
	 *  1. AbortController'ları abort eder → CLI süreçleri SIGTERM alır
	 *  2. agent-runtime'daki süreçleri durdurur
	 *  3. "running" durumundaki task'ları "queued" ye geri alır (resume'da tekrar çalışsın)
	 */
	async cancelRunningTasks(projectId: string): Promise<number> {
		let cancelled = 0;

		// 1. Abort all active controllers for this project
		for (const [key, controller] of this._activeControllers) {
			if (key.startsWith(`${projectId}:`)) {
				controller.abort();
				this._activeControllers.delete(key);
				cancelled++;
			}
		}

		// 2. Stop all agent-runtime processes for this project
		const runningProcesses = agentRuntime.listProjectProcesses(projectId);
		for (const proc of runningProcesses) {
			if (proc.status === "running" || proc.status === "starting") {
				agentRuntime.stopAgent(projectId, proc.agentId);
			}
		}

		// 3. Stop any app services (vite, next dev, etc.) spawned for the project
		try {
			await stopApp(projectId);
		} catch {
			/* non-critical */
		}

		// 4. Reset running tasks back to queued so they re-run on resume
		const tasks = await listProjectTasks(projectId);
		for (const task of tasks) {
			if (task.status === "running" || task.status === "assigned") {
				try {
					await pgExecute("UPDATE tasks SET status = 'queued', started_at = NULL WHERE id = $1", [task.id]);
					console.log(`[execution-engine] Task "${task.title}" → queued (pipeline paused)`);
				} catch (err) {
					console.warn(`[execution-engine] Task reset failed: ${task.id}`, err);
				}
			}
		}

		if (cancelled > 0) {
			console.log(`[execution-engine] Cancelled ${cancelled} running task(s) for project ${projectId}`);
		}

		return cancelled;
	}

	// -------------------------------------------------------------------------
	// Main entry point — called after plan approval
	// -------------------------------------------------------------------------

	/**
	 * Begin execution for a project. Retrieves the initial ready tasks from the
	 * task engine (which also starts the first phase) and dispatches them in
	 * parallel. Subsequent phases are advanced automatically by the task engine's
	 * completeTask → checkAndAdvancePhase logic; this engine reacts to newly
	 * ready tasks after each task completion.
	 */
	async startProjectExecution(projectId: string): Promise<void> {
		const project = await getProject(projectId);
		if (!project) throw new Error(`Project ${projectId} not found`);

		let readyTasks: Task[] = [];

		// First check if there are already running phases with queued tasks
		const plan = await getLatestPlan(projectId);
		if (plan) {
			const phases = await listPhases(plan.id);
			for (const phase of phases) {
				if (phase.status === "running") {
					readyTasks.push(...(await taskEngine.getReadyTasks(phase.id)));
				}
			}
		}

		// If no running phases have ready tasks, start a new phase
		if (readyTasks.length === 0) {
			try {
				readyTasks = await taskEngine.beginExecution(projectId);
			} catch {
				// No pending phase or no approved plan — nothing to do
			}
		}

		eventBus.emit({
			projectId,
			type: "execution:started",
			payload: { readyTaskCount: readyTasks.length },
		});

		// Dispatch tasks sequentially to avoid AI provider rate limits
		for (const task of readyTasks) {
			await this.executeTask(projectId, task);
		}
	}

	// -------------------------------------------------------------------------
	// Single task execution
	// -------------------------------------------------------------------------

	/**
	 * Execute a single task end-to-end:
	 *  1. Resolve the assigned agent configuration
	 *  2. Ensure a container is running (or prepare local fallback)
	 *  3. Mark the task as assigned then running
	 *  4. Build a prompt and run Claude Code (or local AI SDK)
	 *  5. Complete or fail the task
	 *  6. Dispatch any newly unblocked tasks
	 */
	async executeTask(projectId: string, task: Task): Promise<void> {
		// Guard: skip if this task is already being dispatched by another caller
		if (this._dispatchingTasks.has(task.id)) {
			console.log(`[execution-engine] Task "${task.title}" zaten dispatch ediliyor, skip.`);
			return;
		}

		// Distributed claim: atomically lock the task row using SELECT FOR UPDATE SKIP LOCKED.
		// If another worker already claimed this task, claimTask returns null.
		const freshTask = await claimTask(task.id, this._workerId);
		if (!freshTask) {
			console.log(
				`[execution-engine] Task "${task.title}" could not be claimed (already taken or not queued), skip.`,
			);
			return;
		}

		// v3.0: Auto-decompose L/XL tasks into micro-tasks
		if ((freshTask.complexity === "L" || freshTask.complexity === "XL") && !freshTask.parentTaskId) {
			try {
				const { shouldDecompose, decomposeTask } = await import("./task-decomposer.js");
				if (shouldDecompose(freshTask)) {
					console.log(`[execution-engine] Auto-decomposing ${freshTask.complexity} task "${freshTask.title}"`);
					const subTasks = await decomposeTask(freshTask, projectId);
					if (subTasks.length > 0) {
						// Parent becomes a container — update status to track sub-tasks
						await updateTask(freshTask.id, { status: "running" });
						await releaseTaskClaim(freshTask.id);
						// Dispatch sub-tasks
						for (const sub of subTasks) {
							this.executeTask(projectId, sub).catch((err) =>
								console.error(`[execution-engine] Sub-task "${sub.title}" dispatch hatası:`, err),
							);
						}
						return;
					}
				}
			} catch (err) {
				console.warn("[execution-engine] Task decomposition failed, executing as-is:", err);
			}
		}

		this._dispatchingTasks.add(task.id);

		await this._semaphore.acquire();
		try {
			await this._executeTaskInner(projectId, freshTask);
		} finally {
			this._semaphore.release();
			this._dispatchingTasks.delete(task.id);
			this._activeControllers.delete(`${projectId}:${task.id}`);
			await releaseTaskClaim(task.id);
		}
	}

	private async _executeTaskInner(projectId: string, task: Task): Promise<void> {
		const project = await getProject(projectId);
		if (!project) throw new Error(`Project ${projectId} not found`);

		// Register AbortController for this task so it can be cancelled externally
		const taskController = new AbortController();
		const controllerKey = `${projectId}:${task.id}`;
		this._activeControllers.set(controllerKey, taskController);

		// --- Non-AI task types: integration-test & run-app ---
		if (task.taskType === "integration-test" || task.taskType === "run-app") {
			await this.executeSpecialTask(projectId, project, task);
			return;
		}

		// --- Review task: "Code Review: X" — run review CLI and submit result ---
		if (task.title.startsWith("Code Review: ")) {
			await this.executeReviewTask(projectId, project, task);
			return;
		}

		// Resolve agent config — prefer the task's assignedAgent value, which may
		// be an agent ID or a role name. Try both.
		const agent = await this.resolveAgent(projectId, task.assignedAgent);
		if (!agent) {
			await taskEngine.assignTask(task.id, task.assignedAgent);
			await taskEngine.startTask(task.id);
			await taskEngine.failTask(
				task.id,
				`No agent found for assignment "${task.assignedAgent}" in project ${projectId}`,
			);
			await this.dispatchReadyTasks(projectId, task.phaseId);
			return;
		}

		// Assign + start — task is already claimed via SELECT FOR UPDATE SKIP LOCKED,
		// so no concurrent dispatch race is possible. Transition status based on current state.
		{
			const currentTask = await getTask(task.id);
			const currentStatus = currentTask?.status ?? task.status;
			if (currentStatus === "queued") {
				await taskEngine.assignTask(task.id, agent.id);
				await taskEngine.startTask(task.id);
			} else if (currentStatus === "assigned") {
				await taskEngine.startTask(task.id);
			}
			// status === "running" → already started (e.g. revision restart), skip both
		}

		// --- Agent Runtime: init session + behavioral memory + protocol ---
		let sessionId: string | undefined;
		let promptSuffix = "";
		try {
			const sessionCtx = await initSession(projectId, agent.id, agent.role, task);
			sessionId = sessionCtx.session.id;
			promptSuffix += sessionCtx.behavioralPrompt;

			// Strategy prompt addendum
			if (sessionCtx.strategySelection.strategy.promptAddendum) {
				promptSuffix += `\n\n## EXECUTION STRATEGY: ${sessionCtx.strategySelection.strategy.name}\n${sessionCtx.strategySelection.strategy.promptAddendum}\n`;
			}

			// Load inter-agent protocol messages
			const protocolCtx = await loadProtocolContext(projectId, agent.id);
			if (protocolCtx.prompt) {
				promptSuffix += protocolCtx.prompt;
				await acknowledgeMessages(protocolCtx.messageIds);
			}
		} catch (err) {
			console.warn("[execution-engine] Agent runtime init failed (non-blocking):", err);
		}

		// --- Goal-based execution: inject goal prompt if task has an associated goal ---
		let goalId: string | undefined;
		try {
			const goal = await getGoalForTask(task.id);
			if (goal && goal.status !== "achieved") {
				promptSuffix += "\n" + formatGoalPrompt(goal);
				goalId = goal.id;
			}
		} catch (err) {
			console.warn("[execution-engine] Goal lookup failed (non-blocking):", err);
		}

		const prompt = await this.buildTaskPrompt(task, project, agent.role) + promptSuffix;

		// --- Sandbox: resolve policy for this task ---
		let sandboxSessionId: string | undefined;
		try {
			const policy = await resolveTaskPolicy(projectId, task, agent.role);
			if (project.repoPath) {
				const sbSession = await startSandboxSession({
					projectId,
					taskId: task.id,
					agentId: agent.id,
					workspacePath: project.repoPath,
				});
				sandboxSessionId = sbSession.id;
			}
		} catch (err) {
			console.warn("[execution-engine] Sandbox init failed (non-blocking):", err);
		}

		// Complexity ve proje timeout_multiplier ayarına göre efektif timeout hesapla
		const timeoutMs = await resolveTaskTimeoutMs(projectId, task.complexity, agent.taskTimeout);

		// Timeout'un %80'ine girildiğinde warning event emit edecek callback
		const onTimeoutWarning = () => {
			const remainingMs = Math.round(timeoutMs * (1 - TIMEOUT_WARNING_THRESHOLD));
			const remainingSec = Math.round(remainingMs / 1000);
			console.warn(`[execution-engine] Timeout uyarısı: "${task.title}" — ${remainingSec}sn kaldı`);
			eventBus.emit({
				projectId,
				type: "task:timeout_warning",
				agentId: agent.id,
				taskId: task.id,
				payload: {
					timeoutMs,
					remainingMs,
					taskTitle: task.title,
					message: `Görev timeout'a ${remainingSec} saniye kaldı (toplam ${(timeoutMs / 60_000).toFixed(0)} dk).`,
				},
			});
		};

		try {
			// CLI-only execution — no API fallback
			if (!project.repoPath) {
				throw new Error(`Project ${projectId} has no repoPath configured`);
			}

			const allowedTools = await resolveAllowedTools(projectId, agent.id, agent.role);

			// v3.4 + M4: Model routing — complexity + prior failures + review rejections + provider-native models.
			const primaryCliTool = agent.cliTool ?? "claude-code";
			let routedModel: string = agent.model ?? "sonnet";
			try {
				const resolved = await resolveModel(task, {
					projectId,
					priorFailures: task.retryCount ?? 0,
					reviewRejections: task.revisionCount ?? 0,
					cliTool: primaryCliTool,
				});
				routedModel = resolved.model;
			} catch (err) {
				console.warn("[execution-engine] resolveModel failed, using fallback:", err);
			}

			// M4: Adapter fallback chain — primary + fallback providers
			const adapterChain = getAdapterChain(primaryCliTool, ["claude-code", "cursor"]);
			let cliResult: Awaited<ReturnType<(typeof adapterChain)[0]["execute"]>> | null = null;
			let lastAdapterError: Error | null = null;

			for (const adapter of adapterChain) {
				const adapterName = adapter.name as import("./types.js").AgentCliTool;

				if (!providerState.isAvailable(adapterName)) {
					console.log(`[execution] Adapter "${adapter.name}" is in cooldown, skipping.`);
					continue;
				}

				const adapterReady = await adapter.isAvailable();
				console.log(`[execution] CLI adapter: ${adapter.name}, ready=${adapterReady}`);

				if (!adapterReady) {
					console.log(`[execution] Adapter "${adapter.name}" is not installed, skipping.`);
					continue;
				}

				try {
					cliResult = await adapter.execute({
						projectId,
						agentId: agent.id,
						agentName: agent.name,
						repoPath: project.repoPath,
						prompt,
						systemPrompt: agent.systemPrompt
							? composeSystemPrompt(agent.systemPrompt)
							: this.defaultSystemPrompt(agent),
						timeoutMs,
						model: routedModel,
						signal: taskController.signal,
						allowedTools,
					});
					providerState.markSuccess(adapterName);
					break; // success — exit chain
				} catch (adapterErr) {
					lastAdapterError = adapterErr instanceof Error ? adapterErr : new Error(String(adapterErr));
					const errMsg = lastAdapterError.message;
					if (isRateLimitError(errMsg)) {
						console.warn(`[execution] Rate limit on adapter "${adapter.name}" — marking cooldown.`);
						providerState.markRateLimited(adapterName);
					} else {
						providerState.markFailure(adapterName);
					}
					console.warn(`[execution] Adapter "${adapter.name}" failed: ${errMsg.slice(0, 200)}`);
				}
			}

			if (cliResult === null) {
				// Graceful degraded mode: if all providers are exhausted, defer the task
				// instead of failing it. Reset to queued and schedule a retry.
				if (providerState.isAllExhausted()) {
					const retryMs = providerState.getEarliestRecoveryMs();
					console.warn(
						`[execution-engine] All providers exhausted — deferring "${task.title}" for ${Math.round(retryMs / 1000)}s`,
					);
					await updateTask(task.id, { status: "queued" });
					eventBus.emit({
						projectId,
						type: "pipeline:degraded",
						agentId: agent.id,
						taskId: task.id,
						payload: {
							message: `All providers exhausted. Task "${task.title}" deferred. Retry in ${Math.round(retryMs / 1000)}s.`,
							retryMs,
						},
					});
					// Schedule a retry after cooldown expires
					setTimeout(() => {
						getTask(task.id).then((t) => {
							if (t && t.status === "queued") {
								this.executeTask(projectId, t).catch(() => {});
							}
						});
					}, retryMs + 1000);
					return;
				}
				throw lastAdapterError ?? new Error("All CLI adapters exhausted — no provider available.");
			}

			const output: TaskOutput = {
				filesCreated: resolveFilePaths(cliResult.filesCreated, project.repoPath),
				filesModified: resolveFilePaths(cliResult.filesModified, project.repoPath),
				logs: cliResult.logs,
			};

			// Record token usage from CLI result
			if (cliResult.inputTokens || cliResult.outputTokens) {
				const totalTokens = cliResult.inputTokens + cliResult.outputTokens;
				await recordTokenUsage({
					projectId,
					taskId: task.id,
					agentId: agent.id,
					model: cliResult.model || "claude-sonnet-4-6",
					provider: "anthropic",
					inputTokens: cliResult.inputTokens,
					outputTokens: cliResult.outputTokens,
					totalTokens,
					costUsd: cliResult.totalCostUsd,
					cacheCreationTokens: cliResult.cacheCreationTokens,
					cacheReadTokens: cliResult.cacheReadTokens,
				});

				// Cost circuit breaker: check budget after recording spend
				const budgetExceeded = await enforceBudgetGuard(projectId);
				if (budgetExceeded) {
					// Complete current task normally but stop dispatching further
					console.warn(`[execution-engine] Budget exceeded — completing "${task.title}" but pausing pipeline`);
				}
			}

			eventBus.emitTransient({
				projectId,
				type: "agent:output",
				agentId: agent.id,
				taskId: task.id,
				payload: { output: `[execution] Mode: cli` },
			});

			// --- ESLint/Prettier enforcement: auto-fix generated files ---
			const allFiles = [...(output.filesCreated ?? []), ...(output.filesModified ?? [])];
			if (allFiles.length > 0 && project.repoPath) {
				try {
					const termLog = (msg: string) => {
						agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
						agentRuntime.appendVirtualOutput(projectId, agent.id, msg);
					};
					const lintResult = await runLintFix(project.repoPath, allFiles, termLog);
					if (lintResult.eslint.errors.length > 0 || lintResult.prettier.errors.length > 0) {
						eventBus.emitTransient({
							projectId,
							type: "agent:output",
							agentId: agent.id,
							taskId: task.id,
							payload: {
								output: `[lint] Uyarılar: eslint(${lintResult.eslint.errors.length}), prettier(${lintResult.prettier.errors.length})`,
							},
						});
					}
				} catch (lintErr) {
					// Lint failure should never block task completion
					console.warn("[execution-engine] Lint/format failed (non-blocking):", lintErr);
				}
			}

			// --- Auto-documentation: update docs based on agent role ---
			try {
				await updateDocsAfterTask(project, { ...task, output }, agent, (msg) => {
					agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
					agentRuntime.appendVirtualOutput(projectId, agent.id, msg);
				});
			} catch (docErr) {
				console.warn("[execution-engine] Docs update failed (non-blocking):", docErr);
			}

			// Agent output buffer'ını log dosyasına persist et (restart sonrası terminal'de görünsün)
			const agentOutputLines = agentRuntime.getAgentOutput(projectId, agent.id);
			if (agentOutputLines.length > 0) {
				persistAgentLog(projectId, agent.id, agentOutputLines).catch(() => {});
			}

			// --- Output verification gate: verify artifacts before completion ---
			if (project.repoPath) {
				const verification = await verifyTaskOutput(task.id, project.repoPath, output);
				if (!verification.allPassed) {
					const failedChecks = verification.results
						.filter((r) => !r.passed)
						.map((r) => `${r.type}: ${r.details.map((d) => d.file ?? d.actual).join(", ")}`)
						.join("; ");
					console.warn(`[execution-engine] Output verification failed for "${task.title}": ${failedChecks}`);
					eventBus.emitTransient({
						projectId,
						type: "agent:output",
						agentId: agent.id,
						taskId: task.id,
						payload: { output: `[verify] Output verification failed: ${failedChecks}` },
					});
					// Non-empty check failure is a hard fail — the agent produced nothing
					const hasHardFail = verification.results.some(
						(r) => !r.passed && r.type === "output_non_empty",
					);
					if (hasHardFail) {
						throw new Error(`Output verification failed: agent produced no artifacts — ${failedChecks}`);
					}
					// File existence failures: log warning but allow completion (files may be in git)
				}
			}

			// --- Test gate: run project tests before allowing completion ---
			if (project.repoPath) {
				const testResult = await runTestGate(projectId, task, project.repoPath, output, agent.role);
				if (!testResult.passed) {
					console.warn(`[execution-engine] Test gate failed for "${task.title}": ${testResult.summary}`);
					eventBus.emitTransient({
						projectId,
						type: "agent:output",
						agentId: agent.id,
						taskId: task.id,
						payload: { output: `[test-gate] ${testResult.summary}` },
					});
					// Required policy → fail the task so it enters retry/review flow
					if (testResult.policy === "required") {
						throw new Error(`Test gate failed (required): ${testResult.summary}`);
					}
				} else if (testResult.testsTotal > 0) {
					output.testResults = {
						passed: testResult.testsPassed,
						failed: testResult.testsFailed,
						total: testResult.testsTotal,
					};
				}
			}

			await taskEngine.completeTask(task.id, output);

			// --- Sandbox: end session ---
			if (sandboxSessionId) {
				endSandboxSession(sandboxSessionId).catch((e) => console.warn("[execution-engine] Sandbox end failed:", e));
			}

			// --- Goal evaluation: validate success criteria ---
			if (goalId) {
				try {
					const goal = await getGoalForTask(task.id);
					if (goal) {
						const results = validateCriteriaFromOutput(goal, output);
						await evaluateGoal(goalId, results);
					}
				} catch (e) {
					console.warn("[execution-engine] Goal evaluation failed (non-blocking):", e);
				}
			}

			// --- Agent Runtime: record successful session ---
			if (sessionId) {
				completeSession(sessionId, projectId, agent.id, agent.role, task, {
					costUsd: cliResult?.totalCostUsd,
				}).catch((e) => console.warn("[execution-engine] Session complete failed:", e));
			}

			// Review task dispatch: task-engine creates a review task which
			// will be picked up by dispatchReadyTasks below.
		} catch (err) {
			// If task was aborted by pipeline pause, don't mark as failed — cancelRunningTasks
			// already reset it to queued. Just bail out silently.
			if (taskController.signal.aborted) {
				console.log(`[execution-engine] Task "${task.title}" aborted (pipeline paused)`);
				return;
			}

			const isTimeout = err instanceof TaskTimeoutError;
			const errorMsg = err instanceof Error ? err.message : String(err);
			console.error(`[execution-engine] Task failed: "${task.title}" — ${errorMsg}`);

			// --- Rate-limit guard: pause pipeline instead of failing the task ---
			if (isRateLimitError(errorMsg)) {
				console.warn(`[execution-engine] Rate limit detected — pausing pipeline for ${projectId}`);

				// Reset task back to queued so it can resume later
				await updateTask(task.id, { status: "queued" });

				eventBus.emit({
					projectId,
					type: "pipeline:rate_limited",
					agentId: agent.id,
					taskId: task.id,
					payload: { message: errorMsg, taskTitle: task.title },
				});

				// Pause the pipeline — stops all running tasks
				try {
					const { pipelineEngine } = await import("./pipeline-engine.js");
					await pipelineEngine.pausePipeline(projectId);
				} catch (pauseErr) {
					console.error("[execution-engine] Failed to pause pipeline after rate limit:", pauseErr);
				}
				return; // Don't fail/retry — just stop
			}

			if (isTimeout) {
				// Emit a dedicated timeout event before the generic error event
				eventBus.emit({
					projectId,
					type: "task:timeout",
					agentId: agent.id,
					taskId: task.id,
					payload: {
						timeoutMs,
						taskTitle: task.title,
						message: errorMsg,
					},
				});
			}

			eventBus.emit({
				projectId,
				type: "agent:error",
				agentId: agent.id,
				taskId: task.id,
				payload: { error: errorMsg },
			});

			// Agent output buffer'ını log dosyasına persist et
			const failOutputLines = agentRuntime.getAgentOutput(projectId, agent.id);
			if (failOutputLines.length > 0) {
				persistAgentLog(projectId, agent.id, failOutputLines).catch(() => {});
			}

			await taskEngine.failTask(task.id, errorMsg);

			// --- Agent Runtime: record failed session ---
			if (sessionId) {
				failSession(sessionId, projectId, agent.id, agent.role, task, errorMsg).catch((e) =>
					console.warn("[execution-engine] Session fail record failed:", e),
				);
			}

			// --- Self-healing: auto-retry with error context ---
			const MAX_AUTO_RETRIES = 2;
			const failedTask = await getTask(task.id);
			if (!isTimeout && failedTask && failedTask.retryCount < MAX_AUTO_RETRIES) {
				console.log(`[execution-engine] Self-healing: auto-retry #${failedTask.retryCount + 1} for "${task.title}"`);
				eventBus.emitTransient({
					projectId,
					type: "agent:output",
					agentId: agent.id,
					taskId: task.id,
					payload: {
						output: `[self-heal] Otomatik yeniden deneme #${failedTask.retryCount + 1}: ${errorMsg.slice(0, 200)}`,
					},
				});
				const retried = await taskEngine.retryTask(task.id);
				// Re-execute with error context — bypass guard since we're retrying within the same dispatch
				await this._executeTaskInner(projectId, { ...retried, error: errorMsg });
				return; // skip dispatchReadyTasks — executeTask will handle it
			}
		}

		// After this task is settled (done or failed), check if new tasks are ready
		// First check the current phase, then check if a new phase was started
		await this.dispatchReadyTasks(projectId, task.phaseId);

		// If the phase was completed and a new phase started, dispatch its tasks too
		const plan = await getLatestPlan(projectId);
		if (plan) {
			const phases = await listPhases(plan.id);
			for (const phase of phases) {
				if (phase.status === "running" && phase.id !== task.phaseId) {
					await this.dispatchReadyTasks(projectId, phase.id);
				}
			}
		}
	}

	// -------------------------------------------------------------------------
	// Prompt builder
	// -------------------------------------------------------------------------

	/**
	 * Build the execution prompt that is sent to the AI tool (Claude Code or
	 * the local AI SDK model). Includes full task context so the agent knows
	 * exactly what to implement.
	 */
	async buildTaskPrompt(task: Task, project: Project, agentRole?: string): Promise<string> {
		const techStack = project.techStack.length > 0 ? project.techStack.join(", ") : "Not specified";

		// Cap potentially-unbounded user input early so downstream concatenations
		// stay within budget.
		const safeDescription = capText(task.description ?? "", PROMPT_LIMITS.taskDescription);

		const lines: string[] = [
			`# Task: ${task.title}`,
			"",
			`## Project`,
			`- Name: ${project.name}`,
			`- Tech Stack: ${techStack}`,
			`- Description: ${project.description || "No description provided"}`,
			"",
		];

		// v4.0: FTS-backed compact cross-agent context (replaces raw file listing)
		try {
			const compact = await compactCrossAgentContext({
				projectId: project.id,
				taskTitle: task.title,
				taskDescription: safeDescription,
				maxTokens: 3000,
				maxFiles: 10,
			});
			if (compact.prompt) {
				lines.push(compact.prompt, "");
			}
		} catch (err) {
			console.warn("[execution-engine] compactCrossAgentContext failed (non-blocking):", err);
		}

		// RAG Context: retrieve relevant code snippets from the project's vector store
		try {
			const ragContext = await buildRAGContext(project.id, task.title, safeDescription);
			if (ragContext && ragContext.relevantChunks.length > 0) {
				lines.push(formatRAGContext(ragContext));
			}
		} catch (err) {
			// RAG failure must never block task execution
			console.warn("[execution-engine] RAG context fetch failed (non-blocking):", err);
		}

		// v4.0: Inject resume snapshot for retried/revised tasks
		if (task.retryCount > 0 || task.revisionCount > 0) {
			try {
				const sessionKey = `${project.id}:${task.id}`;
				const snapshot = await buildResumeSnapshot(sessionKey);
				if (snapshot.eventCount > 0) {
					lines.push(formatResumeSnapshot(snapshot), "");
				}
			} catch (err) {
				console.warn("[execution-engine] Resume snapshot failed (non-blocking):", err);
			}
		}

		// Self-healing: inject previous error so agent can fix it
		if (task.error) {
			lines.push(
				`## Previous Attempt Failed`,
				"",
				"This task was attempted before but failed with the following error. Please fix the issue and try again:",
				"",
				"```",
				task.error.slice(0, 1000),
				"```",
				"",
				"Common fixes: check import paths, install missing dependencies, fix syntax errors, ensure files exist before reading.",
				"",
			);
		}

		lines.push(
			`## Task Details`,
			`- ID: ${task.id}`,
			`- Complexity: ${task.complexity}`,
			`- Branch: ${task.branch || "main"}`,
			`- Retry: ${task.retryCount > 0 ? `#${task.retryCount}` : "first attempt"}`,
			"",
			`## Instructions`,
			safeDescription,
			"",
			`## Available Tools`,
			"You have the following tools to complete this task:",
			"- **listFiles**: List files in a directory",
			"- **readFile**: Read file contents",
			"- **writeFile**: Create or update files",
			"- **runCommand**: Run shell commands (npm/pnpm install, tests, builds, etc.)",
			"- **commitChanges**: Git commit your changes",
			"",
			`## Workflow`,
			"1. First, use listFiles to understand the current project structure",
			"2. Read any relevant existing files to understand the codebase",
			"3. Create or modify the necessary files using writeFile",
			"4. Run any relevant commands (install deps, run tests, etc.)",
			"5. Commit your changes with a descriptive message",
			"",
			`## Important`,
			"- Read existing files before modifying them to maintain consistency",
			"- Follow the same patterns and conventions used in existing code",
			"- Do not overwrite files created by other agents unless necessary for your task",
			"",
			`## Output`,
			"After completing all tool calls, provide a brief summary of what you did.",
		);

		// Role bazlı güvenlik politikasını prompt'a ekle
		if (agentRole) {
			const policy = getDefaultPolicy(agentRole);
			lines.push("", buildPolicyPromptSection(policy));
		}

		// Prompt boyutunu ölç, limit aşılırsa truncate et ve telemetri emit et
		const { prompt } = enforcePromptBudget(lines.join("\n"), {
			projectId: project.id,
			taskId: task.id,
		});
		return prompt;
	}

	// -------------------------------------------------------------------------
	// Special (non-AI) task execution: integration-test, run-app
	// -------------------------------------------------------------------------

	private async executeSpecialTask(projectId: string, project: Project, task: Task): Promise<void> {
		await taskEngine.assignTask(task.id, task.taskType ?? "system");
		await taskEngine.startTask(task.id);

		const termLog = (msg: string) => {
			eventBus.emitTransient({
				projectId,
				type: "agent:output",
				taskId: task.id,
				payload: { output: msg },
			});
		};

		try {
			let output: TaskOutput;

			if (task.taskType === "integration-test") {
				termLog("[execution-engine] Running integration tests...");
				output = await runIntegrationTest(projectId, project.repoPath, termLog);
			} else {
				// run-app
				termLog("[execution-engine] Starting application...");
				const result = await startApp(projectId, project.repoPath, termLog);
				output = {
					filesCreated: [],
					filesModified: [],
					logs: [`Started ${result.services.length} service(s). Preview: ${result.previewUrl}`],
				};
			}

			await taskEngine.completeTask(task.id, output);
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			console.error(`[execution-engine] Special task failed: "${task.title}" — ${errorMsg}`);
			eventBus.emit({
				projectId,
				type: "agent:error",
				taskId: task.id,
				payload: { error: errorMsg },
			});
			await taskEngine.failTask(task.id, errorMsg);
			await updateProject(projectId, { status: "failed" });
		}

		// Dispatch next tasks
		await this.dispatchReadyTasks(projectId, task.phaseId);
		const plan = await getLatestPlan(projectId);
		if (plan) {
			const phases = await listPhases(plan.id);
			for (const phase of phases) {
				if (phase.status === "running" && phase.id !== task.phaseId) {
					await this.dispatchReadyTasks(projectId, phase.id);
				}
			}
		}
	}

	// -------------------------------------------------------------------------
	// Dispatch newly ready tasks
	// -------------------------------------------------------------------------

	// -------------------------------------------------------------------------
	// Review Loop: reviewer agent auto-reviews coding task output
	// -------------------------------------------------------------------------

	private async executeReviewTask(projectId: string, project: Project, reviewTask: Task): Promise<void> {
		// Find the original task (review task depends on it)
		const originalTaskId = reviewTask.dependsOn?.[0];
		const originalTask = originalTaskId ? await getTask(originalTaskId) : null;
		if (!originalTask || originalTask.status !== "review") {
			// Original task no longer in review — auto-complete review task
			await taskEngine.assignTask(reviewTask.id, reviewTask.assignedAgent);
			await taskEngine.startTask(reviewTask.id);
			await taskEngine.completeTask(reviewTask.id, {
				filesCreated: [],
				filesModified: [],
				logs: ["Orijinal task artık review durumunda değil — review atlandı"],
			});
			return;
		}

		const reviewer = await this.resolveAgent(projectId, reviewTask.assignedAgent);
		if (!reviewer) {
			await taskEngine.assignTask(reviewTask.id, reviewTask.assignedAgent);
			await taskEngine.startTask(reviewTask.id);
			await taskEngine.failTask(reviewTask.id, "Reviewer agent bulunamadı");
			await taskEngine.submitReview(originalTaskId!, true, "Reviewer bulunamadı — auto-approved");
			return;
		}

		await taskEngine.assignTask(reviewTask.id, reviewer.id);
		await taskEngine.startTask(reviewTask.id);

		const allFiles = [...(originalTask.output?.filesCreated ?? []), ...(originalTask.output?.filesModified ?? [])];

		const termLog = (msg: string) => {
			agentRuntime.ensureVirtualProcess(projectId, reviewer.id, reviewer.name);
			agentRuntime.appendVirtualOutput(projectId, reviewer.id, msg);
			eventBus.emitTransient({
				projectId,
				type: "agent:output",
				agentId: reviewer.id,
				taskId: reviewTask.id,
				payload: { output: msg },
			});
		};

		// Zero-file decision review: decision.md veya log'larda DECISION bloğu var
		const isZeroFileDecision =
			(allFiles.length <= 1 && allFiles[0]?.includes("decision.md")) ||
			(originalTask.output?.logs ?? []).some((l) => l.includes("--- DECISION ---"));

		// Decision içeriğini log'lardan çıkar (dosya yazılmamış olsa bile)
		let decisionContent = "";
		if (isZeroFileDecision) {
			const logs = originalTask.output?.logs ?? [];
			let capture = false;
			const lines: string[] = [];
			for (const line of logs) {
				if (line.includes("--- DECISION ---")) {
					capture = true;
					continue;
				}
				if (line.includes("--- /DECISION ---")) {
					capture = false;
					continue;
				}
				if (capture) lines.push(line);
			}
			decisionContent = lines.join("\n");
		}

		let reviewPrompt: string;

		if (isZeroFileDecision) {
			termLog(`[review] "${originalTask.title}" — zero-file decision inceleniyor...`);
			reviewPrompt = [
				`# Zero-File Decision Review: ${originalTask.title}`,
				"",
				`## Context`,
				`- Project: ${project.name}`,
				`- Original task: ${originalTask.title}`,
				`- Description: ${originalTask.description}`,
				"",
				`## Durum`,
				"Orijinal task hiçbir dosya oluşturmadı veya değiştirmedi.",
				"",
				...(allFiles.length > 0 ? [`## Decision Dosyası`, `- \`${allFiles[0]}\``, ""] : []),
				...(decisionContent ? ["## Decision İçeriği (inline)", decisionContent, ""] : []),
				`## Reviewer Talimatları`,
				...(allFiles.length > 0
					? ["1. readFile ile decision.md dosyasını oku"]
					: ["1. Yukarıdaki decision içeriğini oku"]),
				"2. Orijinal task açıklamasını dikkatlice incele",
				"3. Task'ın dosya değişikliği gerektirip gerektirmediğini değerlendir:",
				"   - Eğer task gerçekten dosya değişikliği gerektirmiyorsa (analiz, araştırma vb.) → APPROVED",
				"   - Eğer agent hatalı çalıştıysa ve dosya üretmeliydi → REJECTED",
				"4. Kararını net gerekçeyle açıkla",
				"",
				"## Output Format",
				'- "APPROVED" — task dosya değişikliği gerektirmiyor, kabul edildi',
				'- "REJECTED" — task dosya üretmeliydi ama üretmedi, revizyon gerekli',
			].join("\n");
		} else if (allFiles.length === 0) {
			// Hiç dosya yok ve decision.md de yok — doğrudan reject
			await taskEngine.completeTask(reviewTask.id, {
				filesCreated: [],
				filesModified: [],
				logs: ["İncelenecek dosya yok — orijinal task dosya değişikliği üretmedi"],
			});
			await taskEngine.submitReview(
				originalTaskId!,
				false,
				"İncelenecek dosya yok — orijinal task dosya değişikliği üretmedi",
			);
			return;
		} else {
			termLog(`[review] "${originalTask.title}" inceleniyor — ${allFiles.length} dosya...`);
			reviewPrompt = [
				`# Code Review: ${originalTask.title}`,
				"",
				`## Context`,
				`- Project: ${project.name}`,
				`- Original task: ${originalTask.title}`,
				`- Description: ${originalTask.description}`,
				"",
				`## Files to Review`,
				...allFiles.map((f) => `- \`${f}\``),
				"",
				`## Instructions`,
				"Review the code for each file:",
				"1. Use readFile to read the file contents",
				"2. Check for bugs, security issues, code style problems, and missing edge cases",
				"3. If you find issues, use writeFile to fix them directly",
				"4. If the code is good, just note it as approved",
				"",
				"## Output Format",
				"Provide a brief review summary. Start with either:",
				'- "APPROVED" if the code is good',
				'- "FIXED" if you made corrections',
				"",
				"Then list what you found and any changes you made.",
			].join("\n");
		}

		try {
			const reviewTools = await resolveAllowedTools(projectId, reviewer.id, reviewer.role);
			const reviewAdapter = getAdapter(reviewer.cliTool ?? "claude-code");

			const cliResult = await reviewAdapter.execute({
				projectId,
				agentId: reviewer.id,
				agentName: reviewer.name,
				repoPath: project.repoPath,
				prompt: reviewPrompt,
				systemPrompt: reviewer.systemPrompt
					? composeSystemPrompt(reviewer.systemPrompt)
					: this.defaultSystemPrompt(reviewer),
				timeoutMs: reviewer.taskTimeout ?? DEFAULT_TASK_TIMEOUT_MS,
				model: "sonnet",
				allowedTools: reviewTools,
			});

			// Record token usage
			if (cliResult.inputTokens || cliResult.outputTokens) {
				const totalTokens = cliResult.inputTokens + cliResult.outputTokens;
				await recordTokenUsage({
					projectId,
					taskId: reviewTask.id,
					agentId: reviewer.id,
					model: cliResult.model || "claude-sonnet-4-6",
					provider: "anthropic",
					inputTokens: cliResult.inputTokens,
					outputTokens: cliResult.outputTokens,
					totalTokens,
					costUsd: cliResult.totalCostUsd,
					cacheCreationTokens: cliResult.cacheCreationTokens,
					cacheReadTokens: cliResult.cacheReadTokens,
				});
				termLog(`[review-cost] ${cliResult.model}: ${totalTokens} tokens ($${cliResult.totalCostUsd.toFixed(4)})`);
			}

			const approved = cliResult.text.toUpperCase().includes("APPROVED");
			const feedback = cliResult.text.slice(0, 2000);

			termLog(`[review] Sonuç: ${approved ? "APPROVED" : "NEEDS FIXES"}`);

			// Review agent output buffer'ını log dosyasına persist et
			const reviewOutputLines = agentRuntime.getAgentOutput(projectId, reviewer.id);
			if (reviewOutputLines.length > 0) {
				persistAgentLog(projectId, reviewer.id, reviewOutputLines).catch(() => {});
			}

			// Complete the review task with feedback as output
			await taskEngine.completeTask(reviewTask.id, {
				filesCreated: [],
				filesModified: cliResult.filesModified ?? [],
				logs: [feedback],
			});

			// Submit review result on the original task
			await taskEngine.submitReview(originalTaskId!, approved, feedback);
			agentRuntime.markVirtualStopped(projectId, reviewer.id);

			// Auto-restart revision: if rejected, restart the original task for the dev agent
			if (!approved) {
				const revisedTask = await getTask(originalTaskId!);
				if (revisedTask?.status === "revision") {
					console.log(`[execution-engine] Review rejected — restarting "${revisedTask.title}" for revision`);
					await taskEngine.restartRevision(originalTaskId!);
					const freshTask = await getTask(originalTaskId!);
					if (freshTask) {
						this.executeTask(projectId, freshTask).catch(async (e) => {
							console.error(`[execution-engine] Revision re-execution failed:`, e);
							try {
								const msg = e instanceof Error ? e.message : String(e);
								await taskEngine.failTask(originalTaskId!, `Revision re-execution failed: ${msg}`);
							} catch {
								/* task zaten fail olmuş olabilir */
							}
						});
					}
				}
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			termLog(`[review] Hata: ${msg.slice(0, 200)}`);
			agentRuntime.markVirtualStopped(projectId, reviewer.id);

			// Fail the review task but auto-approve original so it doesn't get stuck
			await taskEngine.failTask(reviewTask.id, msg);
			try {
				await taskEngine.submitReview(originalTaskId!, true, `Review failed: ${msg.slice(0, 200)} — auto-approved`);
			} catch {
				/* */
			}
		}
	}

	/**
	 * After a task in `phaseId` has been settled, check for tasks whose
	 * dependencies are now satisfied and dispatch them in parallel.
	 */
	private async dispatchReadyTasks(projectId: string, phaseId: string): Promise<void> {
		const project = await getProject(projectId);
		if (!project || project.status === "failed") return;

		const phaseFailed = await taskEngine.isPhaseFailed(phaseId);
		const ready = await taskEngine.getReadyTasks(phaseId);
		if (ready.length === 0) return;

		// If phase has failed tasks, only dispatch review tasks (to complete in-progress work)
		const toDispatch = phaseFailed ? ready.filter((t) => t.title.startsWith("Code Review: ")) : ready;
		if (toDispatch.length === 0) return;

		// Execute tasks sequentially to avoid rate-limit issues with AI providers
		for (const task of toDispatch) {
			await this.executeTask(projectId, task);
		}
	}

	// -------------------------------------------------------------------------
	// Output parsing
	// -------------------------------------------------------------------------

	/**
	 * Parse the raw text output from Claude Code (or local AI) and extract
	 * structured information about files created/modified and test results.
	 */
	private parseTaskOutput(output: string): TaskOutput {
		const filesCreated: string[] = [];
		const filesModified: string[] = [];
		const logs: string[] = [];
		let testResults: TaskOutput["testResults"];

		const lines = output.split("\n");

		for (const line of lines) {
			const trimmed = line.trim();

			// Files created: lines starting with "+ " or "Created: "
			if (trimmed.startsWith("+ ") || /^created:\s+/i.test(trimmed)) {
				const filePath = trimmed.replace(/^\+\s+|^created:\s+/i, "").trim();
				if (filePath) filesCreated.push(filePath);
				continue;
			}

			// Files modified: lines starting with "~ " or "Modified: "
			if (trimmed.startsWith("~ ") || /^modified:\s+/i.test(trimmed)) {
				const filePath = trimmed.replace(/^~\s+|^modified:\s+/i, "").trim();
				if (filePath) filesModified.push(filePath);
				continue;
			}

			// Test results: "TESTS: passed=N failed=N total=N"
			const testMatch = trimmed.match(/TESTS?:\s*passed=(\d+)\s+failed=(\d+)\s+total=(\d+)/i);
			if (testMatch) {
				testResults = {
					passed: Number.parseInt(testMatch[1], 10),
					failed: Number.parseInt(testMatch[2], 10),
					total: Number.parseInt(testMatch[3], 10),
				};
				continue;
			}

			// Capture meaningful log lines (skip blank lines)
			if (trimmed.length > 0) {
				logs.push(trimmed);
			}
		}

		// Limit logs to last 100 lines to avoid bloat
		const trimmedLogs = logs.slice(-100);

		return { filesCreated, filesModified, testResults, logs: trimmedLogs };
	}

	// -------------------------------------------------------------------------
	// Agent resolution
	// -------------------------------------------------------------------------

	/**
	 * Resolve an agent config from an assignment string that may be:
	 *   - An exact agent UUID (from listAgentConfigs)
	 *   - A role name (e.g. "backend", "frontend")
	 *
	 * For a project, we first look at project-scoped agents; then we look at
	 * all agent configs globally.
	 */
	private async resolveAgent(projectId: string, assignment: string): Promise<AgentConfig | undefined> {
		if (!assignment) return undefined;

		// 1. Try project-scoped agents first (by ID, role, or name)
		const projectAgents = await listProjectAgents(projectId);
		const pById = projectAgents.find((a) => a.id === assignment);
		if (pById) return pById as unknown as AgentConfig;

		const pByRole = projectAgents.find((a) => a.role.toLowerCase() === assignment.toLowerCase());
		if (pByRole) return pByRole as unknown as AgentConfig;

		const pByName = projectAgents.find((a) => a.name.toLowerCase() === assignment.toLowerCase());
		if (pByName) return pByName as unknown as AgentConfig;

		// 1b. Category match (öncelikli): "backend"→"backend-dev", "frontend"→"frontend-dev"
		const aLower = assignment.toLowerCase();
		const categoryMap: Record<string, string[]> = {
			backend: ["backend-dev", "backend-developer"],
			frontend: ["frontend-dev", "frontend-developer"],
			qa: ["backend-qa", "frontend-qa", "qa-engineer"],
			design: ["design-lead", "ui-designer"],
		};
		const candidates = categoryMap[aLower];
		if (candidates) {
			const pByCategory = projectAgents.find((a) => candidates.includes(a.role.toLowerCase()));
			if (pByCategory) return pByCategory as unknown as AgentConfig;
		}

		// 1c. Fuzzy role match: "backend" matches "backend-dev", "qa" matches "backend-qa"/"frontend-qa"
		const pByPartialRole = projectAgents.find(
			(a) => a.role.toLowerCase().startsWith(aLower + "-") || a.role.toLowerCase().endsWith("-" + aLower),
		);
		if (pByPartialRole) return pByPartialRole as unknown as AgentConfig;

		// 2. Fallback to global agent configs
		const byId = await getAgentConfig(assignment);
		if (byId) return byId;

		const all = await listAgentConfigs();
		const byRole = all.find((a) => a.role.toLowerCase() === assignment.toLowerCase());
		if (byRole) return byRole;

		const byName = all.find((a) => a.name.toLowerCase() === assignment.toLowerCase());
		return byName;
	}

	// -------------------------------------------------------------------------
	// Default system prompt fallback
	// -------------------------------------------------------------------------

	private defaultSystemPrompt(agent: { name: string; role: string; skills: string[] }): string {
		const rolePrompt = `You are ${agent.name}, a ${agent.role} agent in Oscorpex.
Your skills include: ${agent.skills.join(", ") || "general software development"}.
Complete the task described in the user message. Be precise and produce working code.`;
		return composeSystemPrompt(rolePrompt);
	}

	// -------------------------------------------------------------------------
	// Execution status
	// -------------------------------------------------------------------------

	/**
	 * Return a snapshot of currently running tasks and active containers for a
	 * project. Used by the GET /projects/:id/execution/status endpoint.
	 */
	getExecutionStatus(projectId: string) {
		const progress = taskEngine.getProgress(projectId);

		return {
			projectId,
			runtimes: [],
			progress,
			concurrency: {
				active: this._semaphore.activeCount,
				pending: this._semaphore.pendingCount,
				max: MAX_CONCURRENT_TASKS,
			},
		};
	}
}

export const executionEngine = new ExecutionEngine();

// Uygulama başlangıcında yarıda kalmış görevleri kurtart
executionEngine.recoverStuckTasks().catch((err) => {
	console.error("[execution-engine] Startup recovery failed:", err);
});
