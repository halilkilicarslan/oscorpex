import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectAgent, StudioEvent, Task } from "../types.js";

vi.mock("../db.js", () => ({
	listEvents: vi.fn(),
	listProjectAgents: vi.fn(),
	listProjectTasks: vi.fn(),
}));

vi.mock("../event-bus.js", () => ({
	eventBus: { emit: vi.fn() },
}));

import { runRetrospective, runStandup } from "../ceremony-engine.js";
import { listEvents, listProjectAgents, listProjectTasks } from "../db.js";
import { eventBus } from "../event-bus.js";

const mockListAgents = vi.mocked(listProjectAgents);
const mockListTasks = vi.mocked(listProjectTasks);
const mockListEvents = vi.mocked(listEvents);
const mockEmit = vi.mocked(eventBus.emit);

function makeAgent(overrides: Partial<ProjectAgent> = {}): ProjectAgent {
	return {
		id: "agent-1",
		projectId: "p-1",
		name: "Alice",
		role: "frontend-dev",
		avatar: "",
		gender: "female",
		personality: "",
		model: "sonnet",
		cliTool: "claude-code",
		skills: [],
		systemPrompt: "",
		createdAt: new Date().toISOString(),
		color: "#000",
		pipelineOrder: 0,
		...overrides,
	} as ProjectAgent;
}

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "t-1",
		phaseId: "ph-1",
		title: "Task",
		description: "",
		assignedAgent: "frontend-dev",
		complexity: "S",
		dependsOn: [],
		status: "queued",
		revisionCount: 0,
		retryCount: 0,
		createdAt: new Date().toISOString(),
		...overrides,
	} as Task;
}

function makeEvent(overrides: Partial<StudioEvent> = {}): StudioEvent {
	return {
		id: "e-1",
		projectId: "p-1",
		type: "task:completed",
		payload: {},
		timestamp: new Date().toISOString(),
		...overrides,
	} as StudioEvent;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("runStandup", () => {
	it("returns empty array when no agents", async () => {
		mockListAgents.mockResolvedValue([]);
		mockListTasks.mockResolvedValue([]);
		mockListEvents.mockResolvedValue([]);

		const reports = await runStandup("p-1");
		expect(reports).toEqual([]);
		expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({ type: "ceremony:standup", projectId: "p-1" }));
	});

	it("matches tasks by assignedAgentId", async () => {
		const recent = new Date().toISOString();
		mockListAgents.mockResolvedValue([makeAgent({ id: "agent-1", name: "Alice" })]);
		mockListTasks.mockResolvedValue([
			makeTask({ id: "t-1", title: "Done task", status: "done", completedAt: recent, assignedAgentId: "agent-1" }),
			makeTask({ id: "t-2", title: "Active task", status: "running", assignedAgentId: "agent-1" }),
		]);
		mockListEvents.mockResolvedValue([]);

		const [report] = await runStandup("p-1");
		expect(report.completedTasks).toEqual(["Done task"]);
		expect(report.inProgressTasks).toEqual(["Active task"]);
	});

	it("matches tasks by role name (case-insensitive)", async () => {
		mockListAgents.mockResolvedValue([makeAgent({ role: "Backend-Dev" })]);
		mockListTasks.mockResolvedValue([makeTask({ title: "Bug fix", status: "review", assignedAgent: "backend-dev" })]);
		mockListEvents.mockResolvedValue([]);

		const [report] = await runStandup("p-1");
		expect(report.inProgressTasks).toEqual(["Bug fix"]);
	});

	it("excludes completed tasks older than 24 hours", async () => {
		const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
		mockListAgents.mockResolvedValue([makeAgent()]);
		mockListTasks.mockResolvedValue([
			makeTask({ status: "done", completedAt: old, assignedAgentId: "agent-1", title: "Old task" }),
		]);
		mockListEvents.mockResolvedValue([]);

		const [report] = await runStandup("p-1");
		expect(report.completedTasks).toEqual([]);
	});

	it("populates blockers from recent task:failed events", async () => {
		const recent = new Date().toISOString();
		mockListAgents.mockResolvedValue([makeAgent()]);
		mockListTasks.mockResolvedValue([]);
		mockListEvents.mockResolvedValue([
			makeEvent({ type: "task:failed", agentId: "agent-1", payload: { error: "build failed" }, timestamp: recent }),
		]);

		const [report] = await runStandup("p-1");
		expect(report.blockers).toContain("build failed");
	});

	it("ignores old blockers", async () => {
		const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
		mockListAgents.mockResolvedValue([makeAgent()]);
		mockListTasks.mockResolvedValue([]);
		mockListEvents.mockResolvedValue([
			makeEvent({ type: "task:failed", agentId: "agent-1", payload: { error: "old" }, timestamp: old }),
		]);

		const [report] = await runStandup("p-1");
		expect(report.blockers).toEqual([]);
	});

	it("includes escalation:user events as blockers", async () => {
		const recent = new Date().toISOString();
		mockListAgents.mockResolvedValue([makeAgent()]);
		mockListTasks.mockResolvedValue([]);
		mockListEvents.mockResolvedValue([
			makeEvent({ type: "escalation:user", agentId: "agent-1", payload: { question: "help?" }, timestamp: recent }),
		]);

		const [report] = await runStandup("p-1");
		expect(report.blockers).toContain("help?");
	});
});

