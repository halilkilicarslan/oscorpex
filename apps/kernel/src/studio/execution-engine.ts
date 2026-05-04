// ---------------------------------------------------------------------------
// Oscorpex — Execution Engine (Facade)
// Thin orchestrator that wires TaskExecutor, TaskDispatcher, and
// ExecutionRecovery into a single public surface.
// ---------------------------------------------------------------------------

import { ProviderTelemetryCollector } from "@oscorpex/provider-sdk";
import { AdaptiveConcurrencyController, AdaptiveSemaphore, ConcurrencyTracker } from "./adaptive-concurrency.js";
import { claimTask, releaseTaskClaim } from "./db.js";
import { createLogger } from "./logger.js";
import { TaskDispatcher } from "./execution/dispatch-coordinator.js";
import { ExecutionRecovery, runStartupRecoveryWithRetry } from "./execution/execution-recovery.js";
import { ExecutionWatchdog } from "./execution/execution-watchdog.js";
import { TaskExecutor } from "./execution/task-executor.js";
import { taskEngine } from "./task-engine.js";
import type { Task } from "./types.js";

// Re-export helpers consumed by other modules
export { computeQueueWaitMs } from "./execution/queue-wait.js";

const log = createLogger("execution-engine");

// ---------------------------------------------------------------------------
// Execution Engine
// ---------------------------------------------------------------------------

class ExecutionEngine {
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

	// Sub-modules
	private executor: TaskExecutor;
	private dispatcher: TaskDispatcher;
	private recovery: ExecutionRecovery;
	private watchdog: ExecutionWatchdog;

	constructor() {
		// Ready-task dispatch is handled explicitly at the end of task execution.
		// Avoiding an onTaskCompleted callback here prevents duplicate dispatch
		// races with the inline dispatch path.

		// TASK 15: Log active performance configuration at startup
		import("./performance-config.js")
			.then(({ logPerformanceConfig }) => {
				logPerformanceConfig();
			})
			.catch(() => {
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

		// Wire sub-modules (must happen after fields are initialised)
		this.executor = new TaskExecutor(this._activeControllers, this.telemetry);
		this.dispatcher = new TaskDispatcher(
			this._semaphore,
			(projectId, task) => this.executeTask(projectId, task),
		);
		this.recovery = new ExecutionRecovery(
			this._activeControllers,
			this.dispatcher.dispatchingTasks,
			(projectId, task) => this.executeTask(projectId, task),
			(projectId) => this.startProjectExecution(projectId),
		);

		this.watchdog = new ExecutionWatchdog(() => this.dispatcher.runDispatchWatchdog());
		this.watchdog.start();
	}

	// -------------------------------------------------------------------------
	// Public API — delegates to sub-modules
	// -------------------------------------------------------------------------

	/**
	 * Consolidated query: fetch all running projects with their active phase IDs.
	 */
	async getRunningProjectPhases(): Promise<Array<{ projectId: string; phaseId: string }>> {
		return this.dispatcher.getRunningProjectPhases();
	}

	/**
	 * Begin execution for a project.
	 */
	async startProjectExecution(projectId: string): Promise<void> {
		return this.dispatcher.startProjectExecution(projectId);
	}

	/**
	 * Cancel all running tasks for a project.
	 */
	async cancelRunningTasks(projectId: string): Promise<number> {
		return this.recovery.cancelRunningTasks(projectId);
	}

	/**
	 * Recover tasks stuck in "running" state after a restart.
	 */
	async recoverStuckTasks(): Promise<void> {
		return this.recovery.recoverStuckTasks();
	}

	/**
	 * After a task in `phaseId` has been settled, check for tasks whose
	 * dependencies are now satisfied and dispatch them.
	 */
	async dispatchReadyTasks(projectId: string, phaseId: string): Promise<void> {
		return this.dispatcher.dispatchReadyTasks(projectId, phaseId);
	}

	/**
	 * Return a snapshot of currently running tasks and active containers for a
	 * project. Used by the GET /projects/:id/execution/status endpoint.
	 */
	async getExecutionStatus(projectId: string) {
		const progress = await taskEngine().getProgress(projectId);

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

	// -------------------------------------------------------------------------
	// Single task execution (semaphore + claim wrapper)
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
		if (this.dispatcher.dispatchingTasks.has(task.id)) {
			// Self-heal: stale in-memory dispatch marker can survive abnormal flows
			// (e.g. restart/recovery overlap) while no active controller exists.
			const controllerKey = `${projectId}:${task.id}`;
			if (!this._activeControllers.has(controllerKey)) {
				this.dispatcher.dispatchingTasks.delete(task.id);
				log.warn(`[execution-engine] Cleared stale dispatch marker for task "${task.title}"`);
			} else {
				log.info(`[execution-engine] Task "${task.title}" zaten dispatch ediliyor, skip.`);
				return;
			}
		}

		this.dispatcher.dispatchingTasks.add(task.id);
		await this._semaphore.acquire();
		let claimedTaskId: string | null = null;
		try {
			// IMPORTANT: claim only after acquiring a concurrency slot.
			// Otherwise tasks can remain queued+claimed while waiting on semaphore.
			const freshTask = await claimTask(task.id, this._workerId);
			if (!freshTask) {
				log.info(`[execution-engine] Task "${task.title}" could not be claimed (already taken or not queued), skip.`);
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
					log.warn(
						`[execution-engine] Task "${freshTask.title}" blocked by constraints (${riskLevel} risk — requires approval)`,
					);
					await import("./db.js").then((m) =>
						m.updateTask(freshTask.id, { status: "waiting_approval", requiresApproval: true }),
					);
					await releaseTaskClaim(freshTask.id);
					claimedTaskId = null;
					const { eventBus } = await import("./event-bus.js");
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
							await import("./db.js").then((m) => m.updateTask(freshTask.id, { status: "running" }));
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

			await this.executor.executeTaskInner(
				projectId,
				freshTask,
				(pid, t) => this.executeTask(pid, t),
				(pid, phaseId) => this.dispatchReadyTasks(pid, phaseId),
			);
		} finally {
			this._semaphore.release();
			this.dispatcher.dispatchingTasks.delete(task.id);
			this._activeControllers.delete(`${projectId}:${task.id}`);
			if (claimedTaskId) {
				await releaseTaskClaim(claimedTaskId);
			}
		}

		// Replan trigger + dispatch ready tasks happen after the task settles
		await this.dispatcher.maybeEvaluateReplan(projectId, task);
		await this.dispatcher.dispatchAfterTaskSettled(projectId, task);
	}
}

// ---------------------------------------------------------------------------
// Factory — lazy singleton accessed via executionEngine()
// ---------------------------------------------------------------------------

let _instance: ExecutionEngine | null = null;

export function executionEngine(): ExecutionEngine {
	if (!_instance) throw new Error("ExecutionEngine not initialized — call initExecutionEngine() first");
	return _instance;
}

export function initExecutionEngine(): ExecutionEngine {
	if (_instance) return _instance;
	_instance = new ExecutionEngine();
	return _instance;
}

// Re-export for callers that need to drive startup recovery from outside.
export { runStartupRecoveryWithRetry };
