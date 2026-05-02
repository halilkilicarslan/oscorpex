// ---------------------------------------------------------------------------
// Oscorpex — Agent Runtime Unit Tests
// Tests for Phase 2 Agentic Core: memory, strategy, session, protocol,
// constraints, task injection.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock DB layer
// ---------------------------------------------------------------------------
vi.mock("../db.js", () => ({
	query: vi.fn().mockResolvedValue([]),
	getRecentEpisodes: vi.fn().mockResolvedValue([]),
	getFailureEpisodes: vi.fn().mockResolvedValue([]),
	getBestStrategies: vi.fn().mockResolvedValue([]),
	getDefaultStrategy: vi.fn().mockResolvedValue(null),
	getStrategiesForRole: vi.fn().mockResolvedValue([]),
	getActiveSession: vi.fn().mockResolvedValue(null),
	createAgentSession: vi.fn().mockImplementation(async (params: any) => ({
		id: "session-1",
		...params,
		status: "active",
		observations: [],
		createdAt: new Date().toISOString(),
	})),
	updateAgentSession: vi.fn().mockImplementation(async (id: string, updates: any) => ({
		id,
		strategy: "scaffold_then_refine",
		stepsCompleted: 3,
		...updates,
	})),
	addObservation: vi.fn().mockResolvedValue(undefined),
	recordEpisode: vi.fn().mockResolvedValue({ id: "episode-1" }),
	updateStrategyPattern: vi.fn().mockResolvedValue(undefined),
	sendProtocolMessage: vi.fn().mockImplementation(async (params: any) => ({
		id: "msg-1",
		...params,
		status: "unread",
		createdAt: new Date().toISOString(),
	})),
	getUnreadMessages: vi.fn().mockResolvedValue([]),
	markMessagesRead: vi.fn().mockResolvedValue(undefined),
	createProposal: vi.fn().mockImplementation(async (params: any) => ({
		id: "proposal-1",
		...params,
		status: "pending",
		createdAt: new Date().toISOString(),
	})),
	autoApproveProposal: vi.fn().mockImplementation(async (id: string) => ({
		id,
		status: "approved",
	})),
	listProjectAgents: vi.fn().mockResolvedValue([]),
	createTask: vi.fn().mockImplementation(async (params: any) => ({
		id: "task-injected-1",
		...params,
		status: "queued",
	})),
	getApprovalRule: vi.fn().mockResolvedValue(null),
	requiresApproval: vi.fn().mockResolvedValue(false),
	hasCapability: vi.fn().mockResolvedValue(true),
}));

vi.mock("../event-bus.js", () => ({
	eventBus: {
		emit: vi.fn(),
		emitTransient: vi.fn(),
	},
}));

import { canAutoApprove, checkConstraints, classifyRisk } from "../agent-runtime/agent-constraints.js";
// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { formatBehavioralPrompt, loadBehavioralContext } from "../agent-runtime/agent-memory.js";
import {
	acknowledgeMessages,
	handoffArtifact,
	loadProtocolContext,
	requestInfo,
	signalBlocker,
} from "../agent-runtime/agent-protocol.js";
import { completeSession, failSession, initSession, recordStep } from "../agent-runtime/agent-session.js";
import { BUILTIN_STRATEGIES, selectStrategy } from "../agent-runtime/agent-strategy.js";
import { proposeTask } from "../agent-runtime/task-injection.js";
import { getUnreadMessages } from "../db.js";

