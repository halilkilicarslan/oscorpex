import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Phase, ProjectAgent, ProjectPlan, Task } from "../types.js";

vi.mock("../db.js", () => ({
	createPhase: vi.fn(),
	createTask: vi.fn(),
	getLatestPlan: vi.fn(),
	listProjectAgents: vi.fn(),
	updateTask: vi.fn(),
}));

vi.mock("../event-bus.js", () => ({
	eventBus: { emit: vi.fn() },
}));

vi.mock("../pipeline-engine.js", () => ({
	pipelineEngine: { refreshPipeline: vi.fn() },
}));

import { createPhase, createTask, getLatestPlan, listProjectAgents, updateTask } from "../db.js";
import { eventBus } from "../event-bus.js";
import {
	appendPhaseToPlan,
	appendTaskToPhase,
	replanUnfinishedTasks,
} from "../incremental-planner.js";
import { pipelineEngine } from "../pipeline-engine.js";

const mockGetLatestPlan = vi.mocked(getLatestPlan);
const mockCreatePhase = vi.mocked(createPhase);
const mockCreateTask = vi.mocked(createTask);
const mockListAgents = vi.mocked(listProjectAgents);
const mockUpdateTask = vi.mocked(updateTask);
const mockRefresh = vi.mocked(pipelineEngine.refreshPipeline);
const mockEmit = vi.mocked(eventBus.emit);

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "t-1",
		phaseId: "p-1",
		title: "Some task",
		description: "",
		assignedAgent: "backend",
		status: "queued",
		complexity: "M",
		dependsOn: [],
		branch: "feat/x",
		retryCount: 0,
		revisionCount: 0,
		requiresApproval: false,
		...overrides,
	} as Task;
}

function makePhase(overrides: Partial<Phase> = {}): Phase {
	return {
		id: "p-1",
		planId: "plan-1",
		name: "Phase 1",
		order: 1,
		dependsOn: [],
		status: "pending",
		tasks: [],
		...overrides,
	} as Phase;
}

function makePlan(phases: Phase[]): ProjectPlan {
	return {
		id: "plan-1",
		projectId: "proj-1",
		version: 1,
		status: "approved",
		createdAt: new Date().toISOString(),
		phases,
	} as ProjectPlan;
}

function makeAgent(overrides: Partial<ProjectAgent> = {}): ProjectAgent {
	return {
		id: "a-1",
		projectId: "proj-1",
		role: "backend",
		name: "Backend Dev",
		avatar: "",
		model: "sonnet",
		provider: "anthropic",
		createdAt: new Date().toISOString(),
		...overrides,
	} as ProjectAgent;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockRefresh.mockResolvedValue(undefined as any);
});

describe("appendPhaseToPlan", () => {
	it("throws when no plan exists", async () => {
		mockGetLatestPlan.mockResolvedValue(undefined);
		await expect(appendPhaseToPlan("proj-1", { name: "X" })).rejects.toThrow(/No plan found/);
	});

	it("appends a phase with order = maxOrder + 1", async () => {
		mockGetLatestPlan.mockResolvedValue(
			makePlan([makePhase({ id: "p-1", order: 1 }), makePhase({ id: "p-2", order: 2 })]),
		);
		mockCreatePhase.mockResolvedValue(makePhase({ id: "p-3", name: "New Phase", order: 3 }));

		const { phase } = await appendPhaseToPlan("proj-1", {
			name: "New Phase",
			dependsOnPhaseIds: ["p-2"],
		});

		expect(phase.order).toBe(3);
		expect(mockCreatePhase).toHaveBeenCalledWith({
			planId: "plan-1",
			name: "New Phase",
			order: 3,
			dependsOn: ["p-2"],
		});
		expect(mockEmit).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: "proj-1", type: "plan:phase_added" }),
		);
		expect(mockRefresh).toHaveBeenCalledWith("proj-1");
	});

	it("defaults order to 1 when plan has zero phases", async () => {
		mockGetLatestPlan.mockResolvedValue(makePlan([]));
		mockCreatePhase.mockResolvedValue(makePhase({ order: 1 }));

		await appendPhaseToPlan("proj-1", { name: "First" });

		expect(mockCreatePhase).toHaveBeenCalledWith(
			expect.objectContaining({ order: 1, dependsOn: [] }),
		);
	});

	it("suppresses refresh errors when pipeline not running", async () => {
		mockGetLatestPlan.mockResolvedValue(makePlan([]));
		mockCreatePhase.mockResolvedValue(makePhase({ order: 1 }));
		mockRefresh.mockRejectedValue(new Error("pipeline bulunamadı"));

		await expect(appendPhaseToPlan("proj-1", { name: "X" })).resolves.toBeTruthy();
	});
});

