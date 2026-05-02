// ---------------------------------------------------------------------------
// Oscorpex — Sub-task Rollup Service
// When all sub-tasks of a parent task complete, automatically completes the
// parent task and advances the phase.
// ---------------------------------------------------------------------------

import { areAllSubTasksDone, getTask, updateTask } from "../db.js";
import { eventBus } from "../event-bus.js";
import { createLogger } from "../logger.js";
import type { Task } from "../types.js";
import type { PhaseProgressTracker } from "./task-progress-service.js";

const log = createLogger("subtask-rollup-service");

export type NotifyCompletedCallback = (taskId: string, projectId: string) => void;

/**
 * Checks whether completing `task` triggers auto-completion of its parent.
 *
 * Algorithm:
 *   1. If task has no parentTaskId → no-op
 *   2. Query areAllSubTasksDone(parentTaskId)
 *   3. If all done and parent is not yet 'done' → mark parent done, emit event,
 *      advance phase, notify pipeline
 *
 * Called synchronously inside markTaskDone (awaited) so phase advancement
 * happens before the calling phase-advance check runs.
 */
export async function checkSubtaskRollup(
	task: Task,
	projectId: string,
	progress: PhaseProgressTracker,
	notifyCompleted: NotifyCompletedCallback,
): Promise<void> {
	if (!task.parentTaskId) return;

	try {
		const allDone = await areAllSubTasksDone(task.parentTaskId);
		if (!allDone) return;

		const parentTask = await getTask(task.parentTaskId);
		if (!parentTask || parentTask.status === "done") return;

		log.info(`[subtask-rollup-service] All sub-tasks done — auto-completing parent "${parentTask.title}"`);

		await updateTask(task.parentTaskId, {
			status: "done",
			completedAt: new Date().toISOString(),
			output: { filesCreated: [], filesModified: [], logs: ["Auto-completed: all sub-tasks done"] },
		});

		eventBus.emit({
			projectId,
			type: "task:completed",
			taskId: task.parentTaskId,
			payload: { title: parentTask.title, autoCompleted: true },
		});

		await progress.checkAndAdvancePhase(parentTask.phaseId, projectId);
		notifyCompleted(task.parentTaskId, projectId);
	} catch (err) {
		log.warn("[subtask-rollup-service] Sub-task rollup check failed:" + " " + String(err));
	}
}