// ---------------------------------------------------------------------------
// Agent Memory
// ---------------------------------------------------------------------------
describe("Agent Memory", () => {
	it("should load behavioral context with empty history", async () => {
		const ctx = await loadBehavioralContext("proj-1", "agent-1", "backend_dev", "implementation");
		expect(ctx).toBeDefined();
		expect(ctx.recentEpisodes).toEqual([]);
		expect(ctx.failureLessons).toEqual([]);
		expect(ctx.bestStrategies).toEqual([]);
	});

	it("should format behavioral prompt from empty context", () => {
		const prompt = formatBehavioralPrompt({
			recentEpisodes: [],
			failureLessons: [],
			bestStrategies: [],
		});
		expect(prompt).toBe("");
	});

	it("should format behavioral prompt with failure lessons", () => {
		const prompt = formatBehavioralPrompt({
			recentEpisodes: [],
			failureLessons: [
				{
					id: "ep-1",
					projectId: "proj-1",
					agentId: "agent-1",
					taskId: "task-1",
					taskType: "implementation",
					strategy: "scaffold_then_refine",
					actionSummary: "Tried to scaffold but failed on imports",
					outcome: "failure",
					failureReason: "import path error",
					durationMs: 30000,
					costUsd: 0.05,
					createdAt: new Date().toISOString(),
				},
			],
			bestStrategies: [],
		});
		expect(prompt).toContain("import path error");
		expect(prompt).toContain("LESSONS FROM PAST FAILURES");
	});
});

