import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Phase, Project, ProjectAgent, ProjectPlan, Task } from "../types.js";

vi.mock("../db.js", () => ({
	getLatestPlan: vi.fn(),
	getProject: vi.fn(),
	listProjectAgents: vi.fn(),
	upsertContextSnapshot: vi.fn(),
	getContextSnapshot: vi.fn(),
	getMemoryFacts: vi.fn(),
	upsertMemoryFact: vi.fn(),
}));

import {
	getContextSnapshot,
	getLatestPlan,
	getMemoryFacts,
	getProject,
	listProjectAgents,
	upsertContextSnapshot,
} from "../db.js";
import { getProjectContext, updateWorkingMemory } from "../memory-manager.js";

const mockGetProject = vi.mocked(getProject);
const mockGetLatestPlan = vi.mocked(getLatestPlan);
const mockListAgents = vi.mocked(listProjectAgents);
const mockUpsert = vi.mocked(upsertContextSnapshot);
const mockGetSnapshot = vi.mocked(getContextSnapshot);
const mockGetFacts = vi.mocked(getMemoryFacts);

function makeProject(overrides: Partial<Project> = {}): Project {
	return {
		id: "p-1",
		name: "Demo",
		description: "desc",
		status: "running",
		techStack: ["typescript", "react"],
		createdAt: new Date().toISOString(),
		...overrides,
	} as Project;
}

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "t-1",
		phaseId: "ph-1",
		title: "T",
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

function makePlan(phases: Phase[]): ProjectPlan {
	return {
		id: "plan-1",
		projectId: "p-1",
		version: 3,
		status: "approved",
		createdAt: new Date().toISOString(),
		phases,
	} as ProjectPlan;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockUpsert.mockResolvedValue({} as any);
	mockGetFacts.mockResolvedValue([]);
});

describe("updateWorkingMemory", () => {
	it("returns early when project is missing", async () => {
		mockGetProject.mockResolvedValue(undefined);
		mockGetLatestPlan.mockResolvedValue(undefined);
		mockListAgents.mockResolvedValue([]);

		await updateWorkingMemory("p-1");

		expect(mockUpsert).not.toHaveBeenCalled();
	});

	it("writes snapshot with zero stats when plan is missing", async () => {
		mockGetProject.mockResolvedValue(makeProject());
		mockGetLatestPlan.mockResolvedValue(undefined);
		mockListAgents.mockResolvedValue([]);

		await updateWorkingMemory("p-1");

		expect(mockUpsert).toHaveBeenCalledWith(
			"p-1",
			"working_summary",
			expect.objectContaining({
				project: expect.objectContaining({ id: "p-1", name: "Demo" }),
				plan: null,
				tasks: expect.objectContaining({ total: 0, done: 0, failed: 0 }),
			}),
			0,
		);
	});

	it("counts done/failed/remaining and computes completionPct", async () => {
		mockGetProject.mockResolvedValue(makeProject());
		const phase = {
			id: "ph-1",
			planId: "plan-1",
			name: "Phase 1",
			order: 1,
			dependsOn: [],
			status: "running",
			tasks: [
				makeTask({ id: "t-done-1", status: "done" }),
				makeTask({ id: "t-done-2", status: "done" }),
				makeTask({ id: "t-failed", status: "failed" }),
				makeTask({ id: "t-queued", status: "queued" }),
			],
		} as Phase;
		mockGetLatestPlan.mockResolvedValue(makePlan([phase]));
		mockListAgents.mockResolvedValue([]);

		await updateWorkingMemory("p-1");

		const summary = mockUpsert.mock.calls[0][2] as any;
		expect(summary.tasks).toEqual({
			total: 4,
			done: 2,
			failed: 1,
			remaining: 1,
			completionPct: 50,
		});
		expect(summary.plan).toMatchObject({
			id: "plan-1",
			version: 3,
			phaseCount: 1,
			currentPhase: "Phase 1",
		});
	});

	it("includes team roster in snapshot", async () => {
		mockGetProject.mockResolvedValue(makeProject());
		mockGetLatestPlan.mockResolvedValue(makePlan([]));
		mockListAgents.mockResolvedValue([
			{ id: "a-1", name: "Alice", role: "backend", model: "sonnet" } as ProjectAgent,
			{ id: "a-2", name: "Bob", role: "frontend", model: "haiku" } as ProjectAgent,
		]);

		await updateWorkingMemory("p-1");

		const summary = mockUpsert.mock.calls[0][2] as any;
		expect(summary.team).toHaveLength(2);
		expect(summary.team[0]).toMatchObject({ id: "a-1", name: "Alice", role: "backend" });
	});

	it("uses plan.version as source_version", async () => {
		mockGetProject.mockResolvedValue(makeProject());
		mockGetLatestPlan.mockResolvedValue(makePlan([]));
		mockListAgents.mockResolvedValue([]);

		await updateWorkingMemory("p-1");

		expect(mockUpsert).toHaveBeenCalledWith("p-1", "working_summary", expect.any(Object), 3);
	});
});

describe("getProjectContext", () => {
	it("returns empty string when no snapshot or facts exist", async () => {
		mockGetSnapshot.mockResolvedValue(null);
		mockGetFacts.mockResolvedValue([]);
		const res = await getProjectContext("p-1");
		expect(res).toBe("");
	});

	it("formats project/plan/team sections from snapshot", async () => {
		mockGetSnapshot.mockResolvedValue({
			projectId: "p-1",
			kind: "working_summary",
			summaryJson: {
				project: { name: "Demo", status: "running", techStack: ["typescript"] },
				plan: { version: 2, currentPhase: "Core" },
				tasks: { done: 3, total: 5, completionPct: 60 },
				team: [{ name: "Alice", role: "backend" }],
			},
			sourceVersion: 2,
			updatedAt: "2026-01-01",
		} as any);

		const res = await getProjectContext("p-1");
		expect(res).toContain("## Project: Demo");
		expect(res).toContain("Tech Stack: typescript");
		expect(res).toContain("Current Plan (v2)");
		expect(res).toContain("Progress: 3/5 tasks (60%)");
		expect(res).toContain("Alice (backend)");
	});

	it("includes known facts grouped by scope", async () => {
		mockGetSnapshot.mockResolvedValue(null);
		mockGetFacts.mockResolvedValue([
			{ projectId: "p-1", scope: "tech", key: "db", value: "postgres" } as any,
			{ projectId: "p-1", scope: "tech", key: "runtime", value: "node 22" } as any,
			{ projectId: "p-1", scope: "product", key: "audience", value: "devs" } as any,
		]);

		const res = await getProjectContext("p-1");
		expect(res).toContain("## Known Facts");
		expect(res).toContain("### tech");
		expect(res).toContain("db: postgres");
		expect(res).toContain("### product");
	});
});
