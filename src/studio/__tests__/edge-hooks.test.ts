import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDependency, Task, TaskOutput } from "../types.js";

vi.mock("../db.js", () => ({
	listAgentDependencies: vi.fn(),
}));

vi.mock("../agent-messaging.js", () => ({
	sendMessage: vi.fn(),
}));

import { sendMessage } from "../agent-messaging.js";
import { listAgentDependencies } from "../db.js";
import {
	applyPostCompletionHooks,
	outputHasDocumentation,
	taskNeedsApprovalFromEdges,
} from "../edge-hooks.js";

const mockListDeps = vi.mocked(listAgentDependencies);
const mockSendMessage = vi.mocked(sendMessage);

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "task-1",
		phaseId: "phase-1",
		title: "Implement auth",
		description: "",
		assignedAgent: "backend-dev",
		assignedAgentId: "a-backend",
		status: "running",
		complexity: "M",
		dependsOn: [],
		branch: "feat/auth",
		retryCount: 0,
		revisionCount: 0,
		requiresApproval: false,
		...overrides,
	} as Task;
}

function makeDep(overrides: Partial<AgentDependency>): AgentDependency {
	return {
		id: "d-1",
		projectId: "proj-1",
		fromAgentId: "a-backend",
		toAgentId: "a-qa",
		type: "notification",
		createdAt: new Date().toISOString(),
		...overrides,
	} as AgentDependency;
}

function makeOutput(overrides: Partial<TaskOutput> = {}): TaskOutput {
	return {
		filesCreated: [],
		filesModified: [],
		logs: [],
		...overrides,
	} as TaskOutput;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockSendMessage.mockResolvedValue({} as any);
});

describe("edge-hooks — outputHasDocumentation", () => {
	it("returns true when created files include .md", () => {
		expect(outputHasDocumentation(makeOutput({ filesCreated: ["docs/auth.md"] }))).toBe(true);
	});

	it("returns true when modified files include README", () => {
		expect(outputHasDocumentation(makeOutput({ filesModified: ["README.md"] }))).toBe(true);
	});

	it("returns true when logs reference documentation", () => {
		expect(outputHasDocumentation(makeOutput({ logs: ["Added new documentation section"] }))).toBe(
			true,
		);
	});

	it("returns false for code-only output", () => {
		expect(
			outputHasDocumentation(
				makeOutput({ filesCreated: ["src/auth/login.ts"], filesModified: ["src/auth/index.ts"] }),
			),
		).toBe(false);
	});
});