describe("runRetrospective", () => {
	it("returns baseline report on empty project", async () => {
		mockListAgents.mockResolvedValue([]);
		mockListTasks.mockResolvedValue([]);
		mockListEvents.mockResolvedValue([]);

		const report = await runRetrospective("p-1");
		expect(report.agentStats).toEqual([]);
		expect(report.whatWentWell.length).toBeGreaterThan(0);
		expect(mockEmit).toHaveBeenCalledWith(
			expect.objectContaining({ type: "ceremony:retrospective", projectId: "p-1" }),
		);
	});

	it("computes agent stats including success rate", async () => {
		mockListAgents.mockResolvedValue([makeAgent({ id: "agent-1", name: "Alice" })]);
		mockListTasks.mockResolvedValue([
			makeTask({ id: "t-1", assignedAgentId: "agent-1", status: "done", revisionCount: 0 }),
			makeTask({ id: "t-2", assignedAgentId: "agent-1", status: "done", revisionCount: 2 }),
			makeTask({ id: "t-3", assignedAgentId: "agent-1", status: "failed" }),
		]);
		mockListEvents.mockResolvedValue([]);

		const report = await runRetrospective("p-1");
		const alice = report.agentStats[0];
		expect(alice.tasksCompleted).toBe(2);
		expect(alice.avgRevisions).toBeCloseTo(0.67, 1);
		expect(alice.successRate).toBeCloseTo(0.67, 1);
	});

	it("includes high completion rate in wins", async () => {
		mockListAgents.mockResolvedValue([makeAgent()]);
		mockListTasks.mockResolvedValue([
			...Array(9)
				.fill(null)
				.map((_, i) => makeTask({ id: `t-${i}`, status: "done", assignedAgentId: "agent-1" })),
			makeTask({ id: "t-9", status: "queued", assignedAgentId: "agent-1" }),
		]);
		mockListEvents.mockResolvedValue([]);

		const report = await runRetrospective("p-1");
		expect(report.whatWentWell.some((s) => s.includes("90%"))).toBe(true);
	});

	it("flags high-revision agents under improvements", async () => {
		mockListAgents.mockResolvedValue([makeAgent({ id: "agent-1", name: "Alice" })]);
		mockListTasks.mockResolvedValue([
			makeTask({ id: "t-1", assignedAgentId: "agent-1", status: "done", revisionCount: 3 }),
			makeTask({ id: "t-2", assignedAgentId: "agent-1", status: "done", revisionCount: 2 }),
		]);
		mockListEvents.mockResolvedValue([]);

		const report = await runRetrospective("p-1");
		expect(report.whatCouldImprove.some((s) => s.includes("Alice"))).toBe(true);
		expect(report.actionItems.some((s) => s.includes("workshop"))).toBe(true);
	});

	it("flags high failure count in improvements", async () => {
		mockListAgents.mockResolvedValue([makeAgent()]);
		mockListTasks.mockResolvedValue([]);
		mockListEvents.mockResolvedValue(
			Array(5)
				.fill(null)
				.map((_, i) => makeEvent({ id: `e-${i}`, type: "task:failed" })),
		);

		const report = await runRetrospective("p-1");
		expect(report.whatCouldImprove.some((s) => s.includes("5 task failures"))).toBe(true);
		expect(report.actionItems.some((s) => s.includes("integration tests"))).toBe(true);
	});

	it("flags escalations as needing policy review", async () => {
		mockListAgents.mockResolvedValue([makeAgent()]);
		mockListTasks.mockResolvedValue([]);
		mockListEvents.mockResolvedValue([makeEvent({ type: "escalation:user" })]);

		const report = await runRetrospective("p-1");
		expect(report.whatCouldImprove.some((s) => s.includes("escalation"))).toBe(true);
		expect(report.actionItems.some((s) => s.includes("escalation policies"))).toBe(true);
	});

	it("flags low completion rate", async () => {
		mockListAgents.mockResolvedValue([]);
		mockListTasks.mockResolvedValue([
			makeTask({ id: "t-1", status: "done" }),
			makeTask({ id: "t-2", status: "failed" }),
			makeTask({ id: "t-3", status: "queued" }),
			makeTask({ id: "t-4", status: "queued" }),
		]);
		mockListEvents.mockResolvedValue([]);

		const report = await runRetrospective("p-1");
		expect(report.whatCouldImprove.some((s) => s.includes("completion rate") && s.includes("25%"))).toBe(true);
	});
});
