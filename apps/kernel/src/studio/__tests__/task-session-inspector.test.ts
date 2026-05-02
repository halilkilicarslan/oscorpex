// ---------------------------------------------------------------------------
// Oscorpex — Task Session Inspector Tests
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock DB layer
// ---------------------------------------------------------------------------
const mockGetTaskForInspector = vi.fn();
const mockGetAgentForInspector = vi.fn();
const mockGetSessionForTask = vi.fn();
const mockListTokenUsageForTask = vi.fn();
const mockListEventsForTask = vi.fn();
const mockListEpisodesForTask = vi.fn();
const mockListTaskDiffs = vi.fn();
const mockListVerificationResults = vi.fn();

vi.mock("../db/inspector-repo.js", () => ({
	getTaskForInspector: (...args: any[]) => mockGetTaskForInspector(...args),
	getAgentForInspector: (...args: any[]) => mockGetAgentForInspector(...args),
	getSessionForTask: (...args: any[]) => mockGetSessionForTask(...args),
	listTokenUsageForTask: (...args: any[]) => mockListTokenUsageForTask(...args),
	listEventsForTask: (...args: any[]) => mockListEventsForTask(...args),
	listEpisodesForTask: (...args: any[]) => mockListEpisodesForTask(...args),
	listTaskDiffs: (...args: any[]) => mockListTaskDiffs(...args),
	listVerificationResults: (...args: any[]) => mockListVerificationResults(...args),
}));

vi.mock("../logger.js", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

import { getTaskSessionInspector } from "../inspector/task-session-inspector-service.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = "proj-1";
const TASK_ID = "task-1";

function makeTaskRow(overrides: Record<string, unknown> = {}) {
	return {
		id: TASK_ID,
		phase_id: "phase-1",
		project_id: PROJECT_ID,
		title: "Implement login",
		status: "done",
		complexity: "M",
		task_type: "ai",
		assigned_agent: "developer",
		assigned_agent_id: "agent-1",
		retry_count: 0,
		revision_count: 0,
		depends_on: "[]",
		branch: "main",
		output: null,
		error: null,
		started_at: new Date("2026-01-01T10:00:00Z"),
		completed_at: new Date("2026-01-01T10:05:00Z"),
		created_at: new Date("2026-01-01T09:55:00Z"),
		...overrides,
	};
}

function makeSessionRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "session-1",
		project_id: PROJECT_ID,
		agent_id: "agent-1",
		task_id: TASK_ID,
		strategy: "scaffold_then_refine",
		status: "completed",
		steps_completed: 4,
		max_steps: 10,
		observations: [
			{ step: 1, type: "context_loaded", summary: "Loaded project context", timestamp: "2026-01-01T10:00:01Z" },
			{ step: 2, type: "strategy_selected", summary: "Selected scaffold strategy", timestamp: "2026-01-01T10:00:02Z" },
		],
		started_at: new Date("2026-01-01T10:00:00Z"),
		completed_at: new Date("2026-01-01T10:05:00Z"),
		created_at: new Date("2026-01-01T10:00:00Z"),
		...overrides,
	};
}

function makeUsageRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "usage-1",
		project_id: PROJECT_ID,
		task_id: TASK_ID,
		agent_id: "agent-1",
		model: "claude-sonnet-4",
		provider: "claude",
		input_tokens: 1000,
		output_tokens: 500,
		total_tokens: 1500,
		cost_usd: 0.0123,
		cache_creation_tokens: 0,
		cache_read_tokens: 200,
		created_at: new Date("2026-01-01T10:01:00Z"),
		...overrides,
	};
}