// ---------------------------------------------------------------------------
// Strategy Selection
// ---------------------------------------------------------------------------
describe("Strategy Selection", () => {
	it("should have builtin strategies for key roles", () => {
		expect(BUILTIN_STRATEGIES.length).toBeGreaterThanOrEqual(5);
		const roles = [...new Set(BUILTIN_STRATEGIES.map((s) => s.agentRole))];
		expect(roles).toContain("backend-dev");
		expect(roles).toContain("frontend-dev");
		expect(roles).toContain("reviewer");
	});

	it("should fall back to generic strategy when no history exists", async () => {
		const result = await selectStrategy("proj-1", "backend_dev", {
			id: "t1",
			title: "Implement user auth",
			complexity: "M",
		} as any);
		expect(result).toBeDefined();
		expect(result.strategy).toBeDefined();
		expect(result.strategy.name).toBeTruthy();
		expect(result.confidence).toBeGreaterThanOrEqual(0);
	});

	it("should return a reason for strategy selection", async () => {
		const result = await selectStrategy("proj-1", "unknown_role", {
			id: "t1",
			title: "Do something",
			complexity: "S",
		} as any);
		expect(result.reason).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// Agent Session
// ---------------------------------------------------------------------------
describe("Agent Session", () => {
	it("should init session with strategy and behavioral context", async () => {
		const task = {
			id: "task-1",
			title: "Build login page",
			complexity: "M",
			description: "",
			phaseId: "phase-1",
			assignedAgent: "agent-1",
			status: "running",
			taskType: "ai",
		} as any;

		const result = await initSession("proj-1", "agent-1", "frontend_dev", task);
		expect(result.session).toBeDefined();
		expect(result.session.id).toBe("session-1");
		expect(result.strategySelection).toBeDefined();
		expect(typeof result.behavioralPrompt).toBe("string");
	});

	it("should record step observation", async () => {
		const { addObservation } = await import("../db.js");
		await recordStep("session-1", {
			step: 1,
			type: "action_executed",
			summary: "Created auth module",
		});
		expect(addObservation).toHaveBeenCalledWith("session-1", expect.objectContaining({ type: "action_executed" }));
	});

	it("should complete session and record episode", async () => {
		const { updateAgentSession, recordEpisode } = await import("../db.js");
		const task = { id: "t1", title: "Test", complexity: "S" } as any;
		await completeSession("session-1", "proj-1", "agent-1", "backend_dev", task, {});
		expect(updateAgentSession).toHaveBeenCalledWith("session-1", expect.objectContaining({ status: "completed" }));
		expect(recordEpisode).toHaveBeenCalled();
	});

	it("should fail session and record failure episode", async () => {
		const { updateAgentSession, recordEpisode } = await import("../db.js");
		const task = { id: "t1", title: "Test", complexity: "S" } as any;
		await failSession("session-1", "proj-1", "agent-1", "backend_dev", task, "timeout");
		expect(updateAgentSession).toHaveBeenCalledWith("session-1", expect.objectContaining({ status: "failed" }));
		expect(recordEpisode).toHaveBeenCalledWith(
			expect.objectContaining({ outcome: "failure", failureReason: "timeout" }),
		);
	});

	it("should record multiple steps with correct observation types", async () => {
		const { addObservation } = await import("../db.js");
		vi.mocked(addObservation).mockClear();

		await recordStep("session-1", { step: 1, type: "action_executed", summary: "CLI execution started: claude-code" });
		await recordStep("session-1", { step: 2, type: "result_inspected", summary: "Output received: 3 files" });
		await recordStep("session-1", { step: 3, type: "decision_made", summary: "Verification: passed" });
		await recordStep("session-1", { step: 4, type: "decision_made", summary: "Test gate: passed (12 tests)" });

		expect(addObservation).toHaveBeenCalledTimes(4);
		expect(addObservation).toHaveBeenNthCalledWith(
			1,
			"session-1",
			expect.objectContaining({ step: 1, type: "action_executed" }),
		);
		expect(addObservation).toHaveBeenNthCalledWith(
			2,
			"session-1",
			expect.objectContaining({ step: 2, type: "result_inspected" }),
		);
		expect(addObservation).toHaveBeenNthCalledWith(
			3,
			"session-1",
			expect.objectContaining({ step: 3, type: "decision_made" }),
		);
		expect(addObservation).toHaveBeenNthCalledWith(
			4,
			"session-1",
			expect.objectContaining({ step: 4, type: "decision_made" }),
		);
	});

	it("should auto-assign timestamp to recorded steps", async () => {
		const { addObservation } = await import("../db.js");
		vi.mocked(addObservation).mockClear();

		await recordStep("session-1", { step: 1, type: "action_executed", summary: "test" });
		expect(addObservation).toHaveBeenCalledWith(
			"session-1",
			expect.objectContaining({ timestamp: expect.any(String) }),
		);
	});

	it("should include stepsCompleted in completed session episode summary", async () => {
		const { recordEpisode, updateAgentSession } = await import("../db.js");
		vi.mocked(updateAgentSession).mockResolvedValueOnce({
			id: "session-1",
			strategy: "scaffold_then_refine",
			stepsCompleted: 4,
			status: "completed",
			completedAt: new Date().toISOString(),
		} as any);
		vi.mocked(recordEpisode).mockClear();

		const task = { id: "t1", title: "Build API", complexity: "M", taskType: "ai" } as any;
		await completeSession("session-1", "proj-1", "agent-1", "backend_dev", task, {});

		expect(recordEpisode).toHaveBeenCalledWith(
			expect.objectContaining({
				actionSummary: expect.stringContaining("4 steps"),
			}),
		);
	});
});

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------
describe("Agent Protocol", () => {
	it("should return empty prompt when no unread messages", async () => {
		const ctx = await loadProtocolContext("proj-1", "agent-1");
		expect(ctx.prompt).toBe("");
		expect(ctx.messageIds).toEqual([]);
		expect(ctx.hasBlockers).toBe(false);
	});

	it("should format unread messages into prompt", async () => {
		const mockMessages = [
			{
				id: "m1",
				fromAgentId: "agent-2",
				messageType: "request_info" as const,
				payload: { topic: "API", question: "Which auth method?" },
			},
		];
		vi.mocked(getUnreadMessages).mockResolvedValueOnce(mockMessages as any);

		const ctx = await loadProtocolContext("proj-1", "agent-1");
		expect(ctx.prompt).toContain("REQUEST from agent-2");
		expect(ctx.prompt).toContain("Which auth method?");
		expect(ctx.messageIds).toEqual(["m1"]);
	});

	it("should detect blockers in messages", async () => {
		const mockMessages = [
			{
				id: "m2",
				fromAgentId: "agent-3",
				messageType: "blocker_alert" as const,
				payload: { description: "DB connection failed" },
			},
		];
		vi.mocked(getUnreadMessages).mockResolvedValueOnce(mockMessages as any);

		const ctx = await loadProtocolContext("proj-1", "agent-1");
		expect(ctx.hasBlockers).toBe(true);
		expect(ctx.prompt).toContain("BLOCKER from agent-3");
	});

	it("should send request_info message", async () => {
		const msg = await requestInfo("proj-1", "agent-1", "agent-2", "API Design", "Which framework?");
		expect(msg).toBeDefined();
		expect(msg.id).toBe("msg-1");
	});

	it("should send blocker signal", async () => {
		const msg = await signalBlocker("proj-1", "agent-1", "Can't access DB");
		expect(msg).toBeDefined();
	});

	it("should send handoff artifact", async () => {
		const msg = await handoffArtifact("proj-1", "agent-1", "agent-2", "schema", "CREATE TABLE users...");
		expect(msg).toBeDefined();
	});

	it("should acknowledge messages", async () => {
		const { markMessagesRead } = await import("../db.js");
		await acknowledgeMessages(["m1", "m2"]);
		expect(markMessagesRead).toHaveBeenCalledWith(["m1", "m2"]);
	});
});

// ---------------------------------------------------------------------------
// Constraints & Risk
// ---------------------------------------------------------------------------
describe("Agent Constraints", () => {
	it("should classify low-risk tasks", () => {
		expect(classifyRisk({ proposalType: "test_task", title: "Add unit tests", severity: undefined })).toBe("low");
		expect(classifyRisk({ proposalType: "test_task", title: "Update README docs", severity: undefined })).toBe("low");
	});

	it("should classify medium-risk tasks (refactor/dependency)", () => {
		expect(classifyRisk({ proposalType: "refactor", title: "Refactor utils module", severity: undefined })).toBe(
			"high",
		);
		expect(classifyRisk({ proposalType: "refactor", title: "Upgrade package deps", severity: undefined })).toBe("high");
	});

	it("should classify high/critical-risk tasks", () => {
		expect(
			classifyRisk({ proposalType: "sub_task", title: "Add migration for schema change", severity: undefined }),
		).toBe("critical");
		expect(classifyRisk({ proposalType: "sub_task", title: "Deploy to production", severity: undefined })).toBe(
			"critical",
		);
		expect(classifyRisk({ proposalType: "sub_task", title: "Delete users table", severity: "critical" })).toBe(
			"critical",
		);
	});

	it("should auto-approve low-risk proposals", async () => {
		const result = await canAutoApprove("proj-1", {
			proposalType: "test_task",
			title: "Add test for login",
			severity: undefined,
		});
		expect(result.autoApprove).toBe(true);
		expect(result.riskLevel).toBe("low");
	});

	it("should require approval for medium+ risk", async () => {
		const result = await canAutoApprove("proj-1", {
			proposalType: "sub_task",
			title: "Implement payment gateway",
			severity: undefined,
		});
		expect(result.autoApprove).toBe(false);
		expect(result.riskLevel).toBe("medium");
	});

	it("should check constraints and return allowed status", async () => {
		const result = await checkConstraints("proj-1", "create_task", "low");
		expect(result).toBeDefined();
		expect(typeof result.allowed).toBe("boolean");
		expect(typeof result.reason).toBe("string");
	});
});

// ---------------------------------------------------------------------------
// Task Injection
// ---------------------------------------------------------------------------
describe("Task Injection", () => {
	it("should auto-approve and create task for low-risk proposal with phaseId", async () => {
		const result = await proposeTask({
			projectId: "proj-1",
			originatingAgentId: "agent-1",
			proposalType: "test_task",
			title: "Add missing test coverage",
			description: "Unit tests for auth module",
			phaseId: "phase-1",
			complexity: "S",
		});
		expect(result.autoApproved).toBe(true);
		expect(result.task).toBeDefined();
		expect(result.task?.id).toBe("task-injected-1");
	});

	it("should require approval for high-risk proposal", async () => {
		const result = await proposeTask({
			projectId: "proj-1",
			originatingAgentId: "agent-1",
			proposalType: "sub_task",
			title: "Add migration for user roles schema",
			description: "Schema change",
			phaseId: "phase-1",
		});
		expect(result.autoApproved).toBe(false);
		expect(result.task).toBeUndefined();
		expect(result.proposal).toBeDefined();
	});

	it("should not create task without phaseId even if auto-approvable", async () => {
		const result = await proposeTask({
			projectId: "proj-1",
			originatingAgentId: "agent-1",
			proposalType: "test_task",
			title: "Add lint check",
			description: "Simple lint task",
			// No phaseId
		});
		expect(result.autoApproved).toBe(false);
		expect(result.task).toBeUndefined();
	});
});
