import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Phase, Project, ProjectPlan, Task } from "../types.js";

vi.mock("../db.js", () => ({
	createTask: vi.fn(),
	getLatestPlan: vi.fn(),
	getProject: vi.fn(),
	listPhases: vi.fn(),
	updateProject: vi.fn(),
}));

vi.mock("../event-bus.js", () => ({
	eventBus: { emit: vi.fn() },
}));

import { createTask, getLatestPlan, getProject, listPhases, updateProject } from "../db.js";
import { eventBus } from "../event-bus.js";
import {
	getValidTransitions,
	transitionProject,
	triggerHotfix,
} from "../lifecycle-manager.js";

const mockGetProject = vi.mocked(getProject);
const mockUpdateProject = vi.mocked(updateProject);
const mockGetLatestPlan = vi.mocked(getLatestPlan);
const mockListPhases = vi.mocked(listPhases);
const mockCreateTask = vi.mocked(createTask);
const mockEmit = vi.mocked(eventBus.emit);

function makeProject(overrides: Partial<Project> = {}): Project {
	return {
		id: "p-1",
		name: "Demo",
		description: "",
		status: "running",
		techStack: [],
		createdAt: new Date().toISOString(),
		...overrides,
	} as Project;
}

function makePlan(): ProjectPlan {
	return {
		id: "plan-1",
		projectId: "p-1",
		version: 1,
		status: "approved",
		createdAt: new Date().toISOString(),
		phases: [],
	} as ProjectPlan;
}

function makePhase(id: string): Phase {
	return {
		id,
		planId: "plan-1",
		name: `Phase ${id}`,
		order: 1,
		dependsOn: [],
		status: "pending",
		tasks: [],
	} as Phase;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockUpdateProject.mockResolvedValue({} as any);
	mockCreateTask.mockResolvedValue({ id: "task-hotfix" } as Task);
});

describe("getValidTransitions", () => {
	it("returns allowed transitions from running", () => {
		expect(getValidTransitions("running")).toEqual(["paused", "completed", "failed"]);
	});

	it("returns maintenance/archived from completed", () => {
		expect(getValidTransitions("completed")).toEqual(["maintenance", "archived"]);
	});

	it("returns empty array from archived (terminal state)", () => {
		expect(getValidTransitions("archived")).toEqual([]);
	});

	it("returns empty array for unknown status", () => {
		expect(getValidTransitions("weird" as any)).toEqual([]);
	});
});

describe("transitionProject", () => {
	it("throws when project is missing", async () => {
		mockGetProject.mockResolvedValue(undefined);
		await expect(transitionProject("p-1", "completed")).rejects.toThrow(/not found/);
	});

	it("throws on invalid transition", async () => {
		mockGetProject.mockResolvedValue(makeProject({ status: "archived" }));
		await expect(transitionProject("p-1", "running")).rejects.toThrow(/Invalid transition/);
		expect(mockUpdateProject).not.toHaveBeenCalled();
	});

	it("applies valid transition and emits event", async () => {
		mockGetProject.mockResolvedValue(makeProject({ status: "running" }));

		await transitionProject("p-1", "completed");

		expect(mockUpdateProject).toHaveBeenCalledWith("p-1", { status: "completed" });
		expect(mockEmit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "lifecycle:transition",
				projectId: "p-1",
				payload: expect.objectContaining({ from: "running", to: "completed" }),
			}),
		);
	});

	it("allows completed → maintenance", async () => {
		mockGetProject.mockResolvedValue(makeProject({ status: "completed" }));
		await expect(transitionProject("p-1", "maintenance")).resolves.toBeUndefined();
	});

	it("allows maintenance → archived", async () => {
		mockGetProject.mockResolvedValue(makeProject({ status: "maintenance" }));
		await expect(transitionProject("p-1", "archived")).resolves.toBeUndefined();
	});
});

describe("triggerHotfix", () => {
	it("throws when project is missing", async () => {
		mockGetProject.mockResolvedValue(undefined);
		await expect(triggerHotfix("p-1", "fix x")).rejects.toThrow(/not found/);
	});

	it("rejects hotfix when project is not completed/maintenance", async () => {
		mockGetProject.mockResolvedValue(makeProject({ status: "running" }));
		await expect(triggerHotfix("p-1", "fix")).rejects.toThrow(/requires project in/);
	});

	it("throws when project has no plan", async () => {
		mockGetProject.mockResolvedValue(makeProject({ status: "completed" }));
		mockGetLatestPlan.mockResolvedValue(undefined);
		await expect(triggerHotfix("p-1", "fix")).rejects.toThrow(/no plan/);
	});

	it("throws when plan has no phases", async () => {
		mockGetProject.mockResolvedValue(makeProject({ status: "completed" }));
		mockGetLatestPlan.mockResolvedValue(makePlan());
		mockListPhases.mockResolvedValue([]);
		await expect(triggerHotfix("p-1", "fix")).rejects.toThrow(/no phases/);
	});

	it("creates a hotfix task in the last phase with required approval", async () => {
		mockGetProject.mockResolvedValue(makeProject({ status: "maintenance" }));
		mockGetLatestPlan.mockResolvedValue(makePlan());
		mockListPhases.mockResolvedValue([makePhase("ph-1"), makePhase("ph-2")]);

		const taskId = await triggerHotfix("p-1", "payment gateway fails on Safari");

		expect(taskId).toBe("task-hotfix");
		expect(mockCreateTask).toHaveBeenCalledWith(
			expect.objectContaining({
				phaseId: "ph-2",
				title: expect.stringMatching(/^\[HOTFIX-/),
				description: "payment gateway fails on Safari",
				assignedAgent: "tech-lead",
				complexity: "S",
				requiresApproval: true,
				branch: expect.stringMatching(/^hotfix\//),
			}),
		);
	});

	it("auto-transitions completed → maintenance when hotfix triggered", async () => {
		mockGetProject.mockResolvedValue(makeProject({ status: "completed" }));
		mockGetLatestPlan.mockResolvedValue(makePlan());
		mockListPhases.mockResolvedValue([makePhase("ph-1")]);

		await triggerHotfix("p-1", "urgent");

		expect(mockUpdateProject).toHaveBeenCalledWith("p-1", { status: "maintenance" });
		const transitionEvents = mockEmit.mock.calls.filter(
			(c) => (c[0] as any).type === "lifecycle:transition",
		);
		expect(transitionEvents.length).toBeGreaterThanOrEqual(1);
	});

	it("does not re-transition when project already in maintenance", async () => {
		mockGetProject.mockResolvedValue(makeProject({ status: "maintenance" }));
		mockGetLatestPlan.mockResolvedValue(makePlan());
		mockListPhases.mockResolvedValue([makePhase("ph-1")]);

		await triggerHotfix("p-1", "urgent");

		expect(mockUpdateProject).not.toHaveBeenCalled();
	});

	it("emits task:assigned event with hotfix flag", async () => {
		mockGetProject.mockResolvedValue(makeProject({ status: "maintenance" }));
		mockGetLatestPlan.mockResolvedValue(makePlan());
		mockListPhases.mockResolvedValue([makePhase("ph-1")]);

		await triggerHotfix("p-1", "urgent fix");

		const assignedEvent = mockEmit.mock.calls.find((c) => (c[0] as any).type === "task:assigned");
		expect(assignedEvent).toBeDefined();
		expect((assignedEvent![0] as any).payload).toMatchObject({ hotfix: true });
	});
});
