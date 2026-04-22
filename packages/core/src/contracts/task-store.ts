// @oscorpex/core — TaskStore contract
// Interface for task persistence and retrieval.

import type { Task, TaskStatus } from "../domain/task.js";

export interface TaskStore {
	create(task: Task): Promise<Task>;
	get(id: string): Promise<Task | null>;
	update(id: string, partial: Partial<Task>): Promise<Task>;
	list(filter: TaskListFilter): Promise<Task[]>;
	claim(id: string, workerId: string): Promise<Task>;
}

export interface TaskListFilter {
	runId?: string;
	projectId?: string;
	status?: TaskStatus | TaskStatus[];
	stageId?: string;
	assignedRole?: string;
	limit?: number;
	offset?: number;
}