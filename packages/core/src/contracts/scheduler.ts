// @oscorpex/core — Scheduler contract
// Interface for claiming and releasing tasks from the work queue.

import type { Task } from "../domain/task.js";

export interface Scheduler {
	getReadyTasks(runId: string): Promise<Task[]>;
	claim(taskId: string, workerId: string): Promise<Task>;
	release(taskId: string, workerId: string): Promise<void>;
}