describe("appendTaskToPhase", () => {
	it("throws when no plan exists", async () => {
		mockGetLatestPlan.mockResolvedValue(undefined);
		await expect(
			appendTaskToPhase("proj-1", "p-1", {
				title: "t",
				description: "",
				assignedRole: "backend",
				complexity: "M",
				branch: "feat/x",
			}),
		).rejects.toThrow(/No plan found/);
	});

	it("throws when phase is missing", async () => {
		mockGetLatestPlan.mockResolvedValue(makePlan([makePhase({ id: "p-1" })]));
		await expect(
			appendTaskToPhase("proj-1", "p-missing", {
				title: "t",
				description: "",
				assignedRole: "backend",
				complexity: "M",
				branch: "feat/x",
			}),
		).rejects.toThrow(/Phase p-missing not found/);
	});

	it("resolves role to an existing agent id", async () => {
		mockGetLatestPlan.mockResolvedValue(makePlan([makePhase({ id: "p-1" })]));
		mockListAgents.mockResolvedValue([
			makeAgent({ id: "a-backend", role: "backend" }),
			makeAgent({ id: "a-qa", role: "qa" }),
		]);
		mockCreateTask.mockResolvedValue(makeTask({ id: "t-new" }));

		await appendTaskToPhase("proj-1", "p-1", {
			title: "Auth endpoint",
			description: "",
			assignedRole: "backend",
			complexity: "S",
			branch: "feat/auth",
		});

		expect(mockCreateTask).toHaveBeenCalledWith(
			expect.objectContaining({
				phaseId: "p-1",
				assignedAgent: "a-backend",
				assignedAgentId: "a-backend",
				taskType: "ai",
			}),
		);
	});

	it("falls back to role string when no matching agent found", async () => {
		mockGetLatestPlan.mockResolvedValue(makePlan([makePhase({ id: "p-1" })]));
		mockListAgents.mockResolvedValue([]);
		mockCreateTask.mockResolvedValue(makeTask());

		await appendTaskToPhase("proj-1", "p-1", {
			title: "t",
			description: "",
			assignedRole: "frontend",
			complexity: "M",
			branch: "feat/ui",
		});

		expect(mockCreateTask).toHaveBeenCalledWith(
			expect.objectContaining({
				assignedAgent: "frontend",
				assignedAgentId: undefined,
			}),
		);
	});

	it("prefers explicit assignedAgentId over role lookup", async () => {
		mockGetLatestPlan.mockResolvedValue(makePlan([makePhase({ id: "p-1" })]));
		mockCreateTask.mockResolvedValue(makeTask());

		await appendTaskToPhase("proj-1", "p-1", {
			title: "t",
			description: "",
			assignedRole: "backend",
			assignedAgentId: "a-explicit",
			complexity: "M",
			branch: "feat/x",
		});

		expect(mockListAgents).not.toHaveBeenCalled();
		expect(mockCreateTask).toHaveBeenCalledWith(
			expect.objectContaining({ assignedAgentId: "a-explicit" }),
		);
	});

	it("emits task:added event and refreshes pipeline", async () => {
		mockGetLatestPlan.mockResolvedValue(makePlan([makePhase({ id: "p-1" })]));
		mockListAgents.mockResolvedValue([]);
		mockCreateTask.mockResolvedValue(makeTask({ id: "t-new", title: "New" }));

		await appendTaskToPhase("proj-1", "p-1", {
			title: "New",
			description: "",
			assignedRole: "backend",
			complexity: "M",
			branch: "feat/x",
		});

		expect(mockEmit).toHaveBeenCalledWith(
			expect.objectContaining({ type: "task:added", taskId: "t-new" }),
		);
		expect(mockRefresh).toHaveBeenCalledWith("proj-1");
	});
});

describe("replanUnfinishedTasks", () => {
	it("throws when no plan exists", async () => {
		mockGetLatestPlan.mockResolvedValue(undefined);
		await expect(replanUnfinishedTasks("proj-1", "reason")).rejects.toThrow(/No plan found/);
	});

	it("cancels queued/assigned/failed, preserves done", async () => {
		const phase = makePhase({
			id: "p-1",
			tasks: [
				makeTask({ id: "t-done", status: "done" }),
				makeTask({ id: "t-queued", status: "queued" }),
				makeTask({ id: "t-assigned", status: "assigned" }),
				makeTask({ id: "t-failed", status: "failed" }),
				makeTask({ id: "t-running", status: "running" }),
			],
		});
		mockGetLatestPlan.mockResolvedValue(makePlan([phase]));
		mockUpdateTask.mockResolvedValue(makeTask());

		const result = await replanUnfinishedTasks("proj-1", "scope changed");

		expect(result.cancelledCount).toBe(3);
		expect(result.cancelledTaskIds).toEqual(["t-queued", "t-assigned", "t-failed"]);
		expect(result.keptCompletedCount).toBe(1);
		expect(mockUpdateTask).toHaveBeenCalledTimes(3);
		expect(mockUpdateTask).toHaveBeenCalledWith(
			"t-queued",
			expect.objectContaining({ status: "failed", error: "[replanned] scope changed" }),
		);
	});

	it("does not touch running tasks", async () => {
		const phase = makePhase({
			id: "p-1",
			tasks: [makeTask({ id: "t-running", status: "running" })],
		});
		mockGetLatestPlan.mockResolvedValue(makePlan([phase]));

		const result = await replanUnfinishedTasks("proj-1", "r");

		expect(result.cancelledCount).toBe(0);
		expect(mockUpdateTask).not.toHaveBeenCalled();
	});

	it("emits plan:replanned event with counts", async () => {
		const phase = makePhase({
			id: "p-1",
			tasks: [
				makeTask({ id: "t-done", status: "done" }),
				makeTask({ id: "t-queued", status: "queued" }),
			],
		});
		mockGetLatestPlan.mockResolvedValue(makePlan([phase]));
		mockUpdateTask.mockResolvedValue(makeTask());

		await replanUnfinishedTasks("proj-1", "reshuffle");

		expect(mockEmit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "plan:replanned",
				payload: expect.objectContaining({
					reason: "reshuffle",
					cancelledCount: 1,
					keptCompletedCount: 1,
				}),
			}),
		);
	});
});
