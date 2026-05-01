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
import { executeWithCLI, isClaudeCliAvailable, resolveFilePaths } from "./cli-runtime.js";
import { buildPolicyPromptSection, getDefaultPolicy } from "./command-policy.js";
import { buildRAGContext, formatRAGContext } from "./context-builder.js";
import { compactCrossAgentContext } from "./context-sandbox.js";
import { buildResumeSnapshot, formatResumeSnapshot } from "./context-session.js";
import {
	claimTask,
	getAgentConfig,
	getLatestPlan,
	getPipelineRun,
	getProject,
	getProjectSetting,
	getTask,
	listAgentConfigs,
	listPhases,
	listProjectAgents,
	listProjectTasks,
	listProjects,
	recordTokenUsage,
	reclaimStaleQueuedClaimsForProject,
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
import { getGoalForTask, formatGoalPrompt } from "./goal-engine.js";
import { evaluateReplan } from "./adaptive-replanner.js";
import { resolveModel } from "./model-router.js";
import { runVerificationGate, runTestGateCheck, runGoalEvaluation } from "./execution-gates.js";
import { processAgentProposals } from "./proposal-processor.js";
import { buildTaskPrompt, defaultSystemPrompt } from "./prompt-builder.js";
import { executeReviewTask, resolveAgent } from "./review-dispatcher.js";
import {
	resolveTaskPolicy, startSandboxSession, endSandboxSession,
	checkToolAllowed, checkPathAllowed,
	enforceToolCheck, enforcePathChecks, enforceOutputSizeCheck,
	SandboxViolationError,
	type SandboxPolicy,
} from "./sandbox-manager.js";
import { resolveWorkspace, type ExecutionWorkspace } from "./execution-workspace.js";
// test-gate imported via execution-gates.ts
import { queryOne as pgQueryOne } from "./pg.js";
import { PROMPT_LIMITS, capText, enforcePromptBudget } from "./prompt-budget.js";
import { providerState } from "./provider-state.js";
import { createProviderResolver } from "./provider-resolver.js";
import { resolveTaskTimeoutMs, TIMEOUT_WARNING_THRESHOLD } from "./timeout-policy.js";
import {
	AdaptiveSemaphore,
	ConcurrencyTracker,
	AdaptiveConcurrencyController,
} from "./adaptive-concurrency.js";
import { sortTasksByFairness } from "./task-scheduler.js";
import { evaluateRetry, MAX_AUTO_RETRIES, type RetryTelemetry } from "./retry-policy.js";
import { markExecutionStarted } from "./preflight-warmup.js";
import { syncDeclaredDependencies } from "./repo-dependency-sync.js";
import { ProviderTelemetryCollector } from "@oscorpex/provider-sdk";
import {
	startProviderTelemetry,
	finishProviderTelemetry,
	recordProviderFallback,
	recordProviderDegraded,
	recordProviderCancel,
	classifyProviderErrorWithReason,
	CANCEL_REASONS,
	type TelemetryRecord,
} from "./provider-telemetry.js";
import { taskEngine } from "./task-engine.js";
import { runIntegrationTest } from "./task-runners.js";
import type { AgentConfig, AgentCliTool, Project, Task, TaskOutput } from "./types.js";
import { canonicalizeAgentRole, roleMatches } from "./roles.js";
import { createLogger } from "./logger.js";

const log = createLogger("execution-engine");

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
// Queue wait computation helper (TASK 2.2 — visible calculation point)
// ---------------------------------------------------------------------------

/**
 * Computes queue wait time in milliseconds from a task's createdAt and startedAt timestamps.
 * Returns 0 if either timestamp is missing.
 *
 * Definition: queue wait = task startedAt − task createdAt
 *   - createdAt: set when task is first inserted into DB (tasks.created_at DEFAULT now())
 *   - startedAt: set when task transitions from "assigned" → "running"
 *
 * This is the **single source of truth** for queue wait calculation.
 */
export function computeQueueWaitMs(task: { createdAt?: string | null; startedAt?: string | null }): number {
	if (!task.createdAt || !task.startedAt) return 0;
	const wait = new Date(task.startedAt).getTime() - new Date(task.createdAt).getTime();
	return Math.max(0, wait);
}

// ---------------------------------------------------------------------------
// Execution Engine
// ---------------------------------------------------------------------------

class ExecutionEngine {
	/** Guard: prevents the same task from being dispatched concurrently */
	private _dispatchingTasks = new Set<string>();

	/** Active AbortControllers for running tasks, keyed by `projectId:taskId` */
	private _activeControllers = new Map<string, AbortController>();

	/** Adaptive semaphore limiting concurrent CLI executions */
	private _semaphore = new AdaptiveSemaphore();

	/** Per-project / per-provider concurrency tracker */
	private _concurrencyTracker = new ConcurrencyTracker();

	/** Adaptive concurrency controller (adjusts max based on health signals) */
	private _concurrencyController: AdaptiveConcurrencyController;

	/** Provider execution telemetry collector (EPIC 3 observability) */
	readonly telemetry = new ProviderTelemetryCollector();

	/** Unique worker ID for distributed task claiming (PID-based) */
	private _workerId = `worker-${process.pid}-${Date.now()}`;
	private _dispatchWatchdogRunning = false;
	private _lastWatchdogKickByProject = new Map<string, number>();

	constructor() {
		// Ready-task dispatch is handled explicitly at the end of task execution.
		// Avoiding an onTaskCompleted callback here prevents duplicate dispatch
		// races with the inline dispatch path.

		// TASK 15: Log active performance configuration at startup
		import("./performance-config.js").then(({ logPerformanceConfig }) => {
			logPerformanceConfig();
		}).catch(() => {
			// Non-blocking — config logging is best-effort
		});

		// TASK 8: Adaptive concurrency controller
		this._concurrencyController = new AdaptiveConcurrencyController(
			this._semaphore,
			() => {
				const snap = this.telemetry.getLatencySnapshot("global");
				const total = (snap?.successfulExecutions ?? 0) + (snap?.failedExecutions ?? 0);
				return total > 0 ? (snap?.failedExecutions ?? 0) / total : 0;
			},
			() => this._semaphore.pendingCount,
		);
		this._concurrencyController.start();

		// Self-healing watchdog:
		// If pipeline is running but no active execution is visible while ready tasks exist,
		// trigger a dispatch kick to recover from missed event/race windows.
		setInterval(() => {
			this.runDispatchWatchdog().catch((err) => {
				log.warn("[execution-engine] Dispatch watchdog failed (non-blocking):" + " " + String(err));
			});
		}, 15_000);
	}

	private async runDispatchWatchdog(): Promise<void> {
		if (this._dispatchWatchdogRunning) return;
		this._dispatchWatchdogRunning = true;
		try {
			// If engine is actively working, watchdog should stay passive.
			if (this._semaphore.activeCount > 0 || this._semaphore.pendingCount > 0) return;

			const projects = await listProjects();
			const now = Date.now();
			for (const project of projects) {
				if (project.status !== "running") continue;

				const run = await getPipelineRun(project.id);
				if (!run || run.status !== "running") continue;

				const plan = await getLatestPlan(project.id);
				if (!plan || plan.status !== "approved") continue;

				const phases = await listPhases(plan.id);
				const runningPhases = phases.filter((phase) => phase.status === "running");
				if (runningPhases.length === 0) continue;

				let hasReadyTask = false;
				for (const phase of runningPhases) {
					const ready = await taskEngine.getReadyTasks(phase.id);
					if (ready.length > 0) {
						hasReadyTask = true;
						break;
					}
				}
				if (!hasReadyTask) continue;

				const lastKick = this._lastWatchdogKickByProject.get(project.id) ?? 0;
				// Cooldown to avoid dispatch thrash loops when a project keeps flapping.
				if (now - lastKick < 20_000) continue;

				this._lastWatchdogKickByProject.set(project.id, now);
				log.warn(`[execution-engine] Watchdog kick: restarting dispatch for project "${project.name}"`);
				this.startProjectExecution(project.id).catch((err) => {
					log.warn("[execution-engine] Non-blocking operation failed:" + " " + String(err?.message ?? err));
				});
			}
		} finally {
			this._dispatchWatchdogRunning = false;
		}
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
						log.info(`[execution-engine] Recovery: "${task.title}" → queued (was ${task.status})`);
						phaseRecovered = true;
					}
				}
				if (phaseRecovered && phase.status === "failed") {
					await updatePhaseStatus(phase.id, "running");
					log.info(`[execution-engine] Recovery: phase "${phase.name}" → running (was failed)`);
				}
				hasRecovered = hasRecovered || phaseRecovered;
			}

			if (hasRecovered) {
				log.info(`[execution-engine] Recovering project "${project.name}" — restarting execution`);
				this.startProjectExecution(project.id).catch((err) => {
					log.error(`[execution-engine] Recovery failed for "${project.name}":` + " " + String(err));
				});
			}

			// Restart revision tasks that were left in 'revision' status
			for (const phase of phases) {
				if (phase.status !== "running" && phase.status !== "completed") continue;
				for (const task of phase.tasks ?? []) {
					if (task.status === "revision") {
						log.info(`[execution-engine] Recovery: restarting revision "${task.title}"`);
						try {
							await taskEngine.restartRevision(task.id);
							const fresh = await getTask(task.id);
							if (fresh) {
								this.executeTask(project.id, fresh).catch((err) => log.warn("[execution-engine] Non-blocking operation failed:" + " " + String(err?.message ?? err)));
							}
						} catch (e) {
							log.error({ err: e }, `Revision recovery failed for "${task.title}"`);
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
					log.info(
						`[execution-engine] Recovery: ${ready.length} orphaned ready task(s) in phase "${phase.name}" — dispatching`,
					);
					Promise.allSettled(ready.map((task: any) => this.executeTask(project.id, task))).catch((err) => log.warn("[execution-engine] Non-blocking operation failed:" + " " + String(err?.message ?? err)));
				}

				// Recover orphaned running tasks — stuck in "running" with no active CLI process
				// These arise when revision re-execution fails silently (fire-and-forget .catch)
				for (const task of phase.tasks ?? []) {
					if (
						task.status === "running" &&
						!this._dispatchingTasks.has(task.id) &&
						!this._activeControllers.has(`${project.id}:${task.id}`)
					) {
						log.info(`[execution-engine] Recovery: orphaned running task "${task.title}" → queued`);
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
						Promise.allSettled(ready.map((task: any) => this.executeTask(project.id, task))).catch((err) => log.warn("[execution-engine] Non-blocking operation failed:" + " " + String(err?.message ?? err)));
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
					await updateTask(task.id, { status: "queued", startedAt: undefined });
					log.info(`[execution-engine] Task "${task.title}" → queued (pipeline paused)`);
				} catch (err) {
					log.warn(`[execution-engine] Task reset failed: ${task.id}` + " " + String(err));
				}
			}
		}

		if (cancelled > 0) {
			log.info(`[execution-engine] Cancelled ${cancelled} running task(s) for project ${projectId}`);
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

		// Safety net: clear stale queued claims before trying to dispatch ready tasks.
		// This prevents dead workers from pinning the phase head task indefinitely.
		await reclaimStaleQueuedClaimsForProject(projectId);

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
			// Self-heal: stale in-memory dispatch marker can survive abnormal flows
			// (e.g. restart/recovery overlap) while no active controller exists.
			const controllerKey = `${projectId}:${task.id}`;
			if (!this._activeControllers.has(controllerKey)) {
				this._dispatchingTasks.delete(task.id);
				log.warn(`[execution-engine] Cleared stale dispatch marker for task "${task.title}"`);
			} else {
			log.info(`[execution-engine] Task "${task.title}" zaten dispatch ediliyor, skip.`);
			return;
			}
		}

		this._dispatchingTasks.add(task.id);
		await this._semaphore.acquire();
		let claimedTaskId: string | null = null;
		try {
			// IMPORTANT: claim only after acquiring a concurrency slot.
			// Otherwise tasks can remain queued+claimed while waiting on semaphore.
			const freshTask = await claimTask(task.id, this._workerId);
			if (!freshTask) {
				log.info(
					`[execution-engine] Task "${task.title}" could not be claimed (already taken or not queued), skip.`,
				);
				return;
			}
			claimedTaskId = freshTask.id;

			// v8.0: Agent constraint check — verify governance rules allow this task to execute
			try {
				const { classifyRisk, checkConstraints } = await import("./agent-runtime/agent-constraints.js");
				const riskLevel = classifyRisk({
					proposalType: freshTask.parentTaskId ? "sub_task" : "fix_task",
					severity: undefined,
					title: freshTask.title,
				});
				const constraint = await checkConstraints(projectId, "execute_task", riskLevel);
				if (!constraint.allowed && constraint.requiresApproval) {
					log.warn(`[execution-engine] Task "${freshTask.title}" blocked by constraints (${riskLevel} risk — requires approval)`);
					await updateTask(freshTask.id, { status: "waiting_approval", requiresApproval: true });
					await releaseTaskClaim(freshTask.id);
					claimedTaskId = null;
					eventBus.emit({
						projectId,
						type: "task:approval_required",
						taskId: freshTask.id,
						payload: { title: freshTask.title, riskLevel, reason: constraint.reason },
					});
					return;
				}
			} catch (err) {
				log.warn("[execution-engine] Constraint check failed (non-blocking):" + " " + String(err));
			}

			// v3.0: Auto-decompose L/XL tasks into micro-tasks
			if ((freshTask.complexity === "L" || freshTask.complexity === "XL") && !freshTask.parentTaskId) {
				try {
					const { shouldDecompose, decomposeTask } = await import("./task-decomposer.js");
					if (shouldDecompose(freshTask)) {
						log.info(`[execution-engine] Auto-decomposing ${freshTask.complexity} task "${freshTask.title}"`);
						const subTasks = await decomposeTask(freshTask, projectId);
						if (subTasks.length > 0) {
							// Parent becomes a container — update status to track sub-tasks
							await updateTask(freshTask.id, { status: "running" });
							await releaseTaskClaim(freshTask.id);
							claimedTaskId = null;
							// Dispatch sub-tasks
							for (const sub of subTasks) {
								this.executeTask(projectId, sub).catch((err) =>
									log.error(`[execution-engine] Sub-task "${sub.title}" dispatch hatası:` + " " + String(err)),
								);
							}
							return;
						}
					}
				} catch (err) {
					log.warn("[execution-engine] Task decomposition failed, executing as-is:" + " " + String(err));
				}
			}

			await this._executeTaskInner(projectId, freshTask);
		} finally {
			this._semaphore.release();
			this._dispatchingTasks.delete(task.id);
			this._activeControllers.delete(`${projectId}:${task.id}`);
			if (claimedTaskId) {
				await releaseTaskClaim(claimedTaskId);
			}
		}
	}

	private async _executeTaskInner(projectId: string, task: Task): Promise<void> {
		const project = await getProject(projectId);
		if (!project) throw new Error(`Project ${projectId} not found`);

		// Register AbortController for this task so it can be cancelled externally
		const taskController = new AbortController();
		const controllerKey = `${projectId}:${task.id}`;
		this._activeControllers.set(controllerKey, taskController);

		// ═══════════════════════════════════════════════════════════════════════
		// TASK 12: Cold-start tracking
		const { isColdStart } = markExecutionStarted();

		// Provider Telemetry Lifecycle (EPIC 3 — Observability)
		// ═══════════════════════════════════════════════════════════════════════
		// 1. Abort listener (cancel audit) — fires before telemetryRecord exists
		// 2. startProviderTelemetry(...) — before adapter chain
		// 3. recordProviderFallback(...) — on adapter failure when fallback exists
		// 4. finishProviderTelemetry(...) — on success or final failure
		// 5. recordProviderDegraded(...) — when all providers exhausted
		// 6. recordProviderCancel(...) — when abort signal fires after step 2
		// ═══════════════════════════════════════════════════════════════════════
		let telemetryRecord: TelemetryRecord | undefined;
		let cancelPending = false;
		let timeoutMs = 0;
		taskController.signal.addEventListener("abort", () => {
			cancelPending = true;
			if (telemetryRecord) {
				recordProviderCancel(this.telemetry, telemetryRecord, CANCEL_REASONS.pipeline_pause);
			}
		}, { once: true });

		// --- Non-AI task types: integration-test & run-app ---
		if (task.taskType === "integration-test" || task.taskType === "run-app") {
			await this.executeSpecialTask(projectId, project, task);
			return;
		}

		// --- Review task: "Code Review: X" — run review CLI and submit result ---
		if (task.title.startsWith("Code Review: ")) {
			await executeReviewTask(projectId, project, task, agentRuntime);
			return;
		}

		// Resolve agent config — prefer the task's assignedAgent value, which may
		// be an agent ID or a role name. Try both.
		const agent = await resolveAgent(projectId, task.assignedAgent);
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
		let lastFailureClassification: import("@oscorpex/provider-sdk").ProviderErrorClassification | undefined;
		const startedTask = await this._startTaskForExecution(task, agent.id);
		const queueWaitMs = startedTask ? computeQueueWaitMs(startedTask) : 0;

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
			if (protocolCtx.hasBlockers) {
				await updateTask(task.id, {
					status: "blocked",
				});
				eventBus.emit({
					projectId,
					type: "agent:requested_help",
					agentId: agent.id,
					taskId: task.id,
					payload: {
						title: task.title,
						taskTitle: task.title,
						agentName: agent.name,
						reason: "Execution blocked by unresolved inter-agent protocol messages",
						protocolBlocked: true,
					},
				});
				return;
			}
			if (protocolCtx.prompt) {
				promptSuffix += protocolCtx.prompt;
				await acknowledgeMessages(protocolCtx.messageIds);
			}
		} catch (err) {
			log.warn("[execution-engine] Agent runtime init failed (non-blocking):" + " " + String(err));
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
			log.warn("[execution-engine] Goal lookup failed (non-blocking):" + " " + String(err));
		}

		const prompt = await buildTaskPrompt(task, project, agent.role) + promptSuffix;
		const formatTaskLog = (line: string): string => {
			const shortId = task.id.slice(0, 8);
			return `[task:${shortId}] ${line}`;
		};

		// --- Sandbox: resolve policy for this task ---
		let sandboxSessionId: string | undefined;
		let sandboxPolicy: SandboxPolicy | undefined;
		let isolatedWorkspace: ExecutionWorkspace | undefined;
		let runtimeRepoPath = project.repoPath;
		try {
			sandboxPolicy = await resolveTaskPolicy(projectId, task, agent.role);
			if (project.repoPath) {
				isolatedWorkspace = await resolveWorkspace(project.repoPath, task.id, sandboxPolicy);
				runtimeRepoPath = isolatedWorkspace.repoPath || project.repoPath;
				const sbSession = await startSandboxSession({
					projectId,
					taskId: task.id,
					agentId: agent.id,
					workspacePath: runtimeRepoPath,
				});
				sandboxSessionId = sbSession.id;
			}
		} catch (err) {
			log.warn("[execution-engine] Sandbox init failed (non-blocking):" + " " + String(err));
		}

		// Sync node_modules vs package.json before CLI/test runs (partial clones often lack hoisted deps).
		if (runtimeRepoPath) {
			try {
				const syn = syncDeclaredDependencies(runtimeRepoPath);
				if (syn.ranInstall && syn.ok) {
					log.info(
						`[execution-engine] Pre-run dependency sync ok (${syn.command}); restored: ${syn.missingBefore.join(", ")}`,
					);
				} else if (syn.ranInstall && !syn.ok) {
					log.warn(
						`[execution-engine] Pre-run dependency sync incomplete` +
							(syn.error ? `: ${syn.error}` : "") +
							(syn.missingAfter.length ? ` — still missing: ${syn.missingAfter.join(", ")}` : ""),
					);
				}
			} catch (err) {
				log.warn("[execution-engine] Pre-run dependency sync threw:" + " " + String(err));
			}
		}

		try {
			// CLI-only execution — no API fallback
			if (!project.repoPath) {
				throw new Error(`Project ${projectId} has no repoPath configured`);
			}

			const allowedTools = await resolveAllowedTools(projectId, agent.id, agent.role);

			// --- Sandbox pre-execution: enforce tool restrictions ---
			if (sandboxPolicy && sandboxPolicy.enforcementMode !== "off") {
				for (const tool of allowedTools) {
					await enforceToolCheck(sandboxPolicy, tool, sandboxSessionId);
				}
				// Also enforce denied tools list against any critical tool names
				for (const denied of sandboxPolicy.deniedTools) {
					if (allowedTools.includes(denied)) {
						await enforceToolCheck(sandboxPolicy, denied, sandboxSessionId);
					}
				}
			}

			// v3.4 + M4: Model routing — complexity + prior failures + review rejections + provider-native models.
			const primaryCliTool: AgentCliTool = agent.cliTool ?? "claude-code";
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
				log.warn("[execution-engine] resolveModel failed, using fallback:" + " " + String(err));
			}

			// TASK 7: Provider-aware timeout resolution
			timeoutMs = await resolveTaskTimeoutMs(projectId, task.complexity, agent.taskTimeout, primaryCliTool);

			// Timeout'un %80'ine girildiğinde warning event emit edecek callback
			const onTimeoutWarning = () => {
				const remainingMs = Math.round(timeoutMs * (1 - TIMEOUT_WARNING_THRESHOLD));
				const remainingSec = Math.round(remainingMs / 1000);
				log.warn(`[execution-engine] Timeout uyarısı: "${task.title}" — ${remainingSec}sn kaldı`);
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

			// Sandbox pre-execution gate: in hard mode, verify tools before spawning CLI
			if (sandboxPolicy?.enforcementMode === "hard" && sandboxPolicy.deniedTools.length > 0) {
				const deniedInAllowed = allowedTools.filter((t) => sandboxPolicy!.deniedTools.includes(t));
				if (deniedInAllowed.length > 0) {
					throw new SandboxViolationError({
						type: "tool_denied",
						detail: `Pre-execution tool check: denied tools in allowedTools list: ${deniedInAllowed.join(", ")}`,
						timestamp: new Date().toISOString(),
					});
				}
			}

			// M4: Adapter fallback chain — resolved via ProviderResolver
			const resolver = await createProviderResolver(primaryCliTool, ["claude-code", "cursor"], this.telemetry);

			let cliResult: Awaited<ReturnType<import("./cli-adapter.js").CLIAdapter["execute"]>> | null = null;
			let lastAdapterError: Error | null = null;
			let lastFailureProvider: string | undefined;

			// --- Telemetry lifecycle: START ---
			telemetryRecord = startProviderTelemetry(this.telemetry, {
				runId: projectId,
				taskId: task.id,
				provider: primaryCliTool,
				repoPath: runtimeRepoPath,
				prompt,
				systemPrompt: agent.systemPrompt
					? composeSystemPrompt(agent.systemPrompt)
					: defaultSystemPrompt(agent),
				timeoutMs,
				allowedTools,
				model: routedModel,
			});
			if (telemetryRecord) {
				telemetryRecord.queueWaitMs = queueWaitMs;
			}
			if (cancelPending && telemetryRecord) {
				recordProviderCancel(this.telemetry, telemetryRecord, CANCEL_REASONS.pipeline_pause);
			}

			let adapter = await resolver.next({ allowedTools, lastFailureProvider, lastFailureClassification });
			while (adapter) {
				const adapterName = adapter.name as AgentCliTool;

				// Session step: CLI execution started
				if (sessionId) {
					recordStep(sessionId, { step: 1, type: "action_executed", summary: `CLI execution started: ${adapter.name}` }).catch((err) => log.warn("[execution-engine] Non-blocking operation failed:" + " " + String(err?.message ?? err)));
				}
				eventBus.emitTransient({
					projectId,
					type: "agent:output",
					agentId: agent.id,
					taskId: task.id,
					payload: { output: `[execution] CLI started: ${adapter.name}` },
				});
				agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
				agentRuntime.appendVirtualOutput(
					projectId,
					agent.id,
					formatTaskLog(`[execution] CLI started: ${adapter.name}`),
				);

				const adapterStartMs = Date.now();
				try {
					cliResult = await adapter.execute({
						projectId,
						taskId: task.id,
						agentId: agent.id,
						agentName: agent.name,
						repoPath: runtimeRepoPath,
						prompt,
						systemPrompt: agent.systemPrompt
							? composeSystemPrompt(agent.systemPrompt)
							: defaultSystemPrompt(agent),
						timeoutMs,
						model: routedModel,
						signal: taskController.signal,
						allowedTools,
						onLog: (line: string) => {
							agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
							agentRuntime.appendVirtualOutput(projectId, agent.id, formatTaskLog(line));
							eventBus.emitTransient({
								projectId,
								type: "agent:output",
								agentId: agent.id,
								taskId: task.id,
								payload: { output: line },
							});
						},
					});
					providerState.markSuccess(adapterName);
					// Telemetry lifecycle: SUCCESS
					if (telemetryRecord) {
						finishProviderTelemetry(this.telemetry, telemetryRecord, {
							provider: adapterName,
							model: routedModel,
							text: cliResult.text,
							filesCreated: cliResult.filesCreated,
							filesModified: cliResult.filesModified,
							logs: cliResult.logs,
							startedAt: telemetryRecord.startedAt,
							completedAt: new Date().toISOString(),
						metadata: { durationMs: cliResult.durationMs, isColdStart },
					});
					}
					break; // success — exit chain
				} catch (adapterErr) {
					lastAdapterError = adapterErr instanceof Error ? adapterErr : new Error(String(adapterErr));
					const errMsg = lastAdapterError.message;
					const latencyMs = Date.now() - adapterStartMs;
					const { classification, reason } = classifyProviderErrorWithReason(adapterErr);
					lastFailureProvider = adapter.name;
					lastFailureClassification = classification;
					if (isRateLimitError(errMsg)) {
						log.warn(`[execution] Rate limit on adapter "${adapter.name}" — marking cooldown.`);
						providerState.markRateLimited(adapterName);
					} else {
						providerState.markFailure(adapterName, classification);
					}
					log.warn(`[execution] Adapter "${adapter.name}" failed (${classification}, reason=${reason}): ${errMsg.slice(0, 200)}`);

					// Advance to next candidate and record fallback telemetry
					const nextAdapter = await resolver.next({ allowedTools, lastFailureProvider: adapter.name, lastFailureClassification: classification });
					if (nextAdapter && telemetryRecord) {
						recordProviderFallback(
							this.telemetry,
							telemetryRecord,
							adapterName,
							nextAdapter.name,
							reason,
							latencyMs,
							adapterErr,
						);
					}
					adapter = nextAdapter;
				}
			}

			if (cliResult === null) {
				// Graceful degraded mode: if all providers are exhausted, defer the task
				// instead of failing it. Reset to queued and schedule a retry.
				if (providerState.isAllExhausted()) {
					const retryMs = providerState.getEarliestRecoveryMs();
					log.warn(
						`[execution-engine] All providers exhausted — deferring "${task.title}" for ${Math.round(retryMs / 1000)}s`,
					);
					// Telemetry lifecycle: DEGRADED
					if (telemetryRecord) {
						recordProviderDegraded(
							this.telemetry,
							telemetryRecord,
							`All providers exhausted for task "${task.title}". Retry in ${Math.round(retryMs / 1000)}s.`,
						);
						finishProviderTelemetry(this.telemetry, telemetryRecord, null, lastAdapterError ?? new Error("All providers exhausted"));
					}
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
								this.executeTask(projectId, t).catch((err) => log.warn("[execution-engine] Non-blocking operation failed:" + " " + String(err?.message ?? err)));
							}
						});
					}, retryMs + 1000);
					return;
				}
				// Telemetry lifecycle: ERROR (all adapters failed, not exhausted)
				if (telemetryRecord) {
					finishProviderTelemetry(this.telemetry, telemetryRecord, null, lastAdapterError ?? new Error("All CLI adapters exhausted"));
				}
				throw lastAdapterError ?? new Error("All CLI adapters exhausted — no provider available.");
			}

			const output: TaskOutput = {
				filesCreated: resolveFilePaths(cliResult.filesCreated, runtimeRepoPath),
				filesModified: resolveFilePaths(cliResult.filesModified, runtimeRepoPath),
				logs: cliResult.logs,
			};

			// Session step: CLI output received
			if (sessionId) {
				const fileCount = (output.filesCreated?.length ?? 0) + (output.filesModified?.length ?? 0);
				recordStep(sessionId, { step: 2, type: "result_inspected", summary: `Output received: ${fileCount} files (${output.filesCreated?.length ?? 0} created, ${output.filesModified?.length ?? 0} modified)` }).catch((err) => log.warn("[execution-engine] Non-blocking operation failed:" + " " + String(err?.message ?? err)));
			}

			if (isolatedWorkspace?.isolated) {
				const synced = await isolatedWorkspace.writeBack([
					...(output.filesCreated ?? []),
					...(output.filesModified ?? []),
				]);
				output.filesCreated = output.filesCreated.filter((file) => synced.includes(file));
				output.filesModified = output.filesModified.filter((file) => synced.includes(file));
			}

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
					log.warn(`[execution-engine] Budget exceeded — completing "${task.title}" but pausing pipeline`);
				}
			}

			eventBus.emitTransient({
				projectId,
				type: "agent:output",
				agentId: agent.id,
				taskId: task.id,
				payload: { output: `[execution] Mode: cli` },
			});
			agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
			agentRuntime.appendVirtualOutput(projectId, agent.id, formatTaskLog("[execution] Mode: cli"));

			// --- ESLint/Prettier enforcement: auto-fix generated files ---
			const allFiles = [...(output.filesCreated ?? []), ...(output.filesModified ?? [])];
			if (allFiles.length > 0 && project.repoPath) {
				try {
					const termLog = (msg: string) => {
						agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
						agentRuntime.appendVirtualOutput(projectId, agent.id, formatTaskLog(msg));
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
					log.warn({ err: lintErr }, "Lint/format failed (non-blocking)");
				}
			}

			// --- Auto-documentation: update docs based on agent role ---
			try {
				await updateDocsAfterTask(project, { ...task, output }, agent, (msg) => {
					agentRuntime.ensureVirtualProcess(projectId, agent.id, agent.name);
					agentRuntime.appendVirtualOutput(projectId, agent.id, formatTaskLog(msg));
				});
			} catch (docErr) {
				log.warn({ err: docErr }, "Docs update failed (non-blocking)");
			}

			// Agent output buffer'ını log dosyasına persist et (restart sonrası terminal'de görünsün)
			const agentOutputLines = agentRuntime.getAgentOutput(projectId, agent.id);
			if (agentOutputLines.length > 0) {
				persistAgentLog(projectId, agent.id, agentOutputLines).catch((err) => log.warn("[execution-engine] Non-blocking operation failed:" + " " + String(err?.message ?? err)));
			}

			// --- Sandbox post-execution: enforce path + output size restrictions ---
			if (sandboxPolicy && sandboxPolicy.enforcementMode !== "off") {
				const allPaths = [
					...(output.filesCreated ?? []),
					...(output.filesModified ?? []),
				];
				if (allPaths.length > 0) {
					await enforcePathChecks(sandboxPolicy, allPaths, sandboxSessionId);
				}
				const outputSizeEstimate = JSON.stringify(output).length;
				await enforceOutputSizeCheck(sandboxPolicy, outputSizeEstimate, sandboxSessionId);
			}

			// --- v8.0: Process structured proposals (delegated to proposal-processor.ts) ---
			if (cliResult?.proposals && cliResult.proposals.length > 0) {
				try {
					await processAgentProposals(projectId, task, agent, cliResult.proposals);
				} catch (err) {
					log.warn("[execution-engine] Proposal processing failed (non-blocking):" + " " + String(err));
				}
			}

			// --- Output verification + test gates (delegated to execution-gates.ts) ---
			if (project.repoPath) {
				const verifyResult = await runVerificationGate(projectId, task, project.repoPath, output, agent.id, sessionId);
				if (!verifyResult.passed) {
					throw new Error(`Output verification failed: ${verifyResult.failedChecks}`);
				}

				const testResult = await runTestGateCheck(projectId, task, project.repoPath, output, agent.role, agent.id, sessionId);
				if (!testResult.passed) {
					throw new Error(testResult.failedChecks!);
				}
			}

			await taskEngine.completeTask(task.id, output, { executionRepoPath: runtimeRepoPath });

			// --- Sandbox: end session ---
			if (sandboxSessionId) {
				endSandboxSession(sandboxSessionId).catch((e) => log.warn("[execution-engine] Sandbox end failed:" + " " + String(e)));
			}
			if (isolatedWorkspace?.isolated) {
				isolatedWorkspace.cleanup().catch((e) => log.warn("[execution-engine] Workspace cleanup failed:" + " " + String(e)));
			}

			// --- Goal evaluation (delegated to execution-gates.ts) ---
			if (goalId) {
				try {
					await runGoalEvaluation(task.id, task.title, output, projectId);
				} catch (e) {
					if (e instanceof Error && e.message.startsWith("Goal validation failed")) throw e;
					log.warn({ err: e }, "Goal evaluation failed (non-blocking)");
				}
			}

			// --- Agent Runtime: record successful session ---
			if (sessionId) {
				completeSession(sessionId, projectId, agent.id, agent.role, task, {
					costUsd: cliResult?.totalCostUsd,
				}).catch((e) => log.warn("[execution-engine] Session complete failed:" + " " + String(e)));
			}

			// Review task dispatch: task-engine creates a review task which
			// will be picked up by dispatchReadyTasks below.
		} catch (err) {
			// Telemetry lifecycle: OUTER ERROR (sandbox, verification, etc.)
			if (telemetryRecord && !telemetryRecord.completedAt) {
				finishProviderTelemetry(this.telemetry, telemetryRecord, null, err);
			}

			// If task was aborted by pipeline pause, don't mark as failed — cancelRunningTasks
			// already reset it to queued. Just bail out silently.
			if (taskController.signal.aborted) {
				log.info(`[execution-engine] Task "${task.title}" aborted (pipeline paused)`);
				return;
			}

			// --- Sandbox violation: emit specific event for observability ---
			if (err instanceof SandboxViolationError) {
				eventBus.emit({
					projectId,
					type: "verification:failed",
					agentId: agent.id,
					taskId: task.id,
					payload: {
						source: "sandbox",
						violationType: err.violation.type,
						detail: err.violation.detail,
						enforcementMode: sandboxPolicy?.enforcementMode ?? "hard",
						taskTitle: task.title,
					},
				});
			}

			const isTimeout = err instanceof TaskTimeoutError;
			const errorMsg = err instanceof Error ? err.message : String(err);
			log.error(`[execution-engine] Task failed: "${task.title}" — ${errorMsg}`);

			// --- Rate-limit guard: pause pipeline instead of failing the task ---
			if (isRateLimitError(errorMsg)) {
				log.warn(`[execution-engine] Rate limit detected — pausing pipeline for ${projectId}`);

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
					log.error({ err: pauseErr }, "Failed to pause pipeline after rate limit");
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
				persistAgentLog(projectId, agent.id, failOutputLines).catch((err) => log.warn("[execution-engine] Non-blocking operation failed:" + " " + String(err?.message ?? err)));
			}

			await taskEngine.failTask(task.id, errorMsg);

			// --- Agent Runtime: record failed session ---
			if (sessionId) {
				failSession(sessionId, projectId, agent.id, agent.role, task, errorMsg).catch((e) =>
					log.warn("[execution-engine] Session fail record failed:" + " " + String(e)),
				);
			}
			if (isolatedWorkspace?.isolated) {
				isolatedWorkspace.cleanup().catch((e) => log.warn("[execution-engine] Workspace cleanup failed:" + " " + String(e)));
			}

			// --- Self-healing: auto-retry with error context (TASK 10) ---
			const failedTask = await getTask(task.id);
			const failureClass = lastFailureClassification ?? "unknown";
			const { shouldRetry, delayMs } = evaluateRetry(failureClass, failedTask?.retryCount ?? 0);

			if (!isTimeout && shouldRetry && failedTask) {
				log.info(`[execution-engine] Self-healing: auto-retry #${failedTask.retryCount + 1} for "${task.title}" after ${delayMs}ms`);
				eventBus.emit({
					projectId,
					type: "task:transient_failure",
					agentId: agent.id,
					taskId: task.id,
					payload: {
						error: errorMsg.slice(0, 500),
						retryCount: failedTask.retryCount + 1,
						maxRetries: MAX_AUTO_RETRIES,
						backoffMs: delayMs,
						classification: failureClass,
					},
				});
				eventBus.emitTransient({
					projectId,
					type: "agent:output",
					agentId: agent.id,
					taskId: task.id,
					payload: {
						output: `[self-heal] Retry #${failedTask.retryCount + 1} (${failureClass}) after ${delayMs}ms: ${errorMsg.slice(0, 200)}`,
					},
				});

				// Exponential backoff before retry
				if (delayMs > 0) {
					await new Promise((r) => setTimeout(r, delayMs));
				}

				const retried = await taskEngine.retryTask(task.id);
				// Re-execute with error context — bypass guard since we're retrying within the same dispatch
				await this._executeTaskInner(projectId, { ...retried, error: errorMsg });
				return; // skip dispatchReadyTasks — executeTask will handle it
			}
		}

		// Replan trigger: if 3+ tasks failed in this phase, consider replanning
		{
			const currentTask = await getTask(task.id);
			if (currentTask?.status === "failed") {
				const failCountRow = await pgQueryOne<{ cnt: number }>(
					`SELECT COUNT(*) AS cnt FROM tasks WHERE phase_id = $1 AND status = 'failed'`,
					[task.phaseId],
				);
				const phaseFailures = Number(failCountRow?.cnt ?? 0);
				if (phaseFailures >= 3) {
					evaluateReplan({ projectId, trigger: "repeated_review_failure", phaseId: task.phaseId }).catch((err) =>
						log.warn("[execution-engine] Replan trigger failed (non-blocking):" + " " + String(err)),
					);
				}
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

			await taskEngine.completeTask(task.id, output, { executionRepoPath: project.repoPath });
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			log.error(`[execution-engine] Special task failed: "${task.title}" — ${errorMsg}`);
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

	/**
	 * After a task in `phaseId` has been settled, check for tasks whose
	 * dependencies are now satisfied and dispatch them in parallel.
	 */
	private async dispatchReadyTasks(projectId: string, phaseId: string): Promise<void> {
		const project = await getProject(projectId);
		if (!project || project.status === "failed") return;
		const pipelineRun = await getPipelineRun(projectId);
		// Paused / failed: do not auto-dispatch. "completed" is ignored here: a mis-built pipeline
		// can mark completed while task rows are still queued — we must keep dispatching ready work.
		if (pipelineRun && (pipelineRun.status === "paused" || pipelineRun.status === "failed")) return;

		const phaseFailed = await taskEngine.isPhaseFailed(phaseId);
		const ready = await taskEngine.getReadyTasks(phaseId);
		if (ready.length === 0) return;

		// If phase has failed tasks, only dispatch review tasks (to complete in-progress work)
		const toDispatch = phaseFailed ? ready.filter((t) => t.title.startsWith("Code Review: ")) : ready;
		if (toDispatch.length === 0) return;

		// TASK 9: Fair scheduling — short tasks first to prevent head-of-line blocking
		const fairOrder = sortTasksByFairness(toDispatch);

		// Execute tasks sequentially to avoid rate-limit issues with AI providers
		for (const task of fairOrder) {
			await this.executeTask(projectId, task);
		}
	}

	// -------------------------------------------------------------------------
	// Output parsing
	// -------------------------------------------------------------------------

	// parseTaskOutput, executeReviewTask, resolveAgent → extracted to review-dispatcher.ts

	// -------------------------------------------------------------------------
	// Execution status
	// -------------------------------------------------------------------------

	/**
	 * Transition a task from "queued" or "assigned" to "running" and return the
	 * updated task record. This is the single point where queue-wait timestamps
	 * are produced.
	 */
	private async _startTaskForExecution(
		task: import("./types.js").Task,
		agentId: string,
	): Promise<import("./types.js").Task | undefined> {
		const currentTask = await getTask(task.id);
		const currentStatus = currentTask?.status ?? task.status;
		let startedTask: import("./types.js").Task | undefined;

		if (currentStatus === "queued") {
			await taskEngine.assignTask(task.id, agentId);
			startedTask = await taskEngine.startTask(task.id);
		} else if (currentStatus === "assigned") {
			startedTask = await taskEngine.startTask(task.id);
		}
		// status === "running" → already started (e.g. revision restart), return undefined
		return startedTask;
	}

	/**
	 * Return a snapshot of currently running tasks and active containers for a
	 * project. Used by the GET /projects/:id/execution/status endpoint.
	 */
	async getExecutionStatus(projectId: string) {
		const progress = await taskEngine.getProgress(projectId);

		return {
			projectId,
			runtimes: [],
			progress,
			concurrency: {
				active: this._semaphore.activeCount,
				pending: this._semaphore.pendingCount,
				max: this._semaphore.maxConcurrency,
			},
		};
	}
}

export const executionEngine = new ExecutionEngine();

function isDeadlockError(err: unknown): boolean {
	if (!err) return false;
	if (typeof err === "object" && "code" in err && (err as { code?: string }).code === "40P01") {
		return true;
	}
	const message = err instanceof Error ? err.message : String(err);
	return message.toLowerCase().includes("deadlock detected");
}

async function runStartupRecoveryWithRetry(maxAttempts = 3): Promise<void> {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			await executionEngine.recoverStuckTasks();
			if (attempt > 1) {
				log.info(`[execution-engine] Startup recovery succeeded on retry #${attempt}`);
			}
			return;
		} catch (err) {
			if (!isDeadlockError(err) || attempt === maxAttempts) {
				throw err;
			}
			const backoffMs = attempt * 750;
			log.warn(
				`[execution-engine] Startup recovery deadlock (attempt ${attempt}/${maxAttempts}), retrying in ${backoffMs}ms`,
			);
			await new Promise((resolve) => setTimeout(resolve, backoffMs));
		}
	}
}

// Uygulama başlangıcında yarıda kalmış görevleri kurtart
if (process.env.VITEST !== "true") {
	runStartupRecoveryWithRetry().catch((err) => {
		log.error("[execution-engine] Startup recovery failed:" + " " + String(err));
	});
}
