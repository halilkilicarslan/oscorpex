// ---------------------------------------------------------------------------
// Oscorpex — Phase Progress Tracker
// Phase lifecycle: advance, completion detection, readiness, progress summary.
// ---------------------------------------------------------------------------

import {
	getLatestPlan,
	getTasksByIds,
	listTasks,
	updatePhaseStatus,
	updateProject,
} from "./db.js";
import { eventBus } from "./event-bus.js";
import { createLogger } from "./logger.js";
import type { Phase, Task } from "./types.js";

const log = createLogger("phase-progress-tracker");

export type StartPhaseCallback = (projectId: string, phaseId: string) => Promise<Task[]>;

export class PhaseProgressTracker {
	// -------------------------------------------------------------------------
	// Dependency resolution
	// -------------------------------------------------------------------------

	async getReadyTasks(phaseId: string): Promise<Task[]> {
		const tasks = await listTasks(phaseId);
		const queued = tasks.filter((t) => t.status === "queued");
		if (queued.length === 0) return [];

		// Batch-fetch all dependency tasks in a single query (eliminates N+1)
		const allDepIds = new Set(queued.flatMap((t) => t.dependsOn));
		const depMap = allDepIds.size > 0 ? await getTasksByIds([...allDepIds]) : new Map<string, Task>();

		const ready: Task[] = [];
		for (const task of queued) {
			if (task.dependsOn.length === 0) {
				ready.push(task);
				continue;
			}

			const isReviewTask = task.title.startsWith("Code Review: ");

			// Review tasks can start when original task is in 'review' status
			const allDepsDone = task.dependsOn.every((depId) => {
				const dep = depMap.get(depId);
				return dep?.status === "done" || (isReviewTask && dep?.status === "review");
			});
			if (allDepsDone) ready.push(task);
		}
		return ready;
	}

	async isPhaseComplete(phaseId: string): Promise<boolean> {
		const tasks = await listTasks(phaseId);
		if (tasks.length === 0) return false;
		return tasks.every((t) => t.status === "done");
	}

	async isPhaseFailed(phaseId: string): Promise<boolean> {
		const tasks = await listTasks(phaseId);
		return tasks.some((t) => t.status === "failed");
	}

	// -------------------------------------------------------------------------
	// Phase progression
	// -------------------------------------------------------------------------

	async startPhase(projectId: string, phaseId: string): Promise<Task[]> {
		await updatePhaseStatus(phaseId, "running");

		eventBus.emit({
			projectId,
			type: "phase:started",
			payload: { phaseId },
		});

		return this.getReadyTasks(phaseId);
	}

	async getNextPhase(projectId: string): Promise<Phase | null> {
		const plan = await getLatestPlan(projectId);
		if (!plan || plan.status !== "approved") return null;

		for (const phase of plan.phases) {
			if (phase.status === "pending") {
				const depsComplete = phase.dependsOn.every((depId) => {
					const depPhase = plan.phases.find((p) => p.id === depId);
					return depPhase?.status === "completed";
				});
				if (depsComplete) return phase;
			}
		}

		return null;
	}

	async isProjectComplete(projectId: string): Promise<boolean> {
		const plan = await getLatestPlan(projectId);
		if (!plan) return false;
		return plan.phases.every((p) => p.status === "completed");
	}

	// -------------------------------------------------------------------------
	// Auto-advance
	// -------------------------------------------------------------------------

	async checkAndAdvancePhase(phaseId: string, projectId: string): Promise<void> {
		if (!(await this.isPhaseComplete(phaseId))) return;

		await updatePhaseStatus(phaseId, "completed");

		eventBus.emit({
			projectId,
			type: "phase:completed",
			payload: { phaseId },
		});

		const nextPhase = await this.getNextPhase(projectId);
		if (nextPhase) {
			await this.startPhase(projectId, nextPhase.id);
		} else if (await this.isProjectComplete(projectId)) {
			await updateProject(projectId, { status: "completed" });
		}
	}

	// -------------------------------------------------------------------------
	// Progress summary
	// -------------------------------------------------------------------------

	async getProgress(projectId: string) {
		const plan = await getLatestPlan(projectId);
		if (!plan) {
			return {
				phases: [],
				overall: { total: 0, done: 0, running: 0, failed: 0, queued: 0, review: 0, revision: 0, waitingApproval: 0 },
			};
		}

		let total = 0;
		let done = 0;
		let running = 0;
		let failed = 0;
		let queued = 0;
		let review = 0;
		let revision = 0;
		let waitingApproval = 0;

		const phases = plan.phases.map((phase) => {
			const tasks = phase.tasks;
			const tasksDone = tasks.filter((t) => t.status === "done").length;
			total += tasks.length;
			done += tasksDone;
			running += tasks.filter((t) => t.status === "running").length;
			failed += tasks.filter((t) => t.status === "failed").length;
			queued += tasks.filter((t) => t.status === "queued" || t.status === "assigned").length;
			review += tasks.filter((t) => t.status === "review").length;
			revision += tasks.filter((t) => t.status === "revision").length;
			// Human-in-the-Loop: Onay bekleyen task sayısını takip et
			waitingApproval += tasks.filter((t) => t.status === "waiting_approval").length;

			return {
				id: phase.id,
				name: phase.name,
				status: phase.status,
				tasksDone,
				tasksTotal: tasks.length,
			};
		});

		return { phases, overall: { total, done, running, failed, queued, review, revision, waitingApproval } };
	}
}

// Singleton export for consumers that bypass the facade (rare internal use)
export const phaseProgressTracker = new PhaseProgressTracker();
