// ---------------------------------------------------------------------------
// Oscorpex — Task Scheduler Fairness (TASK 9)
// Prevents head-of-line blocking by prioritizing shorter / simpler tasks.
// ---------------------------------------------------------------------------

import type { Task } from "./types.js";

// ---------------------------------------------------------------------------
// Task duration categories
// ---------------------------------------------------------------------------

export type TaskCategory = "short" | "medium" | "long";

const CATEGORY_PRIORITY: Record<TaskCategory, number> = {
	short: 1,
	medium: 2,
	long: 3,
};

const COMPLEXITY_CATEGORY: Record<string, TaskCategory> = {
	S: "short",
	M: "medium",
	L: "long",
	XL: "long",
};

export function getTaskCategory(complexity: string | undefined): TaskCategory {
	return COMPLEXITY_CATEGORY[complexity ?? "S"] ?? "short";
}

// ---------------------------------------------------------------------------
// Fairness sorting
// ---------------------------------------------------------------------------

/**
 * Sorts ready tasks to minimize head-of-line blocking:
 * 1. Short tasks first (lower estimated duration)
 * 2. Lower retry count first (fresh tasks before retries)
 * 3. Older tasks first (FIFO within same category)
 */
export function sortTasksByFairness(tasks: Task[]): Task[] {
	return [...tasks].sort((a, b) => {
		const catA = CATEGORY_PRIORITY[getTaskCategory(a.complexity)];
		const catB = CATEGORY_PRIORITY[getTaskCategory(b.complexity)];
		if (catA !== catB) return catA - catB;

		const retryA = a.retryCount ?? 0;
		const retryB = b.retryCount ?? 0;
		if (retryA !== retryB) return retryA - retryB;

		// Older tasks first (FIFO tiebreaker)
		const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
		const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
		return createdA - createdB;
	});
}

// ---------------------------------------------------------------------------
// Lane-based dispatch grouping
// ---------------------------------------------------------------------------

export interface TaskLane {
	category: TaskCategory;
	tasks: Task[];
}

/**
 * Groups ready tasks into lanes by category.
 * Useful for lane-based scheduling or telemetry.
 */
export function groupTasksByLane(tasks: Task[]): TaskLane[] {
	const groups = new Map<TaskCategory, Task[]>();
	for (const task of tasks) {
		const cat = getTaskCategory(task.complexity);
		const list = groups.get(cat) ?? [];
		list.push(task);
		groups.set(cat, list);
	}
	const lanes: TaskLane[] = [];
	for (const cat of ["short", "medium", "long"] as TaskCategory[]) {
		const list = groups.get(cat);
		if (list) lanes.push({ category: cat, tasks: list });
	}
	return lanes;
}
