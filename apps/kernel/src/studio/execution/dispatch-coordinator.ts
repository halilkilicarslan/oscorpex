// ---------------------------------------------------------------------------
// Oscorpex — Task Dispatcher
// Handles project-level task scheduling: starts execution, dispatches ready
// tasks, runs the watchdog, and resolves running project phases.
// ---------------------------------------------------------------------------

import { type AdaptiveSemaphore, type ConcurrencyTracker } from "../adaptive-concurrency.js";
import { evaluateReplan } from "../adaptive-replanner.js";
import {
	getFailedTaskCountInPhase,
	getLatestPlan,
	getPipelineRun,
	getProject,
	getRunningProjectPhases as dbGetRunningProjectPhases,
	listPhases,
	reclaimStaleQueuedClaimsForProject,
} from "../db.js";
import { eventBus } from "../event-bus.js";
import { createLogger } from "../logger.js";
import { taskEngine } from "../task-engine.js";
import { sortTasksByFairness } from "../task-scheduler.js";
import type { Task } from "../types.js";

const log = createLogger("task-dispatcher");

export class TaskDispatcher {
	/** Guard: prevents the same task from being dispatched concurrently */
	private _dispatchingTasks = new Set<string>();
	private _dispatchWatchdogRunning = false;
	private _lastWatchdogKickByProject = new Map<string, number>();

	constructor(
		private readonly _semaphore: AdaptiveSemaphore,
		private readonly _executeTask: (projectId: string, task: Task) => Promise<void>,
	) {}

	/**
	 * Consolidated query: fetch all running projects with their active phase IDs in one shot.
	 * Replaces N+1 pattern of listProjects → getPipelineRun → getLatestPlan → listPhases.
	 */
	async getRunningProjectPhases(): Promise<Array<{ projectId: string; phaseId: string }>> {
		return dbGetRunningProjectPhases();
	}

	get dispatchingTasks(): Set<string> {
		return this._dispatchingTasks;
	}

	async runDispatchWatchdog(): Promise<void> {
		if (this._dispatchWatchdogRunning) return;
		this._dispatchWatchdogRunning = true;
		try {
			// If engine is actively working, watchdog should stay passive.
			if (this._semaphore.activeCount > 0 || this._semaphore.pendingCount > 0) return;

			const projectPhases = await this.getRunningProjectPhases();
			if (projectPhases.length === 0) return;

			// Group phases by project
			const byProject = new Map<string, string[]>();
			for (const { projectId, phaseId } of projectPhases) {
				const phases = byProject.get(projectId) ?? [];
				phases.push(phaseId);
				byProject.set(projectId, phases);
			}

			const now = Date.now();
			for (const [projectId, phaseIds] of byProject) {
				const lastKick = this._lastWatchdogKickByProject.get(projectId) ?? 0;
				// Cooldown to avoid dispatch thrash loops when a project keeps flapping.
				if (now - lastKick < 20_000) continue;

				let hasReadyTask = false;
				for (const phaseId of phaseIds) {
					const readyTasks = await taskEngine.getReadyTasks(phaseId);
					if (readyTasks.length > 0) {
						hasReadyTask = true;
						const sorted = sortTasksByFairness(readyTasks);
						for (const task of sorted) {
							this._executeTask(projectId, task).catch((err) =>
								log.warn(`[task-dispatcher] Non-blocking operation failed: ${err?.message ?? err}`),
							);
						}
					}
				}

				if (hasReadyTask) {
					this._lastWatchdogKickByProject.set(projectId, now);
					log.warn(`[task-dispatcher] Watchdog kick: dispatching ready tasks for project "${projectId}"`);
				}
			}
		} catch (err) {
			log.error(`[task-dispatcher] Dispatch watchdog error: ${String(err)}`);
		} finally {
			this._dispatchWatchdogRunning = false;
		}
	}

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
			await this._executeTask(projectId, task);
		}
	}

	/**
	 * After a task in `phaseId` has been settled, check for tasks whose
	 * dependencies are now satisfied and dispatch them in parallel.
	 */
	async dispatchReadyTasks(projectId: string, phaseId: string): Promise<void> {
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
			await this._executeTask(projectId, task);
		}
	}

	/**
	 * Post-task replan trigger: if 3+ tasks failed in this phase, consider replanning.
	 * Called by ExecutionEngine.executeTask after the task settles.
	 */
	async maybeEvaluateReplan(projectId: string, task: Task): Promise<void> {
		const currentTask = await import("../db.js").then((m) => m.getTask(task.id));
		if (currentTask?.status === "failed") {
			const phaseFailures = await getFailedTaskCountInPhase(task.phaseId);
			if (phaseFailures >= 3) {
				evaluateReplan({ projectId, trigger: "repeated_review_failure", phaseId: task.phaseId }).catch((err) =>
					log.warn("[task-dispatcher] Replan trigger failed (non-blocking):" + " " + String(err)),
				);
			}
		}
	}

	/**
	 * After a task settles, dispatch any ready tasks in the current phase
	 * and any newly started phases.
	 */
	async dispatchAfterTaskSettled(projectId: string, task: Task): Promise<void> {
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
}