describe("edge-hooks — applyPostCompletionHooks", () => {
	it("returns zeroed result when task has no assignedAgentId", async () => {
		const result = await applyPostCompletionHooks(
			"proj-1",
			makeTask({ assignedAgentId: undefined }),
			makeOutput(),
		);
		expect(result).toEqual({ notificationsSent: 0, mentoringMessagesSent: 0, handoffDocMissing: false });
		expect(mockSendMessage).not.toHaveBeenCalled();
	});

	it("sends one notification message per outgoing notification edge", async () => {
		const deps: AgentDependency[] = [
			makeDep({ type: "notification", toAgentId: "a-qa" }),
			makeDep({ id: "d-2", type: "notification", toAgentId: "a-devops" }),
			makeDep({ id: "d-3", type: "workflow", toAgentId: "a-reviewer" }), // ignored
		];
		mockListDeps.mockResolvedValue(deps);

		const result = await applyPostCompletionHooks("proj-1", makeTask(), makeOutput());

		expect(result.notificationsSent).toBe(2);
		expect(mockSendMessage).toHaveBeenCalledTimes(2);
		const types = mockSendMessage.mock.calls.map((c) => c[3]);
		expect(types.every((t) => t === "notification")).toBe(true);
	});

	it("sends feedback message for mentoring edges (non-blocking)", async () => {
		mockListDeps.mockResolvedValue([makeDep({ type: "mentoring", toAgentId: "a-junior" })]);

		const result = await applyPostCompletionHooks("proj-1", makeTask(), makeOutput());

		expect(result.mentoringMessagesSent).toBe(1);
		const call = mockSendMessage.mock.calls[0];
		expect(call[3]).toBe("feedback");
		expect(call[6]).toMatchObject({ edgeType: "mentoring", nonBlocking: true });
	});

	it("flags missing handoff documentation and warns targets", async () => {
		mockListDeps.mockResolvedValue([
			makeDep({
				type: "handoff",
				toAgentId: "a-next",
				metadata: { documentRequired: true },
			}),
		]);

		const result = await applyPostCompletionHooks(
			"proj-1",
			makeTask(),
			makeOutput({ filesCreated: ["src/only-code.ts"] }),
		);

		expect(result.handoffDocMissing).toBe(true);
		expect(mockSendMessage).toHaveBeenCalledTimes(1);
		expect(mockSendMessage.mock.calls[0][3]).toBe("handoff_doc");
	});

	it("does not flag handoff when documentation is present", async () => {
		mockListDeps.mockResolvedValue([
			makeDep({
				type: "handoff",
				toAgentId: "a-next",
				metadata: { documentRequired: true },
			}),
		]);

		const result = await applyPostCompletionHooks(
			"proj-1",
			makeTask(),
			makeOutput({ filesCreated: ["docs/handoff.md"] }),
		);

		expect(result.handoffDocMissing).toBe(false);
		expect(mockSendMessage).not.toHaveBeenCalled();
	});

	it("ignores handoff edges without documentRequired flag", async () => {
		mockListDeps.mockResolvedValue([
			makeDep({ type: "handoff", toAgentId: "a-next", metadata: {} }),
		]);

		const result = await applyPostCompletionHooks(
			"proj-1",
			makeTask(),
			makeOutput({ filesCreated: ["src/code.ts"] }),
		);

		expect(result.handoffDocMissing).toBe(false);
	});

	it("survives individual send failures and keeps counting the rest", async () => {
		mockListDeps.mockResolvedValue([
			makeDep({ type: "notification", toAgentId: "a-qa" }),
			makeDep({ id: "d-2", type: "notification", toAgentId: "a-devops" }),
		]);
		mockSendMessage
			.mockRejectedValueOnce(new Error("first-fail"))
			.mockResolvedValueOnce({} as any);

		const result = await applyPostCompletionHooks("proj-1", makeTask(), makeOutput());

		// Only the successful send counts
		expect(result.notificationsSent).toBe(1);
	});

	it("uses depsOverride when provided without hitting the db", async () => {
		await applyPostCompletionHooks("proj-1", makeTask(), makeOutput(), []);
		expect(mockListDeps).not.toHaveBeenCalled();
	});
});

describe("edge-hooks — taskNeedsApprovalFromEdges", () => {
	it("returns true when the agent has an incoming approval edge", async () => {
		mockListDeps.mockResolvedValue([
			makeDep({ type: "approval", fromAgentId: "a-lead", toAgentId: "a-backend" }),
		]);

		expect(await taskNeedsApprovalFromEdges("proj-1", makeTask())).toBe(true);
	});

	it("returns false when the approval edge points elsewhere", async () => {
		mockListDeps.mockResolvedValue([
			makeDep({ type: "approval", fromAgentId: "a-lead", toAgentId: "a-other" }),
		]);

		expect(await taskNeedsApprovalFromEdges("proj-1", makeTask())).toBe(false);
	});

	it("returns false when task has no assignedAgentId", async () => {
		expect(
			await taskNeedsApprovalFromEdges("proj-1", makeTask({ assignedAgentId: undefined })),
		).toBe(false);
		expect(mockListDeps).not.toHaveBeenCalled();
	});

	it("returns false when db lookup fails", async () => {
		mockListDeps.mockRejectedValue(new Error("db-down"));
		expect(await taskNeedsApprovalFromEdges("proj-1", makeTask())).toBe(false);
	});
});
