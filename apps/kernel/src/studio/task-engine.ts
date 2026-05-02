// ---------------------------------------------------------------------------
// Oscorpex — Task Engine v2 (facade)
// Slim orchestration facade — delegates to focused sub-modules.
// v2: Review loop, escalation, revision support
// ---------------------------------------------------------------------------

import { getTask } from "./db.js";
import { getProjectIdForTaskViaJoin } from "./db.js";
import { createLogger } from "./logger.js";
import { TaskApprovalManager } from "./task/approval-service.js";
import { PhaseProgressTracker } from "./task/task-progress-service.js";
import { TaskReviewManager } from "./task/review-loop-service.js";
import { TaskLifecycle } from "./task/task-lifecycle-service.js";
import type { Phase, Task, TaskOutput } from "./types.js";

const log = createLogger("task-engine");

type TaskCompletionCallback = (taskId: string, projectId: string) => void;

// Maximum number of task→project mappings to hold in the in-memory LRU cache.
// task→project relationships are immutable so no invalidation is needed.
const PROJECT_ID_CACHE_MAX = 500;

class TaskEngine {
	private completionCallbacks: Set<TaskCompletionCallback> = new Set();
	private _projectIdCache: Map<string, string> = new Map();

	private approval: TaskApprovalManager;
	private review: TaskReviewManager;
	private progress: PhaseProgressTracker;
	private lifecycle: TaskLifecycle;

	constructor() {
		// Wire sub-modules — callbacks break circular dependencies at construction time
		this.approval = new TaskApprovalManager(this._getProjectIdForTask.bind(this));

		this.review = new TaskReviewManager(
			this._notifyCompleted.bind(this),
			(phaseId, projectId) => this.progress.checkAndAdvancePhase(phaseId, projectId),
		);

		this.progress = new PhaseProgressTracker();

		this.lifecycle = new TaskLifecycle(
			this._getProjectIdForTask.bind(this),
			this._notifyCompleted.bind(this),
			this._requireTask.bind(this),
			this.approval,
			this.review,
			this.progress,
		);
	}

	// -------------------------------------------------------------------------
	// Callback registration (pipeline engine hook point)
	// -------------------------------------------------------------------------

	onTaskCompleted(callback: TaskCompletionCallback): () => void {
		this.completionCallbacks.add(callback);
		return () => {
			this.completionCallbacks.delete(callback);
		};
	}

	private _notifyCompleted(taskId: string, projectId: string): void {
		for (const cb of this.completionCallbacks) {
			try {
				cb(taskId, projectId);
			} catch {
				/* callback hatası pipeline'ı durdurmamalı */
			}
		}
	}

	// -------------------------------------------------------------------------
	// Shared helpers (injected into sub-modules via constructor callbacks)
	// -------------------------------------------------------------------------

	private async _requireTask(taskId: string): Promise<Task> {
		const task = await getTask(taskId);
		if (!task) throw new Error(`Task ${taskId} not found`);
		return task;
	}

	private async _getProjectIdForTask(task: Task): Promise<string> {
		// Fast path 1: already on the task object (populated by createTask v4.2)
		if (task.projectId) {
			this._projectIdCache.set(task.id, task.projectId);
			return task.projectId;
		}

		// Fast path 2: in-memory LRU cache
		const cached = this._projectIdCache.get(task.id);
		if (cached !== undefined) return cached;

		// DB lookup: try direct column first (COALESCE), fall back to JOIN for un-backfilled rows.
		const projectId = (await getProjectIdForTaskViaJoin(task.id)) ?? "";

		// Evict the oldest entry when the cache is full (Map preserves insertion order).
		if (this._projectIdCache.size >= PROJECT_ID_CACHE_MAX) {
			const oldestKey = this._projectIdCache.keys().next().value;
			if (oldestKey !== undefined) this._projectIdCache.delete(oldestKey);
		}
		this._projectIdCache.set(task.id, projectId);

		return projectId;
	}

	// -------------------------------------------------------------------------
	// Task lifecycle — delegated to TaskLifecycle
	// -------------------------------------------------------------------------

	async assignTask(taskId: string, agentId: string): Promise<Task> {
		return this.lifecycle.assignTask(taskId, agentId);
	}

	async startTask(taskId: string): Promise<Task> {
		return this.lifecycle.startTask(taskId);
	}

	async completeTask(taskId: string, output: TaskOutput, options?: { executionRepoPath?: string }): Promise<Task> {
		return this.lifecycle.completeTask(taskId, output, options);
	}

	async failTask(taskId: string, error: string): Promise<Task> {
		return this.lifecycle.failTask(taskId, error);
	}

	async retryTask(taskId: string): Promise<Task> {
		return this.lifecycle.retryTask(taskId);
	}

	async beginExecution(projectId: string): Promise<Task[]> {
		return this.lifecycle.beginExecution(projectId);
	}

	// -------------------------------------------------------------------------
	// Review loop — delegated to TaskReviewManager
	// -------------------------------------------------------------------------

	async submitReview(taskId: string, approved: boolean, feedback?: string): Promise<Task> {
		const task = await this._requireTask(taskId);
		const projectId = await this._getProjectIdForTask(task);
		return this.review.submitReview(taskId, task, projectId, approved, feedback);
	}

	async restartRevision(taskId: string): Promise<Task> {
		const task = await this._requireTask(taskId);
		const projectId = await this._getProjectIdForTask(task);
		return this.review.restartRevision(taskId, task, projectId);
	}

	// -------------------------------------------------------------------------
	// Approval — delegated to TaskApprovalManager
	// -------------------------------------------------------------------------

	async approveTask(taskId: string): Promise<Task> {
		const task = await this._requireTask(taskId);
		return this.approval.approveTask(taskId, task);
	}

	async rejectTask(taskId: string, reason?: string): Promise<Task> {
		const task = await this._requireTask(taskId);
		return this.approval.rejectTask(taskId, task, reason);
	}

	async checkApprovalTimeouts(projectId: string): Promise<{ warned: string[]; expired: string[] }> {
		return this.approval.checkApprovalTimeouts(projectId);
	}

	// -------------------------------------------------------------------------
	// Phase progress — delegated to PhaseProgressTracker
	// -------------------------------------------------------------------------

	async getReadyTasks(phaseId: string): Promise<Task[]> {
		return this.progress.getReadyTasks(phaseId);
	}

	async isPhaseComplete(phaseId: string): Promise<boolean> {
		return this.progress.isPhaseComplete(phaseId);
	}

	async isPhaseFailed(phaseId: string): Promise<boolean> {
		return this.progress.isPhaseFailed(phaseId);
	}

	async startPhase(projectId: string, phaseId: string): Promise<Task[]> {
		return this.progress.startPhase(projectId, phaseId);
	}

	async getNextPhase(projectId: string): Promise<Phase | null> {
		return this.progress.getNextPhase(projectId);
	}

	async isProjectComplete(projectId: string): Promise<boolean> {
		return this.progress.isProjectComplete(projectId);
	}

	async getProgress(projectId: string) {
		return this.progress.getProgress(projectId);
	}
}

export const taskEngine = new TaskEngine();
