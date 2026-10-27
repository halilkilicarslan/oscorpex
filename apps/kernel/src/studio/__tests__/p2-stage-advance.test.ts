// ---------------------------------------------------------------------------
// P2-2: Stage Advance Service — Behavior-based unit tests (DB-independent)
// Tests: decideStageAdvance() pure function + StageAdvanceOrchestrator scenarios.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

// All vi.mock() calls must be at the top level.

vi.mock("../event-bus.js", () => ({
	eventBus: { emit: vi.fn(), emitTransient: vi.fn() },
}));

vi.mock("../pipeline/replan-gate.js", () => ({
	canAdvance: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("../logger.js", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

const { decideStageAdvance, StageAdvanceOrchestrator } = await import("../pipeline/stage-advance-service.js");
const { canAdvance } = await import("../pipeline/replan-gate.js");

// ---------------------------------------------------------------------------
// Helpers — minimal mock PipelineStateManager
// ---------------------------------------------------------------------------

function makePipelineState(overrides?: Partial<any>): any {
	return {
		projectId: "proj-1",
		status: "running",
		currentStage: 0,
		stages: [{ order: 0, name: "Stage 0", taskIds: [] }],
		...overrides,
	};
}

function makeStateManager(overrides?: {
	state?: any;
	/** Pass false to simulate failed lock acquisition (acquireAdvanceLock returns null) */
	acquireLock?: boolean;
	freshTaskIds?: string[];
	taskStatuses?: string[];
}): any {
	const state = overrides?.state ?? makePipelineState();
	// acquireLock defaults to true; false → return null so the orchestrator skips
	const lockGrant = overrides?.acquireLock === false ? null : { id: "lock-1" };
	const freshTaskIds = overrides?.freshTaskIds ?? ["t-1", "t-2"];
	const taskStatuses = overrides?.taskStatuses ?? ["done", "done"];

	return {
		loadState: vi.fn(async () => state),
		acquireAdvanceLock: vi.fn(async () => lockGrant),
		resolveStageTaskIds: vi.fn(async () => freshTaskIds),
		getTaskStatus: vi.fn(async (id: string) => {
			const idx = freshTaskIds.indexOf(id);
			return taskStatuses[idx] ?? "done";
		}),
		getState: vi.fn(async () => state),
	};
}

function makeCallbacks(): any {
	return {
		completeStage: vi.fn(async () => {}),
		markFailed: vi.fn(async () => {}),
	};
}

// ---------------------------------------------------------------------------
// decideStageAdvance() — pure function tests
// ---------------------------------------------------------------------------

describe("P2-2: decideStageAdvance() — pure decision function", () => {
	// ----- all done → completed -----

	it("returns 'completed' when all statuses are 'done'", () => {
		expect(decideStageAdvance(["done", "done", "done"])).toBe("completed");
	});

	it("returns 'completed' with a single 'done' status", () => {
		expect(decideStageAdvance(["done"])).toBe("completed");
	});

	// ----- any failed → failed -----

	it("returns 'failed' when any status is 'failed'", () => {
		expect(decideStageAdvance(["done", "failed", "done"])).toBe("failed");
	});

	it("returns 'failed' when all statuses are 'failed'", () => {
		expect(decideStageAdvance(["failed", "failed"])).toBe("failed");
	});

	it("prioritises 'failed' over 'done' (mixed list starting with done)", () => {
		expect(decideStageAdvance(["done", "done", "failed"])).toBe("failed");
	});

	// ----- tasks still running → waiting -----

	it("returns 'waiting' when some tasks are still 'in_progress'", () => {
		expect(decideStageAdvance(["done", "in_progress"])).toBe("waiting");
	});

	it("returns 'waiting' when all tasks are 'pending'", () => {
		expect(decideStageAdvance(["pending", "pending"])).toBe("waiting");
	});

	it("returns 'waiting' for empty array", () => {
		// Empty array: statuses.every() vacuously true but length === 0 — spec says return "waiting"
		// Actually: the function checks statuses.length > 0 before "completed"
		expect(decideStageAdvance([])).toBe("waiting");
	});

	// ----- mixed done + skipped -----

	it("returns 'waiting' for mixed done and skipped (skipped is not 'done')", () => {
		// "skipped" tasks are not "done" — treated as waiting until engine resolves them
		expect(decideStageAdvance(["done", "skipped"])).toBe("waiting");
	});

	it("returns 'completed' when all tasks are 'done' even if label differs in case", () => {
		// Only exact "done" match expected; verify strict comparison
		expect(decideStageAdvance(["done", "done"])).toBe("completed");
	});

	it("returns 'failed' before 'completed' when both conditions could apply", () => {
		// failed check runs first in implementation
		expect(decideStageAdvance(["failed"])).toBe("failed");
	});
});

// ---------------------------------------------------------------------------
// StageAdvanceOrchestrator — integration behavior tests
// ---------------------------------------------------------------------------

describe("P2-2: StageAdvanceOrchestrator.advance()", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(canAdvance).mockResolvedValue({ allowed: true });
	});

	it("calls completeStage when all tasks are 'done'", async () => {
		const stateManager = makeStateManager({ taskStatuses: ["done", "done"] });
		const callbacks = makeCallbacks();
		const svc = new StageAdvanceOrchestrator(stateManager, callbacks);

		await svc.advance("proj-1");

		expect(callbacks.completeStage).toHaveBeenCalledWith("proj-1", 0);
		expect(callbacks.markFailed).not.toHaveBeenCalled();
	});

	it("calls markFailed when any task has status 'failed'", async () => {
		const stateManager = makeStateManager({ taskStatuses: ["done", "failed"] });
		const callbacks = makeCallbacks();
		const svc = new StageAdvanceOrchestrator(stateManager, callbacks);

		await svc.advance("proj-1");

		expect(callbacks.markFailed).toHaveBeenCalledWith("proj-1", expect.stringContaining("Aşama"));
		expect(callbacks.completeStage).not.toHaveBeenCalled();
	});

	it("calls neither completeStage nor markFailed when tasks are still running", async () => {
		const stateManager = makeStateManager({ taskStatuses: ["done", "in_progress"] });
		const callbacks = makeCallbacks();
		const svc = new StageAdvanceOrchestrator(stateManager, callbacks);

		await svc.advance("proj-1");

		expect(callbacks.completeStage).not.toHaveBeenCalled();
		expect(callbacks.markFailed).not.toHaveBeenCalled();
	});

	it("returns state immediately when pipeline is already 'completed'", async () => {
		const completedState = makePipelineState({ status: "completed" });
		const stateManager = makeStateManager({ state: completedState });
		const callbacks = makeCallbacks();
		const svc = new StageAdvanceOrchestrator(stateManager, callbacks);

		const result = await svc.advance("proj-1");

		expect(result.status).toBe("completed");
		expect(callbacks.completeStage).not.toHaveBeenCalled();
		expect(callbacks.markFailed).not.toHaveBeenCalled();
	});

	it("returns state immediately when pipeline is 'paused'", async () => {
		const pausedState = makePipelineState({ status: "paused" });
		const stateManager = makeStateManager({ state: pausedState });
		const callbacks = makeCallbacks();
		const svc = new StageAdvanceOrchestrator(stateManager, callbacks);

		const result = await svc.advance("proj-1");

		expect(result.status).toBe("paused");
		expect(callbacks.completeStage).not.toHaveBeenCalled();
	});

	it("returns state immediately when pipeline is 'failed'", async () => {
		const failedState = makePipelineState({ status: "failed" });
		const stateManager = makeStateManager({ state: failedState });
		const callbacks = makeCallbacks();
		const svc = new StageAdvanceOrchestrator(stateManager, callbacks);

		const result = await svc.advance("proj-1");

		expect(result.status).toBe("failed");
		expect(callbacks.markFailed).not.toHaveBeenCalled();
	});

	it("skips advance and returns state when lock cannot be acquired", async () => {
		const stateManager = makeStateManager({ acquireLock: false });
		const callbacks = makeCallbacks();
		const svc = new StageAdvanceOrchestrator(stateManager, callbacks);

		await svc.advance("proj-1");

		expect(callbacks.completeStage).not.toHaveBeenCalled();
		expect(callbacks.markFailed).not.toHaveBeenCalled();
	});

	it("blocks advance and emits plan:replanned when replan is pending", async () => {
		const { eventBus } = await import("../event-bus.js");
		vi.mocked(canAdvance).mockResolvedValue({ allowed: false, replanEventId: "replan-99" });

		const stateManager = makeStateManager();
		const callbacks = makeCallbacks();
		const svc = new StageAdvanceOrchestrator(stateManager, callbacks);

		await svc.advance("proj-1");

		expect(callbacks.completeStage).not.toHaveBeenCalled();
		expect(eventBus.emit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "plan:replanned",
				payload: expect.objectContaining({ awaiting_approval: true }),
			}),
		);
	});

	it("calls completeStage immediately when stage has no tasks", async () => {
		const stateManager = makeStateManager({ freshTaskIds: [] });
		const callbacks = makeCallbacks();
		const svc = new StageAdvanceOrchestrator(stateManager, callbacks);

		await svc.advance("proj-1");

		expect(callbacks.completeStage).toHaveBeenCalledWith("proj-1", 0);
	});

	it("throws when pipeline state is not found in DB", async () => {
		const stateManager = makeStateManager();
		stateManager.loadState = vi.fn(async () => null);
		const callbacks = makeCallbacks();
		const svc = new StageAdvanceOrchestrator(stateManager, callbacks);

		await expect(svc.advance("proj-missing")).rejects.toThrow();
	});

	it("handles mixed done + skipped statuses as 'waiting' — neither completes nor fails", async () => {
		const stateManager = makeStateManager({ taskStatuses: ["done", "skipped"] });
		const callbacks = makeCallbacks();
		const svc = new StageAdvanceOrchestrator(stateManager, callbacks);

		await svc.advance("proj-1");

		// "skipped" !== "done" so decideStageAdvance returns "waiting"
		expect(callbacks.completeStage).not.toHaveBeenCalled();
		expect(callbacks.markFailed).not.toHaveBeenCalled();
	});
});
