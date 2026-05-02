// ---------------------------------------------------------------------------
// Tests — Task Scheduler Fairness (TASK 9)
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { getTaskCategory, groupTasksByLane, sortTasksByFairness } from "../task-scheduler.js";
import type { Task } from "../types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "t-1",
		phaseId: "p-1",
		title: "Test task",
		description: "Do something",
		assignedAgent: "backend",
		status: "queued",
		complexity: "M",
		dependsOn: [],
		branch: "feat/x",
		retryCount: 0,
		revisionCount: 0,
		requiresApproval: false,
		createdAt: new Date().toISOString(),
		...overrides,
	} as Task;
}

describe("getTaskCategory", () => {
	it("maps S to short", () => {
		expect(getTaskCategory("S")).toBe("short");
	});

	it("maps M to medium", () => {
		expect(getTaskCategory("M")).toBe("medium");
	});

	it("maps L and XL to long", () => {
		expect(getTaskCategory("L")).toBe("long");
		expect(getTaskCategory("XL")).toBe("long");
	});

	it("defaults unknown to short", () => {
		expect(getTaskCategory(undefined)).toBe("short");
	});
});

describe("sortTasksByFairness", () => {
	it("places short tasks before long tasks", () => {
		const tasks = [makeTask({ id: "t-long", complexity: "XL" }), makeTask({ id: "t-short", complexity: "S" })];
		const sorted = sortTasksByFairness(tasks);
		expect(sorted[0]!.id).toBe("t-short");
		expect(sorted[1]!.id).toBe("t-long");
	});

	it("places lower retry count before higher", () => {
		const tasks = [
			makeTask({ id: "t-retry", complexity: "M", retryCount: 2 }),
			makeTask({ id: "t-fresh", complexity: "M", retryCount: 0 }),
		];
		const sorted = sortTasksByFairness(tasks);
		expect(sorted[0]!.id).toBe("t-fresh");
		expect(sorted[1]!.id).toBe("t-retry");
	});

	it("places older tasks before newer when same category/retry", () => {
		const tasks = [
			makeTask({ id: "t-new", complexity: "S", createdAt: new Date(Date.now() + 1000).toISOString() }),
			makeTask({ id: "t-old", complexity: "S", createdAt: new Date(Date.now() - 1000).toISOString() }),
		];
		const sorted = sortTasksByFairness(tasks);
		expect(sorted[0]!.id).toBe("t-old");
		expect(sorted[1]!.id).toBe("t-new");
	});

	it("does not mutate original array", () => {
		const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];
		const originalOrder = tasks.map((t) => t.id);
		sortTasksByFairness(tasks);
		expect(tasks.map((t) => t.id)).toEqual(originalOrder);
	});
});

describe("groupTasksByLane", () => {
	it("groups tasks by category in priority order", () => {
		const tasks = [
			makeTask({ id: "t1", complexity: "XL" }),
			makeTask({ id: "t2", complexity: "S" }),
			makeTask({ id: "t3", complexity: "M" }),
		];
		const lanes = groupTasksByLane(tasks);
		expect(lanes).toHaveLength(3);
		expect(lanes[0]!.category).toBe("short");
		expect(lanes[0]!.tasks[0]!.id).toBe("t2");
		expect(lanes[1]!.category).toBe("medium");
		expect(lanes[1]!.tasks[0]!.id).toBe("t3");
		expect(lanes[2]!.category).toBe("long");
		expect(lanes[2]!.tasks[0]!.id).toBe("t1");
	});

	it("skips empty categories", () => {
		const tasks = [makeTask({ id: "t1", complexity: "S" })];
		const lanes = groupTasksByLane(tasks);
		expect(lanes).toHaveLength(1);
		expect(lanes[0]!.category).toBe("short");
	});
});

describe("starvation prevention (TASK 4.3)", () => {
	it("short tasks are never blocked behind 100 long tasks", () => {
		const tasks: Task[] = [];
		for (let i = 0; i < 100; i++) {
			tasks.push(
				makeTask({ id: `long-${i}`, complexity: "XL", createdAt: new Date(Date.now() - 1000 - i).toISOString() }),
			);
		}
		tasks.push(makeTask({ id: "short-0", complexity: "S", createdAt: new Date().toISOString() }));

		const sorted = sortTasksByFairness(tasks);
		expect(sorted[0]!.id).toBe("short-0");
	});

	it("short tasks dispatch before medium tasks regardless of arrival order", () => {
		const tasks = [
			makeTask({ id: "med-1", complexity: "M", createdAt: new Date(Date.now() - 1000).toISOString() }),
			makeTask({ id: "short-1", complexity: "S", createdAt: new Date().toISOString() }),
		];
		const sorted = sortTasksByFairness(tasks);
		expect(sorted[0]!.id).toBe("short-1");
		expect(sorted[1]!.id).toBe("med-1");
	});

	it("within same category, older tasks go first", () => {
		const tasks = [
			makeTask({ id: "old-short", complexity: "S", createdAt: new Date(Date.now() - 5000).toISOString() }),
			makeTask({ id: "new-short", complexity: "S", createdAt: new Date().toISOString() }),
		];
		const sorted = sortTasksByFairness(tasks);
		expect(sorted[0]!.id).toBe("old-short");
		expect(sorted[1]!.id).toBe("new-short");
	});

	it("fresh tasks dispatch before retried tasks of same category", () => {
		const tasks = [
			makeTask({ id: "retry", complexity: "S", retryCount: 2, createdAt: new Date(Date.now() - 1000).toISOString() }),
			makeTask({ id: "fresh", complexity: "S", retryCount: 0, createdAt: new Date().toISOString() }),
		];
		const sorted = sortTasksByFairness(tasks);
		expect(sorted[0]!.id).toBe("fresh");
		expect(sorted[1]!.id).toBe("retry");
	});
});
