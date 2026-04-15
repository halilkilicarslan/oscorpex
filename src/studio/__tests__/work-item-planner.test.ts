import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Phase, ProjectAgent, ProjectPlan, Task, WorkItem } from "../types.js";

// DB modülünü mock'la — gerçek PostgreSQL bağlantısı gerektirmez
vi.mock("../db.js", () => ({
	getWorkItem: vi.fn(),
	getLatestPlan: vi.fn(),
	listProjectAgents: vi.fn(),
	createPhase: vi.fn(),
	createTask: vi.fn(),
	updateWorkItem: vi.fn(),
}));

import {
	createPhase,
	createTask,
	getLatestPlan,
	getWorkItem,
	listProjectAgents,
	updateWorkItem,
} from "../db.js";
import { planWorkItem } from "../work-item-planner.js";

const mockGetWorkItem = vi.mocked(getWorkItem);
const mockGetLatestPlan = vi.mocked(getLatestPlan);
const mockListProjectAgents = vi.mocked(listProjectAgents);
const mockCreatePhase = vi.mocked(createPhase);
const mockCreateTask = vi.mocked(createTask);
const mockUpdateWorkItem = vi.mocked(updateWorkItem);

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
	return {
		id: "wi-1",
		projectId: "proj-1",
		type: "feature",
		title: "Add login endpoint",
		description: "Implement /api/login",
		priority: "medium",
		labels: [],
		status: "open",
		source: "user",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

function makePhase(overrides: Partial<Phase> = {}): Phase {
	return {
		id: "phase-1",
		planId: "plan-1",
		name: "Implementation",
		order: 1,
		dependsOn: [],
		status: "pending",
		tasks: [],
		...overrides,
	};
}

function makePlan(phases: Phase[]): ProjectPlan {
	return {
		id: "plan-1",
		projectId: "proj-1",
		version: 1,
		status: "approved",
		phases,
		createdAt: new Date().toISOString(),
	};
}

function makeAgent(overrides: Partial<ProjectAgent> = {}): ProjectAgent {
	return {
		id: "agent-1",
		projectId: "proj-1",
		name: "Backend Dev",
		role: "backend-dev",
		model: "sonnet",
		systemPrompt: "",
		permissions: [],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	} as ProjectAgent;
}

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "task-1",
		phaseId: "phase-backlog",
		title: "Add login endpoint",
		description: "",
		assignedAgent: "backend-dev",
		status: "queued",
		complexity: "S",
		dependsOn: [],
		branch: "feat/add-login-endpoint",
		retryCount: 0,
		revisionCount: 0,
		requiresApproval: false,
		...overrides,
	} as Task;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("work-item-planner — planWorkItem", () => {
	it("throws when work item is missing", async () => {
		mockGetWorkItem.mockResolvedValue(null);
		await expect(planWorkItem("wi-missing")).rejects.toThrow(/not found/);
	});

	it("throws when work item is not open", async () => {
		mockGetWorkItem.mockResolvedValue(makeWorkItem({ status: "planned" }));
		await expect(planWorkItem("wi-1")).rejects.toThrow(/not open/);
	});

	it("throws when no plan exists for the project", async () => {
		mockGetWorkItem.mockResolvedValue(makeWorkItem());
		mockGetLatestPlan.mockResolvedValue(undefined);
		await expect(planWorkItem("wi-1")).rejects.toThrow(/No plan/);
	});

	it("creates a new Backlog phase when none exists and appends the task", async () => {
		const item = makeWorkItem();
		const impl = makePhase({ id: "p-impl", name: "Implementation", order: 1 });
		const plan = makePlan([impl]);
		const backlog = makePhase({ id: "p-backlog", name: "Backlog", order: 2 });
		const task = makeTask({ phaseId: backlog.id });

		mockGetWorkItem.mockResolvedValue(item);
		mockGetLatestPlan.mockResolvedValue(plan);
		mockListProjectAgents.mockResolvedValue([makeAgent({ role: "backend-dev" })]);
		mockCreatePhase.mockResolvedValue(backlog);
		mockCreateTask.mockResolvedValue(task);
		mockUpdateWorkItem.mockResolvedValue({ ...item, status: "planned", plannedTaskId: task.id });

		const result = await planWorkItem(item.id);

		expect(mockCreatePhase).toHaveBeenCalledWith({
			planId: plan.id,
			name: "Backlog",
			order: 2,
			dependsOn: [],
		});
		expect(mockCreateTask).toHaveBeenCalledTimes(1);
		const createdTask = mockCreateTask.mock.calls[0][0];
		expect(createdTask.phaseId).toBe(backlog.id);
		expect(createdTask.branch).toMatch(/^feat\/add-login-endpoint/);
		expect(createdTask.assignedAgent).toBe("backend-dev");
		expect(mockUpdateWorkItem).toHaveBeenCalledWith(item.id, {
			status: "planned",
			plannedTaskId: task.id,
		});
		expect(result.phase.id).toBe(backlog.id);
		expect(result.task.id).toBe(task.id);
		expect(result.workItem.status).toBe("planned");
	});

	it("reuses existing Backlog phase when present", async () => {
		const item = makeWorkItem();
		const backlog = makePhase({ id: "p-backlog", name: "Backlog", order: 3 });
		const plan = makePlan([makePhase({ id: "p1", name: "Impl", order: 1 }), backlog]);

		mockGetWorkItem.mockResolvedValue(item);
		mockGetLatestPlan.mockResolvedValue(plan);
		mockListProjectAgents.mockResolvedValue([makeAgent()]);
		mockCreateTask.mockResolvedValue(makeTask({ phaseId: backlog.id }));
		mockUpdateWorkItem.mockResolvedValue(item);

		const result = await planWorkItem(item.id);

		expect(mockCreatePhase).not.toHaveBeenCalled();
		expect(result.phase.id).toBe(backlog.id);
		expect(mockCreateTask.mock.calls[0][0].phaseId).toBe(backlog.id);
	});

	it("maps type 'bug' to qa role with 'fix/' branch prefix", async () => {
		const item = makeWorkItem({ type: "bug", title: "Null pointer in login", priority: "high" });
		const backlog = makePhase({ id: "p-backlog", name: "Backlog", order: 1 });

		mockGetWorkItem.mockResolvedValue(item);
		mockGetLatestPlan.mockResolvedValue(makePlan([backlog]));
		mockListProjectAgents.mockResolvedValue([
			makeAgent({ role: "backend-dev" }),
			makeAgent({ id: "a-qa", role: "qa" }),
		]);
		mockCreateTask.mockResolvedValue(makeTask());
		mockUpdateWorkItem.mockResolvedValue(item);

		await planWorkItem(item.id);

		const createdTask = mockCreateTask.mock.calls[0][0];
		expect(createdTask.assignedAgent).toBe("qa");
		expect(createdTask.assignedAgentId).toBe("a-qa");
		expect(createdTask.branch).toMatch(/^fix\//);
		expect(createdTask.complexity).toBe("M"); // high priority → M
	});

	it("maps type 'security' to security role with 'sec/' branch prefix", async () => {
		const item = makeWorkItem({ type: "security", title: "XSS vulnerability", priority: "critical" });
		const backlog = makePhase({ id: "p-backlog", name: "Backlog", order: 1 });

		mockGetWorkItem.mockResolvedValue(item);
		mockGetLatestPlan.mockResolvedValue(makePlan([backlog]));
		mockListProjectAgents.mockResolvedValue([
			makeAgent({ role: "backend-dev" }),
			makeAgent({ id: "a-sec", role: "security" }),
		]);
		mockCreateTask.mockResolvedValue(makeTask());
		mockUpdateWorkItem.mockResolvedValue(item);

		await planWorkItem(item.id);

		const createdTask = mockCreateTask.mock.calls[0][0];
		expect(createdTask.assignedAgent).toBe("security");
		expect(createdTask.assignedAgentId).toBe("a-sec");
		expect(createdTask.branch).toMatch(/^sec\//);
	});

	it("falls back to preferred role string when no matching agent exists", async () => {
		const item = makeWorkItem({ type: "improvement", priority: "low" });
		const backlog = makePhase({ id: "p-backlog", name: "Backlog", order: 1 });

		mockGetWorkItem.mockResolvedValue(item);
		mockGetLatestPlan.mockResolvedValue(makePlan([backlog]));
		mockListProjectAgents.mockResolvedValue([]);
		mockCreateTask.mockResolvedValue(makeTask());
		mockUpdateWorkItem.mockResolvedValue(item);

		await planWorkItem(item.id);

		const createdTask = mockCreateTask.mock.calls[0][0];
		expect(createdTask.assignedAgent).toBe("tech-lead");
		expect(createdTask.assignedAgentId).toBeUndefined();
		expect(createdTask.complexity).toBe("S"); // low priority → S
	});

	it("embeds severity, labels, and source task id into task description", async () => {
		const item = makeWorkItem({
			type: "defect",
			description: "Broken flow",
			severity: "major",
			labels: ["auth", "regression"],
			sourceTaskId: "t-parent",
		});
		const backlog = makePhase({ id: "p-backlog", name: "Backlog", order: 1 });

		mockGetWorkItem.mockResolvedValue(item);
		mockGetLatestPlan.mockResolvedValue(makePlan([backlog]));
		mockListProjectAgents.mockResolvedValue([makeAgent({ role: "qa" })]);
		mockCreateTask.mockResolvedValue(makeTask());
		mockUpdateWorkItem.mockResolvedValue(item);

		await planWorkItem(item.id);

		const desc = mockCreateTask.mock.calls[0][0].description;
		expect(desc).toContain("[Bug fix]");
		expect(desc).toContain("Broken flow");
		expect(desc).toContain("Severity: major");
		expect(desc).toContain("Labels: auth, regression");
		expect(desc).toContain("Source task: t-parent");
	});
});
