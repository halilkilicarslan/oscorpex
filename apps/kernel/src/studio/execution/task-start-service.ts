// ---------------------------------------------------------------------------
// Oscorpex — Task Start Service
// Owns queued/assigned → running transitions for execution.
// ---------------------------------------------------------------------------

import { getTask } from "../db.js";
import { taskEngine } from "../task-engine.js";
import type { Task } from "../types.js";

export async function startTaskForExecution(task: Task, agentId: string): Promise<Task | undefined> {
	const currentTask = await getTask(task.id);
	const currentStatus = currentTask?.status ?? task.status;

	if (currentStatus === "queued") {
		await taskEngine.assignTask(task.id, agentId);
		return taskEngine.startTask(task.id);
	}

	if (currentStatus === "assigned") {
		return taskEngine.startTask(task.id);
	}

	// status === "running" -> already started (e.g. revision restart)
	return undefined;
}
