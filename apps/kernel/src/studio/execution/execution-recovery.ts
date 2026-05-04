// ---------------------------------------------------------------------------
// Oscorpex — Execution Recovery
// Handles startup recovery for stuck tasks and cancellation of running tasks.
// ---------------------------------------------------------------------------

import { agentRuntime } from "../agent-runtime.js";
import { stopApp } from "../app-runner.js";
import {
	getRunningProjectsWithPlans,
	getTask,
	listProjectTasks,
	releaseTaskClaim,
	updatePhaseStatus,
	updateTask,
} from "../db.js";
import { createLogger } from "../logger.js";
import { taskEngine } from "../task-engine.js";
import type { Task } from "../types.js";

const log = createLogger("execution-recovery");

export class ExecutionRecovery {
	constructor(
		private readonly _activeControllers: Map<string, AbortController>,
		private readonly _dispatchingTasks: Set<string>,
		private readonly _executeTask: (projectId: string, task: Task) => Promise<void>,
		private readonly _startProjectExecution: (projectId: string) => Promise<void>,
	) {}

	/**
	 * Backend restart sonrası çalışır. Tüm projelerdeki "running" durumundaki
	 * task'ları "queued" durumuna geri alır ve ilgili projelerin execution'ını
	 * yeniden başlatır. Bu sayede yarıda kalmış görevler yeniden çalıştırılır.
	 */
	async recoverStuckTasks(): Promise<void> {
		// Single query replaces the previous N+1 pattern (getLatestPlan + listPhases
		// per project).  With 50 running projects that was 100+ round-trips; now it
		// is exactly one.
		const runningProjects = await getRunningProjectsWithPlans();
		for (const { project, plan, phases } of runningProjects) {

			if (!plan || plan.status !== "approved") continue;

			let hasRecovered = false;

			for (const phase of phases) {
				if (phase.status !== "running" && phase.status !== "failed") continue;
				let phaseRecovered = false;
				for (const task of phase.tasks ?? []) {
					if (task.status === "running" || task.status === "assigned") {
						await updateTask(task.id, { status: "queued", startedAt: null as unknown as string });
						await releaseTaskClaim(task.id);
						log.info(`[execution-recovery] Recovery: "${task.title}" → queued (was ${task.status})`);
						phaseRecovered = true;
					}
				}
				if (phaseRecovered && phase.status === "failed") {
					await updatePhaseStatus(phase.id, "running");
					log.info(`[execution-recovery] Recovery: phase "${phase.name}" → running (was failed)`);
				}
				hasRecovered = hasRecovered || phaseRecovered;
			}

			if (hasRecovered) {
				log.info(`[execution-recovery] Recovering project "${project.name}" — restarting execution`);
				this._startProjectExecution(project.id).catch((err) => {
					log.error(`[execution-recovery] Recovery failed for "${project.name}":` + " " + String(err));
				});
			}

			// Restart revision tasks that were left in 'revision' status
			for (const phase of phases) {
				if (phase.status !== "running" && phase.status !== "completed") continue;
				for (const task of phase.tasks ?? []) {
					if (task.status === "revision") {
						log.info(`[execution-recovery] Recovery: restarting revision "${task.title}"`);
						try {
							await taskEngine.restartRevision(task.id);
							const fresh = await getTask(task.id);
							if (fresh) {
								this._executeTask(project.id, fresh).catch((err) =>
									log.warn("[execution-recovery] Non-blocking operation failed:" + " " + String(err?.message ?? err)),
								);
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
						`[execution-recovery] Recovery: ${ready.length} orphaned ready task(s) in phase "${phase.name}" — dispatching`,
					);
					Promise.allSettled(ready.map((task: Task) => this._executeTask(project.id, task))).catch((err) =>
						log.warn("[execution-recovery] Non-blocking operation failed:" + " " + String(err?.message ?? err)),
					);
				}

				// Recover orphaned running tasks — stuck in "running" with no active CLI process
				// These arise when revision re-execution fails silently (fire-and-forget .catch)
				for (const task of phase.tasks ?? []) {
					if (
						task.status === "running" &&
						!this._dispatchingTasks.has(task.id) &&
						!this._activeControllers.has(`${project.id}:${task.id}`)
					) {
						log.info(`[execution-recovery] Recovery: orphaned running task "${task.title}" → queued`);
						await updateTask(task.id, { status: "queued", startedAt: null as unknown as string });
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
						Promise.allSettled(ready.map((task: Task) => this._executeTask(project.id, task))).catch((err) =>
							log.warn("[execution-recovery] Non-blocking operation failed:" + " " + String(err?.message ?? err)),
						);
					}
				}
			}
		}
	}

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
					await updateTask(task.id, { status: "queued", startedAt: null as unknown as string });
					log.info(`[execution-recovery] Task "${task.title}" → queued (pipeline paused)`);
				} catch (err) {
					log.warn(`[execution-recovery] Task reset failed: ${task.id}` + " " + String(err));
				}
			}
		}

		if (cancelled > 0) {
			log.info(`[execution-recovery] Cancelled ${cancelled} running task(s) for project ${projectId}`);
		}

		return cancelled;
	}
}

// ---------------------------------------------------------------------------
// isDeadlockError — only used by runStartupRecoveryWithRetry
// ---------------------------------------------------------------------------

function isDeadlockError(err: unknown): boolean {
	if (!err) return false;
	if (typeof err === "object" && "code" in err && (err as { code?: string }).code === "40P01") {
		return true;
	}
	const message = err instanceof Error ? err.message : String(err);
	return message.toLowerCase().includes("deadlock detected");
}

// ---------------------------------------------------------------------------
// runStartupRecoveryWithRetry
// ---------------------------------------------------------------------------

export async function runStartupRecoveryWithRetry(
	recovery: ExecutionRecovery,
	maxAttempts = 3,
): Promise<void> {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			await recovery.recoverStuckTasks();
			if (attempt > 1) {
				log.info(`[execution-recovery] Startup recovery succeeded on retry #${attempt}`);
			}
			return;
		} catch (err) {
			if (!isDeadlockError(err) || attempt === maxAttempts) {
				throw err;
			}
			const backoffMs = attempt * 750;
			log.warn(
				`[execution-recovery] Startup recovery deadlock (attempt ${attempt}/${maxAttempts}), retrying in ${backoffMs}ms`,
			);
			await new Promise((resolve) => setTimeout(resolve, backoffMs));
		}
	}
}
