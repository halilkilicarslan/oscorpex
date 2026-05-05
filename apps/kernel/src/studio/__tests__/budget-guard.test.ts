// ---------------------------------------------------------------------------
// Oscorpex — Budget Guard Tests
// Cost circuit breaker: auto-pauses pipeline when project budget is exceeded.
// All DB and side-effect dependencies are mocked — no real DB required.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before the module under test is imported.
// vi.mock() calls are hoisted to the top by Vitest regardless of placement,
// but keeping them here makes the intent explicit.
// ---------------------------------------------------------------------------

vi.mock("../db.js", () => ({
	queryOne: vi.fn(),
}));

vi.mock("../event-bus.js", () => ({
	eventBus: { emit: vi.fn() },
}));

vi.mock("../logger.js", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

// pipeline-engine is dynamically imported inside enforceBudgetGuard.
// We mock the ESM module so the dynamic import resolves to our stub.
const mockPausePipeline = vi.fn().mockResolvedValue(undefined);
vi.mock("../pipeline-engine.js", () => ({
	pipelineEngine: () => ({ pausePipeline: mockPausePipeline }),
}));

// ---------------------------------------------------------------------------
// Imports — after mocks are set up.
// ---------------------------------------------------------------------------

import { checkBudget, enforceBudgetGuard } from "../budget-guard.js";
import { queryOne } from "../db.js";
import { eventBus } from "../event-bus.js";

const mockQueryOne = queryOne as ReturnType<typeof vi.fn>;
const mockEmit = eventBus.emit as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the raw DB row shape that queryOne returns. */
function makeRow(totalSpent: number, maxBudget: number | null): { total_spent: string; max_budget: string | null } {
	return {
		total_spent: String(totalSpent),
		max_budget: maxBudget !== null ? String(maxBudget) : null,
	};
}

// ---------------------------------------------------------------------------
// checkBudget
// ---------------------------------------------------------------------------

describe("checkBudget", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// -------------------------------------------------------------------------
	// No budget configured
	// -------------------------------------------------------------------------

	it("returns exceeded=false when no budget is configured (max_budget is null)", async () => {
		mockQueryOne.mockResolvedValue(makeRow(50, null));

		const result = await checkBudget("project-abc");

		expect(result.exceeded).toBe(false);
		expect(result.budgetMaxUsd).toBeNull();
		expect(result.totalSpentUsd).toBe(50);
	});

	it("returns exceeded=false when DB row itself is null (no token usage at all)", async () => {
		mockQueryOne.mockResolvedValue(null);

		const result = await checkBudget("project-no-data");

		expect(result.exceeded).toBe(false);
		expect(result.budgetMaxUsd).toBeNull();
		expect(result.totalSpentUsd).toBe(0);
	});

	it("returns exceeded=false when max_budget is an empty string (misconfigured setting)", async () => {
		// Empty string → Number('') === 0, but the guard treats it like no budget
		// because rawBudget is falsy.
		mockQueryOne.mockResolvedValue({ total_spent: "10", max_budget: "" });

		const result = await checkBudget("project-empty-budget");

		expect(result.exceeded).toBe(false);
		expect(result.budgetMaxUsd).toBeNull();
	});

	// -------------------------------------------------------------------------
	// Budget not exceeded
	// -------------------------------------------------------------------------

	it("returns exceeded=false when spend is strictly below the limit", async () => {
		mockQueryOne.mockResolvedValue(makeRow(4.99, 5.0));

		const result = await checkBudget("project-under");

		expect(result.exceeded).toBe(false);
		expect(result.budgetMaxUsd).toBe(5.0);
		expect(result.totalSpentUsd).toBe(4.99);
	});

	it("returns exceeded=false when spend is zero and budget is set", async () => {
		mockQueryOne.mockResolvedValue(makeRow(0, 100));

		const result = await checkBudget("project-fresh");

		expect(result.exceeded).toBe(false);
		expect(result.totalSpentUsd).toBe(0);
		expect(result.budgetMaxUsd).toBe(100);
	});

	// -------------------------------------------------------------------------
	// Budget exactly at the limit (boundary)
	// -------------------------------------------------------------------------

	it("returns exceeded=true when spend equals the budget limit (>= boundary)", async () => {
		mockQueryOne.mockResolvedValue(makeRow(10.0, 10.0));

		const result = await checkBudget("project-exact");

		expect(result.exceeded).toBe(true);
		expect(result.totalSpentUsd).toBe(10.0);
		expect(result.budgetMaxUsd).toBe(10.0);
	});

	// -------------------------------------------------------------------------
	// Budget exceeded
	// -------------------------------------------------------------------------

	it("returns exceeded=true when spend is above the limit", async () => {
		mockQueryOne.mockResolvedValue(makeRow(25.5, 20.0));

		const result = await checkBudget("project-over");

		expect(result.exceeded).toBe(true);
		expect(result.totalSpentUsd).toBe(25.5);
		expect(result.budgetMaxUsd).toBe(20.0);
	});

	// -------------------------------------------------------------------------
	// Zero budget edge case
	// -------------------------------------------------------------------------

	it("returns exceeded=true when budget cap is zero and any spend exists", async () => {
		mockQueryOne.mockResolvedValue(makeRow(0.01, 0));

		const result = await checkBudget("project-zero-budget");

		// makeRow converts 0 → "0", which is a non-empty (truthy) string.
		// Source: `rawBudget ? Number(rawBudget) : null` → Number("0") = 0.
		// So budgetMaxUsd = 0, and 0.01 >= 0 → exceeded=true.
		expect(result.budgetMaxUsd).toBe(0);
		expect(result.exceeded).toBe(true);
	});

	it("passes the projectId to queryOne as a parameter", async () => {
		mockQueryOne.mockResolvedValue(makeRow(0, null));

		await checkBudget("my-project-id");

		expect(mockQueryOne).toHaveBeenCalledOnce();
		const [_sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
		expect(params).toEqual(["my-project-id"]);
	});

	it("queries both projectId occurrences in the single atomic SQL statement", async () => {
		mockQueryOne.mockResolvedValue(makeRow(0, null));

		await checkBudget("proj-xyz");

		const [sql] = mockQueryOne.mock.calls[0] as [string, unknown[]];
		// The atomic CTE query references $1 twice (once in the CTE, once in the FROM clause).
		const paramOccurrences = (sql.match(/\$1/g) ?? []).length;
		expect(paramOccurrences).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// enforceBudgetGuard
// ---------------------------------------------------------------------------

describe("enforceBudgetGuard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// -------------------------------------------------------------------------
	// Budget not exceeded — happy path
	// -------------------------------------------------------------------------

	it("returns false and does not pause pipeline when budget is not exceeded", async () => {
		mockQueryOne.mockResolvedValue(makeRow(5, 100));

		const exceeded = await enforceBudgetGuard("project-safe");

		expect(exceeded).toBe(false);
		expect(mockPausePipeline).not.toHaveBeenCalled();
		expect(mockEmit).not.toHaveBeenCalled();
	});

	it("returns false and does not emit events when no budget is configured", async () => {
		mockQueryOne.mockResolvedValue(makeRow(999, null));

		const exceeded = await enforceBudgetGuard("project-no-budget");

		expect(exceeded).toBe(false);
		expect(mockEmit).not.toHaveBeenCalled();
		expect(mockPausePipeline).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// Budget exceeded — circuit breaker triggers
	// -------------------------------------------------------------------------

	it("returns true when budget is exceeded", async () => {
		mockQueryOne.mockResolvedValue(makeRow(55.0, 50.0));

		const exceeded = await enforceBudgetGuard("project-breached");

		expect(exceeded).toBe(true);
	});

	it("emits a budget:halted event with correct payload when budget is exceeded", async () => {
		mockQueryOne.mockResolvedValue(makeRow(75.25, 50.0));

		await enforceBudgetGuard("project-halted");

		expect(mockEmit).toHaveBeenCalledOnce();
		const emitArg = mockEmit.mock.calls[0][0] as {
			projectId: string;
			type: string;
			payload: { totalSpentUsd: number; budgetMaxUsd: number | null; message: string };
		};
		expect(emitArg.projectId).toBe("project-halted");
		expect(emitArg.type).toBe("budget:halted");
		expect(emitArg.payload.totalSpentUsd).toBe(75.25);
		expect(emitArg.payload.budgetMaxUsd).toBe(50.0);
		expect(emitArg.payload.message).toMatch(/75\.25/);
		expect(emitArg.payload.message).toMatch(/50\.00/);
	});

	it("calls pausePipeline with the correct projectId when budget is exceeded", async () => {
		mockQueryOne.mockResolvedValue(makeRow(200, 100));

		await enforceBudgetGuard("project-to-pause");

		expect(mockPausePipeline).toHaveBeenCalledOnce();
		expect(mockPausePipeline).toHaveBeenCalledWith("project-to-pause");
	});

	// -------------------------------------------------------------------------
	// Exactly at the limit (>= boundary triggers the guard)
	// -------------------------------------------------------------------------

	it("triggers the guard when spend equals the budget limit exactly", async () => {
		mockQueryOne.mockResolvedValue(makeRow(10.0, 10.0));

		const exceeded = await enforceBudgetGuard("project-exact-limit");

		expect(exceeded).toBe(true);
		expect(mockEmit).toHaveBeenCalledOnce();
		expect(mockPausePipeline).toHaveBeenCalledOnce();
	});

	// -------------------------------------------------------------------------
	// Resilience: pausePipeline failure must not propagate
	// -------------------------------------------------------------------------

	it("still returns true even if pausePipeline throws (error is swallowed)", async () => {
		mockQueryOne.mockResolvedValue(makeRow(300, 100));
		mockPausePipeline.mockRejectedValueOnce(new Error("DB connection lost"));

		// Must not throw — the error is caught internally and logged.
		const exceeded = await enforceBudgetGuard("project-pause-failure");

		expect(exceeded).toBe(true);
	});

	it("still emits budget:halted even if pausePipeline throws", async () => {
		mockQueryOne.mockResolvedValue(makeRow(300, 100));
		mockPausePipeline.mockRejectedValueOnce(new Error("pause failed"));

		await enforceBudgetGuard("project-emit-despite-failure");

		// Event must have been emitted before the pause attempt fails.
		expect(mockEmit).toHaveBeenCalledOnce();
		expect(mockEmit.mock.calls[0][0]).toMatchObject({ type: "budget:halted" });
	});

	// -------------------------------------------------------------------------
	// Ordering: event emitted before pause attempt
	// -------------------------------------------------------------------------

	it("emits the event before calling pausePipeline", async () => {
		const callOrder: string[] = [];
		mockQueryOne.mockResolvedValue(makeRow(60, 50));
		mockEmit.mockImplementation(() => {
			callOrder.push("emit");
		});
		mockPausePipeline.mockImplementation(async () => {
			callOrder.push("pause");
		});

		await enforceBudgetGuard("project-order");

		expect(callOrder).toEqual(["emit", "pause"]);
	});
});