function resetMocks() {
	mockGetTaskForInspector.mockReset().mockResolvedValue(undefined);
	mockGetAgentForInspector.mockReset().mockResolvedValue(undefined);
	mockGetSessionForTask.mockReset().mockResolvedValue(undefined);
	mockListTokenUsageForTask.mockReset().mockResolvedValue([]);
	mockListEventsForTask.mockReset().mockResolvedValue([]);
	mockListEpisodesForTask.mockReset().mockResolvedValue([]);
	mockListTaskDiffs.mockReset().mockResolvedValue([]);
	mockListVerificationResults.mockReset().mockResolvedValue([]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TaskSessionInspector", () => {
	beforeEach(() => {
		resetMocks();
	});

	it("returns null for missing task", async () => {
		mockGetTaskForInspector.mockResolvedValue(undefined);
		const result = await getTaskSessionInspector(PROJECT_ID, TASK_ID);
		expect(result).toBeNull();
	});

	it("returns null when task belongs to different project", async () => {
		mockGetTaskForInspector.mockResolvedValue(makeTaskRow({ project_id: "other-project" }));
		const result = await getTaskSessionInspector(PROJECT_ID, TASK_ID);
		expect(result).toBeNull();
	});

	it("returns task-only inspector when no session exists", async () => {
		mockGetTaskForInspector.mockResolvedValue(makeTaskRow());
		const result = await getTaskSessionInspector(PROJECT_ID, TASK_ID);

		expect(result).not.toBeNull();
		expect(result!.task.id).toBe(TASK_ID);
		expect(result!.task.title).toBe("Implement login");
		expect(result!.task.status).toBe("done");
		expect(result!.session).toBeUndefined();
		expect(result!.warnings).toContainEqual(
			expect.objectContaining({ code: "NO_SESSION" }),
		);
	});

	it("includes session when exists", async () => {
		mockGetTaskForInspector.mockResolvedValue(makeTaskRow());
		mockGetSessionForTask.mockResolvedValue(makeSessionRow());

		const result = await getTaskSessionInspector(PROJECT_ID, TASK_ID);

		expect(result!.session).toBeDefined();
		expect(result!.session!.id).toBe("session-1");
		expect(result!.session!.status).toBe("completed");
		expect(result!.session!.strategy).toBe("scaffold_then_refine");
		expect(result!.session!.stepsCompleted).toBe(4);
		expect(result!.session!.durationMs).toBe(300000); // 5 minutes
	});

	it("includes observations sorted from session", async () => {
		mockGetTaskForInspector.mockResolvedValue(makeTaskRow());
		mockGetSessionForTask.mockResolvedValue(makeSessionRow());

		const result = await getTaskSessionInspector(PROJECT_ID, TASK_ID);

		expect(result!.observations).toHaveLength(2);
		expect(result!.observations[0].step).toBe(1);
		expect(result!.observations[0].type).toBe("context_loaded");
		expect(result!.observations[1].step).toBe(2);
	});

	it("aggregates token usage", async () => {
		mockGetTaskForInspector.mockResolvedValue(makeTaskRow());
		mockListTokenUsageForTask.mockResolvedValue([
			makeUsageRow({ input_tokens: 1000, output_tokens: 500, total_tokens: 1500, cost_usd: 0.01 }),
			makeUsageRow({ id: "usage-2", input_tokens: 2000, output_tokens: 1000, total_tokens: 3000, cost_usd: 0.02 }),
		]);

		const result = await getTaskSessionInspector(PROJECT_ID, TASK_ID);

		expect(result!.usage).toBeDefined();
		expect(result!.usage!.inputTokens).toBe(3000);
		expect(result!.usage!.outputTokens).toBe(1500);
		expect(result!.usage!.totalTokens).toBe(4500);
		expect(result!.usage!.costUsd).toBeCloseTo(0.03);
	});

	it("generates warnings for missing optional data", async () => {
		mockGetTaskForInspector.mockResolvedValue(makeTaskRow());

		const result = await getTaskSessionInspector(PROJECT_ID, TASK_ID);

		expect(result!.warnings).toContainEqual(expect.objectContaining({ code: "NO_SESSION" }));
		expect(result!.warnings).toContainEqual(expect.objectContaining({ code: "NO_USAGE" }));
		expect(result!.warnings).toContainEqual(expect.objectContaining({ code: "NO_EPISODES" }));
	});

	it("includes strategy from session", async () => {
		mockGetTaskForInspector.mockResolvedValue(makeTaskRow());
		mockGetSessionForTask.mockResolvedValue(makeSessionRow());

		const result = await getTaskSessionInspector(PROJECT_ID, TASK_ID);

		expect(result!.strategy).toBeDefined();
		expect(result!.strategy!.name).toBe("scaffold_then_refine");
	});

	it("includes strategy from event when available", async () => {
		mockGetTaskForInspector.mockResolvedValue(makeTaskRow());
		mockGetSessionForTask.mockResolvedValue(makeSessionRow());
		mockListEventsForTask.mockResolvedValue([
			{
				id: "evt-1",
				type: "agent:strategy_selected",
				payload: JSON.stringify({ strategy: "test_driven", confidence: 0.85, reason: "Tests first" }),
				timestamp: new Date("2026-01-01T10:00:01Z"),
			},
		]);

		const result = await getTaskSessionInspector(PROJECT_ID, TASK_ID);

		expect(result!.strategy!.name).toBe("test_driven");
		expect(result!.strategy!.confidence).toBe(0.85);
		expect(result!.strategy!.reason).toBe("Tests first");
	});

	it("builds timeline with task lifecycle events sorted by timestamp", async () => {
		mockGetTaskForInspector.mockResolvedValue(makeTaskRow());
		mockGetSessionForTask.mockResolvedValue(makeSessionRow());

		const result = await getTaskSessionInspector(PROJECT_ID, TASK_ID);

		expect(result!.timeline.length).toBeGreaterThan(0);
		// Verify sorted
		for (let i = 1; i < result!.timeline.length; i++) {
			const a = result!.timeline[i - 1].timestamp;
			const b = result!.timeline[i].timestamp;
			if (a && b) {
				expect(new Date(a).getTime()).toBeLessThanOrEqual(new Date(b).getTime());
			}
		}
	});

	it("includes gate results from verification_results", async () => {
		mockGetTaskForInspector.mockResolvedValue(makeTaskRow());
		mockListVerificationResults.mockResolvedValue([
			{ id: "vr-1", task_id: TASK_ID, verification_type: "test", status: "passed", details: "{}", created_at: new Date() },
			{ id: "vr-2", task_id: TASK_ID, verification_type: "sandbox", status: "failed", details: '{"reason":"path escape"}', created_at: new Date() },
		]);

		const result = await getTaskSessionInspector(PROJECT_ID, TASK_ID);

		expect(result!.gates).toHaveLength(2);
		expect(result!.gates[0].name).toBe("test");
		expect(result!.gates[0].status).toBe("passed");
		expect(result!.gates[1].name).toBe("sandbox");
		expect(result!.gates[1].status).toBe("failed");
	});

	it("includes output files from task_diffs", async () => {
		mockGetTaskForInspector.mockResolvedValue(makeTaskRow());
		mockListTaskDiffs.mockResolvedValue([
			{ file_path: "src/login.ts", diff_type: "created", lines_added: 50, lines_removed: 0 },
			{ file_path: "src/auth.ts", diff_type: "modified", lines_added: 10, lines_removed: 3 },
		]);

		const result = await getTaskSessionInspector(PROJECT_ID, TASK_ID);

		expect(result!.output).toBeDefined();
		expect(result!.output!.filesCreated).toContain("src/login.ts");
		expect(result!.output!.filesModified).toContain("src/auth.ts");
	});

	it("does not expose sensitive keys in raw data", async () => {
		mockGetTaskForInspector.mockResolvedValue(
			makeTaskRow({ api_key: "sk-secret-123", token: "jwt-token-456" }),
		);

		const result = await getTaskSessionInspector(PROJECT_ID, TASK_ID);

		const rawTask = result!.raw?.task as Record<string, unknown>;
		expect(rawTask.api_key).toBe("[REDACTED]");
		expect(rawTask.token).toBe("[REDACTED]");
		// Normal fields should be present
		expect(rawTask.title).toBe("Implement login");
	});

	it("resolves agent by ID", async () => {
		mockGetTaskForInspector.mockResolvedValue(makeTaskRow());
		mockGetAgentForInspector.mockResolvedValue({
			id: "agent-1",
			name: "Backend Dev",
			role: "developer",
		});

		const result = await getTaskSessionInspector(PROJECT_ID, TASK_ID);

		expect(result!.agent).toBeDefined();
		expect(result!.agent!.name).toBe("Backend Dev");
		expect(result!.agent!.role).toBe("developer");
	});

	it("includes execution summary from episodes", async () => {
		mockGetTaskForInspector.mockResolvedValue(makeTaskRow());
		mockListEpisodesForTask.mockResolvedValue([
			{
				id: "ep-1",
				project_id: PROJECT_ID,
				agent_id: "agent-1",
				task_id: TASK_ID,
				task_type: "ai",
				strategy: "scaffold",
				action_summary: "Generated login form",
				outcome: "success",
				cost_usd: 0.015,
				duration_ms: 45000,
				created_at: new Date("2026-01-01T10:02:00Z"),
			},
		]);

		const result = await getTaskSessionInspector(PROJECT_ID, TASK_ID);

		expect(result!.execution).toBeDefined();
		expect(result!.execution!.latencyMs).toBe(45000);
		expect(result!.execution!.costUsd).toBe(0.015);
	});
});
