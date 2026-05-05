// ---------------------------------------------------------------------------
// Unit Tests: graph-coordinator.ts — DAG invariant validation
//
// All DB access is mocked. Focus is on the pure graph validation logic:
//   - validateAddEdge / wouldCreateCycle (cycle detection DFS)
//   - Self-edge prevention
//   - Duplicate edge prevention
//   - Task-not-found guard
//   - Valid edge mutations (no invariant violation)
//   - Diamond patterns (valid DAGs with shared ancestors)
//   - Edge removal correctness
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// DB mock — must be hoisted before any module import that transitively
// requires db.js.  The mock factory is called lazily so we can override
// individual mock implementations per-test via the imported spy references.
// ---------------------------------------------------------------------------

vi.mock("../db.js", () => ({
	getTask: vi.fn(),
	updateTask: vi.fn().mockResolvedValue(undefined),
	createTask: vi.fn(),
	listProjectTasks: vi.fn().mockResolvedValue([]),
	recordGraphMutation: vi.fn().mockImplementation(async (params: Record<string, unknown>) => ({
		id: "mutation-id-1",
		...params,
	})),
	updateGraphMutation: vi.fn().mockResolvedValue(undefined),
	getGraphMutation: vi.fn(),
	getPipelineRun: vi.fn().mockResolvedValue(null),
	listGraphMutations: vi.fn().mockResolvedValue([]),
}));

vi.mock("../event-bus.js", () => ({
	eventBus: {
		emit: vi.fn(),
		emitTransient: vi.fn(),
		on: vi.fn().mockReturnValue(() => undefined),
	},
}));

// ---------------------------------------------------------------------------
// Imports — after mocks are registered
// ---------------------------------------------------------------------------

import { getTask, recordGraphMutation, updateTask } from "../db.js";
import { GraphInvariantError, addEdge, removeEdge } from "../graph-coordinator.js";
import type { MutationContext } from "../graph-coordinator.js";

// ---------------------------------------------------------------------------
// Typed spy references for per-test configuration
// ---------------------------------------------------------------------------

const mockGetTask = getTask as ReturnType<typeof vi.fn>;
const mockUpdateTask = updateTask as ReturnType<typeof vi.fn>;
const mockRecordGraphMutation = recordGraphMutation as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

/** Minimal Task stub with only the fields graph-coordinator reads. */
function makeTask(id: string, dependsOn: string[] = []) {
	return {
		id,
		phaseId: "phase-1",
		title: `Task ${id}`,
		status: "queued" as const,
		dependsOn,
		assignedAgent: "backend_dev",
		branch: "main",
	};
}

/**
 * Build a getTask mock that resolves based on a lookup map.
 * Tasks not present in the map resolve to null (not found).
 */
function buildGetTaskMock(tasks: Record<string, ReturnType<typeof makeTask>>) {
	return async (id: string) => tasks[id] ?? null;
}

const ctx: MutationContext = {
	projectId: "proj-test",
	pipelineRunId: "run-test",
	causedByAgentId: "agent-1",
};

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("GraphInvariantError", () => {
	it("is an instance of Error", () => {
		const err = new GraphInvariantError("cycle", "test cycle message");
		expect(err).toBeInstanceOf(Error);
	});

	it("has name set to GraphInvariantError", () => {
		const err = new GraphInvariantError("self_edge", "self edge");
		expect(err.name).toBe("GraphInvariantError");
	});

	it("exposes the violation property", () => {
		const violations = ["cycle", "self_edge", "duplicate_edge", "task_not_found", "phase_crossing"] as const;
		for (const v of violations) {
			const err = new GraphInvariantError(v, "msg");
			expect(err.violation).toBe(v);
		}
	});

	it("preserves the message", () => {
		const msg = "Adding edge A→B would create a cycle";
		const err = new GraphInvariantError("cycle", msg);
		expect(err.message).toBe(msg);
	});
});

// ---------------------------------------------------------------------------

describe("validateAddEdge — self-edge prevention", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRecordGraphMutation.mockImplementation(async (params: Record<string, unknown>) => ({
			id: "mutation-id-1",
			...params,
		}));
	});

	it("throws GraphInvariantError(self_edge) when fromTaskId === toTaskId", async () => {
		await expect(addEdge(ctx, { fromTaskId: "task-A", toTaskId: "task-A" })).rejects.toThrow(GraphInvariantError);
	});

	it("error violation is 'self_edge'", async () => {
		let caught: unknown;
		try {
			await addEdge(ctx, { fromTaskId: "task-A", toTaskId: "task-A" });
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(GraphInvariantError);
		expect((caught as GraphInvariantError).violation).toBe("self_edge");
	});

	it("does NOT call getTask when a self-edge is detected (fast-path exit)", async () => {
		await expect(addEdge(ctx, { fromTaskId: "x", toTaskId: "x" })).rejects.toThrow(GraphInvariantError);
		expect(mockGetTask).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------

describe("validateAddEdge — task_not_found guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRecordGraphMutation.mockImplementation(async (params: Record<string, unknown>) => ({
			id: "mutation-id-1",
			...params,
		}));
	});

	it("throws task_not_found when source task does not exist", async () => {
		mockGetTask.mockResolvedValue(null); // both tasks missing

		let caught: unknown;
		try {
			await addEdge(ctx, { fromTaskId: "missing-from", toTaskId: "task-B" });
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(GraphInvariantError);
		expect((caught as GraphInvariantError).violation).toBe("task_not_found");
	});

	it("throws task_not_found when target task does not exist", async () => {
		mockGetTask.mockImplementation(async (id: string) => {
			if (id === "task-A") return makeTask("task-A");
			return null; // target missing
		});

		let caught: unknown;
		try {
			await addEdge(ctx, { fromTaskId: "task-A", toTaskId: "missing-to" });
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(GraphInvariantError);
		expect((caught as GraphInvariantError).violation).toBe("task_not_found");
	});
});

// ---------------------------------------------------------------------------

describe("validateAddEdge — duplicate edge prevention", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRecordGraphMutation.mockImplementation(async (params: Record<string, unknown>) => ({
			id: "mutation-id-1",
			...params,
		}));
	});

	it("throws duplicate_edge when the same edge is added twice", async () => {
		// task-B already depends on task-A
		const tasks = {
			"task-A": makeTask("task-A"),
			"task-B": makeTask("task-B", ["task-A"]),
		};
		mockGetTask.mockImplementation(buildGetTaskMock(tasks));

		let caught: unknown;
		try {
			await addEdge(ctx, { fromTaskId: "task-A", toTaskId: "task-B" });
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(GraphInvariantError);
		expect((caught as GraphInvariantError).violation).toBe("duplicate_edge");
	});

	it("does not throw when the edge does not yet exist", async () => {
		const tasks = {
			"task-A": makeTask("task-A"),
			"task-B": makeTask("task-B"), // no deps
		};
		mockGetTask.mockImplementation(buildGetTaskMock(tasks));

		await expect(addEdge(ctx, { fromTaskId: "task-A", toTaskId: "task-B" })).resolves.toMatchObject({
			success: true,
			mutationType: "add_edge",
		});
	});
});

// ---------------------------------------------------------------------------

describe("validateAddEdge — cycle detection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRecordGraphMutation.mockImplementation(async (params: Record<string, unknown>) => ({
			id: "mutation-id-1",
			...params,
		}));
	});

	it("throws cycle for a direct back-edge: A→B then B→A", async () => {
		// Existing graph: B depends on A  (A → B)
		// Trying to add: A depends on B  (B → A) — direct cycle
		const tasks = {
			"task-A": makeTask("task-A"),
			"task-B": makeTask("task-B", ["task-A"]),
		};
		mockGetTask.mockImplementation(buildGetTaskMock(tasks));

		let caught: unknown;
		try {
			// addEdge(from, to) means: toTask.dependsOn += from
			// So addEdge(B, A) means A will depend on B.
			// B already depends on A → cycle: A→B→A
			await addEdge(ctx, { fromTaskId: "task-B", toTaskId: "task-A" });
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(GraphInvariantError);
		expect((caught as GraphInvariantError).violation).toBe("cycle");
	});

	it("throws cycle for a transitive chain: A→B→C, trying C→A", async () => {
		// Graph: B depends on A, C depends on B  (A → B → C)
		// Adding A depends on C would close the cycle  (C → A)
		const tasks = {
			"task-A": makeTask("task-A"),
			"task-B": makeTask("task-B", ["task-A"]),
			"task-C": makeTask("task-C", ["task-B"]),
		};
		mockGetTask.mockImplementation(buildGetTaskMock(tasks));

		let caught: unknown;
		try {
			// addEdge(C, A) means A will depend on C.
			// DFS from C visits B then A → toTaskId "task-A" found → cycle
			await addEdge(ctx, { fromTaskId: "task-C", toTaskId: "task-A" });
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(GraphInvariantError);
		expect((caught as GraphInvariantError).violation).toBe("cycle");
	});

	it("throws cycle for three-node ring: A→B→C→A", async () => {
		// Graph: B depends on A, C depends on B  (A → B → C)
		// Adding: A depends on C  (addEdge from=C, to=A)
		const tasks = {
			"task-A": makeTask("task-A"),
			"task-B": makeTask("task-B", ["task-A"]),
			"task-C": makeTask("task-C", ["task-B"]),
		};
		mockGetTask.mockImplementation(buildGetTaskMock(tasks));

		await expect(addEdge(ctx, { fromTaskId: "task-C", toTaskId: "task-A" })).rejects.toSatisfy(
			(e: unknown) => e instanceof GraphInvariantError && e.violation === "cycle",
		);
	});

	it("throws cycle for longer chain A→B→C→D, trying D→A", async () => {
		const tasks = {
			"task-A": makeTask("task-A"),
			"task-B": makeTask("task-B", ["task-A"]),
			"task-C": makeTask("task-C", ["task-B"]),
			"task-D": makeTask("task-D", ["task-C"]),
		};
		mockGetTask.mockImplementation(buildGetTaskMock(tasks));

		let caught: unknown;
		try {
			await addEdge(ctx, { fromTaskId: "task-D", toTaskId: "task-A" });
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(GraphInvariantError);
		expect((caught as GraphInvariantError).violation).toBe("cycle");
	});
});

// ---------------------------------------------------------------------------

describe("validateAddEdge — valid edges (no invariant violation)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRecordGraphMutation.mockImplementation(async (params: Record<string, unknown>) => ({
			id: "mutation-id-1",
			...params,
		}));
	});

	it("A→B in an empty graph succeeds", async () => {
		const tasks = {
			"task-A": makeTask("task-A"),
			"task-B": makeTask("task-B"),
		};
		mockGetTask.mockImplementation(buildGetTaskMock(tasks));

		const result = await addEdge(ctx, { fromTaskId: "task-A", toTaskId: "task-B" });
		expect(result.success).toBe(true);
		expect(result.mutationType).toBe("add_edge");
	});

	it("A→B with existing unrelated deps succeeds", async () => {
		const tasks = {
			"task-A": makeTask("task-A", ["task-Z"]), // A depends on some unrelated Z
			"task-B": makeTask("task-B"),
		};
		mockGetTask.mockImplementation(buildGetTaskMock(tasks));

		await expect(addEdge(ctx, { fromTaskId: "task-A", toTaskId: "task-B" })).resolves.toMatchObject({ success: true });
	});

	it("does persist the edge via updateTask on success", async () => {
		const tasks = {
			"task-A": makeTask("task-A"),
			"task-B": makeTask("task-B"),
		};
		mockGetTask.mockImplementation(buildGetTaskMock(tasks));

		await addEdge(ctx, { fromTaskId: "task-A", toTaskId: "task-B" });

		expect(mockUpdateTask).toHaveBeenCalledWith(
			"task-B",
			expect.objectContaining({ dependsOn: expect.arrayContaining(["task-A"]) }),
		);
	});

	it("records a graph mutation audit entry on success", async () => {
		const tasks = {
			"task-A": makeTask("task-A"),
			"task-B": makeTask("task-B"),
		};
		mockGetTask.mockImplementation(buildGetTaskMock(tasks));

		await addEdge(ctx, { fromTaskId: "task-A", toTaskId: "task-B" });

		expect(mockRecordGraphMutation).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: ctx.projectId,
				pipelineRunId: ctx.pipelineRunId,
				causedByAgentId: ctx.causedByAgentId,
				mutationType: "add_edge",
				status: "applied",
			}),
		);
	});
});

// ---------------------------------------------------------------------------

describe("Diamond pattern (valid shared ancestor — no cycle)", () => {
	// Diamond: A → B, A → C, B → D, C → D
	// All edges are valid — D has two paths back to A but there is no cycle.

	beforeEach(() => {
		vi.clearAllMocks();
		mockRecordGraphMutation.mockImplementation(async (params: Record<string, unknown>) => ({
			id: "mutation-id-1",
			...params,
		}));
	});

	it("allows adding B→D when A→B, A→C, C→D already exist", async () => {
		// Current state: B depends on A, C depends on A, D depends on C
		const tasks = {
			"task-A": makeTask("task-A"),
			"task-B": makeTask("task-B", ["task-A"]),
			"task-C": makeTask("task-C", ["task-A"]),
			"task-D": makeTask("task-D", ["task-C"]),
		};
		mockGetTask.mockImplementation(buildGetTaskMock(tasks));

		// Adding: D also depends on B  (addEdge from=B, to=D)
		// DFS from B: visits A (B's dep), A has no deps → toTaskId "task-D" NOT found → no cycle
		await expect(addEdge(ctx, { fromTaskId: "task-B", toTaskId: "task-D" })).resolves.toMatchObject({ success: true });
	});

	it("rejects the reverse edge D→A in the diamond (closes a cycle)", async () => {
		// Full diamond already in place: B→A, C→A, D→C, D→B
		const tasks = {
			"task-A": makeTask("task-A"),
			"task-B": makeTask("task-B", ["task-A"]),
			"task-C": makeTask("task-C", ["task-A"]),
			"task-D": makeTask("task-D", ["task-C", "task-B"]),
		};
		mockGetTask.mockImplementation(buildGetTaskMock(tasks));

		// addEdge(D, A) means A will depend on D — closes A→B→D→A cycle
		await expect(addEdge(ctx, { fromTaskId: "task-D", toTaskId: "task-A" })).rejects.toSatisfy(
			(e: unknown) => e instanceof GraphInvariantError && e.violation === "cycle",
		);
	});

	it("allows parallel independent chains with no shared nodes", async () => {
		// Chain 1: A → B → C
		// Chain 2: X → Y
		// No relationship between chains
		const tasks = {
			"task-A": makeTask("task-A"),
			"task-B": makeTask("task-B", ["task-A"]),
			"task-C": makeTask("task-C", ["task-B"]),
			"task-X": makeTask("task-X"),
			"task-Y": makeTask("task-Y", ["task-X"]),
		};
		mockGetTask.mockImplementation(buildGetTaskMock(tasks));

		// Adding X → C (cross-chain edge, no cycle)
		await expect(addEdge(ctx, { fromTaskId: "task-X", toTaskId: "task-C" })).resolves.toMatchObject({ success: true });
	});
});

// ---------------------------------------------------------------------------

describe("removeEdge", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRecordGraphMutation.mockImplementation(async (params: Record<string, unknown>) => ({
			id: "mutation-id-1",
			...params,
		}));
	});

	it("removes the specified dependency from dependsOn", async () => {
		mockGetTask.mockResolvedValue(makeTask("task-B", ["task-A", "task-Z"]));

		await removeEdge(ctx, { fromTaskId: "task-A", toTaskId: "task-B" });

		expect(mockUpdateTask).toHaveBeenCalledWith("task-B", expect.objectContaining({ dependsOn: ["task-Z"] }));
	});

	it("leaves other dependencies intact when one is removed", async () => {
		mockGetTask.mockResolvedValue(makeTask("task-B", ["dep-1", "dep-2", "dep-3"]));

		await removeEdge(ctx, { fromTaskId: "dep-2", toTaskId: "task-B" });

		const [, payload] = mockUpdateTask.mock.calls[0] as [string, { dependsOn: string[] }];
		expect(payload.dependsOn).toContain("dep-1");
		expect(payload.dependsOn).toContain("dep-3");
		expect(payload.dependsOn).not.toContain("dep-2");
	});

	it("no-op (empty dependsOn) when removing a non-existent edge", async () => {
		mockGetTask.mockResolvedValue(makeTask("task-B", ["dep-1"]));

		await removeEdge(ctx, { fromTaskId: "task-X", toTaskId: "task-B" });

		const [, payload] = mockUpdateTask.mock.calls[0] as [string, { dependsOn: string[] }];
		expect(payload.dependsOn).toEqual(["dep-1"]); // unchanged
	});

	it("results in empty dependsOn when removing the only dependency", async () => {
		mockGetTask.mockResolvedValue(makeTask("task-B", ["task-A"]));

		await removeEdge(ctx, { fromTaskId: "task-A", toTaskId: "task-B" });

		const [, payload] = mockUpdateTask.mock.calls[0] as [string, { dependsOn: string[] }];
		expect(payload.dependsOn).toEqual([]);
	});

	it("returns success:true with mutationType remove_edge", async () => {
		mockGetTask.mockResolvedValue(makeTask("task-B", ["task-A"]));

		const result = await removeEdge(ctx, { fromTaskId: "task-A", toTaskId: "task-B" });

		expect(result.success).toBe(true);
		expect(result.mutationType).toBe("remove_edge");
	});

	it("records an audit entry for the removal", async () => {
		mockGetTask.mockResolvedValue(makeTask("task-B", ["task-A"]));

		await removeEdge(ctx, { fromTaskId: "task-A", toTaskId: "task-B" });

		expect(mockRecordGraphMutation).toHaveBeenCalledWith(
			expect.objectContaining({
				mutationType: "remove_edge",
				projectId: ctx.projectId,
				status: "applied",
			}),
		);
	});

	it("throws when target task is not found", async () => {
		mockGetTask.mockResolvedValue(null);

		await expect(removeEdge(ctx, { fromTaskId: "task-A", toTaskId: "missing" })).rejects.toThrow("not found");
	});
});

// ---------------------------------------------------------------------------

describe("Cycle detection — DFS traversal correctness", () => {
	// These tests exercise the DFS visited-set to verify no infinite loops
	// and correct short-circuit behavior.

	beforeEach(() => {
		vi.clearAllMocks();
		mockRecordGraphMutation.mockImplementation(async (params: Record<string, unknown>) => ({
			id: "mutation-id-1",
			...params,
		}));
	});

	it("handles a node with no dependencies (leaf node) without error", async () => {
		const tasks = {
			"leaf-A": makeTask("leaf-A"),
			"leaf-B": makeTask("leaf-B"),
		};
		mockGetTask.mockImplementation(buildGetTaskMock(tasks));

		await expect(addEdge(ctx, { fromTaskId: "leaf-A", toTaskId: "leaf-B" })).resolves.toMatchObject({ success: true });
	});

	it("does not revisit already-visited nodes (visited set prevents infinite loop)", async () => {
		// Shared ancestor pattern: both B and C depend on A.
		// DFS from B will visit A; DFS from C will also try A but skip (visited).
		const tasks = {
			"task-A": makeTask("task-A"),
			"task-B": makeTask("task-B", ["task-A"]),
			"task-C": makeTask("task-C", ["task-A", "task-B"]),
			"task-D": makeTask("task-D"),
		};
		mockGetTask.mockImplementation(buildGetTaskMock(tasks));

		// Adding D depends on C — no cycle; DFS should terminate correctly
		await expect(addEdge(ctx, { fromTaskId: "task-C", toTaskId: "task-D" })).resolves.toMatchObject({ success: true });

		// Verify getTask was not called excessively for "task-A" (visited once)
		const taskACalls = mockGetTask.mock.calls.filter(([id]: [string]) => id === "task-A");
		expect(taskACalls.length).toBe(1);
	});

	it("cycle detection succeeds even with a wide fan-out dependency tree", async () => {
		// A has deps on B, C, D; B has dep on E; C has dep on E; D has dep on E
		// Adding F → A: DFS from F visits nothing (F is a root) → no cycle
		const tasks = {
			"task-A": makeTask("task-A", ["task-B", "task-C", "task-D"]),
			"task-B": makeTask("task-B", ["task-E"]),
			"task-C": makeTask("task-C", ["task-E"]),
			"task-D": makeTask("task-D", ["task-E"]),
			"task-E": makeTask("task-E"),
			"task-F": makeTask("task-F"),
		};
		mockGetTask.mockImplementation(buildGetTaskMock(tasks));

		// addEdge(F, A) means A depends on F — DFS from F, F has no deps → no cycle
		await expect(addEdge(ctx, { fromTaskId: "task-F", toTaskId: "task-A" })).resolves.toMatchObject({ success: true });
	});
});

// ---------------------------------------------------------------------------

describe("MutationResult shape", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRecordGraphMutation.mockImplementation(async (params: Record<string, unknown>) => ({
			id: "mutation-id-abc",
			...params,
		}));
	});

	it("addEdge result contains mutationId from recordGraphMutation", async () => {
		const tasks = {
			"task-A": makeTask("task-A"),
			"task-B": makeTask("task-B"),
		};
		mockGetTask.mockImplementation(buildGetTaskMock(tasks));

		const result = await addEdge(ctx, { fromTaskId: "task-A", toTaskId: "task-B" });

		expect(result.mutationId).toBe("mutation-id-abc");
	});

	it("addEdge result.detail contains fromTaskId and toTaskId", async () => {
		const tasks = {
			"task-A": makeTask("task-A"),
			"task-B": makeTask("task-B"),
		};
		mockGetTask.mockImplementation(buildGetTaskMock(tasks));

		const result = await addEdge(ctx, { fromTaskId: "task-A", toTaskId: "task-B" });

		expect(result.detail).toMatchObject({ fromTaskId: "task-A", toTaskId: "task-B" });
	});

	it("removeEdge result.detail contains fromTaskId and toTaskId", async () => {
		mockGetTask.mockResolvedValue(makeTask("task-B", ["task-A"]));

		const result = await removeEdge(ctx, { fromTaskId: "task-A", toTaskId: "task-B" });

		expect(result.detail).toMatchObject({ fromTaskId: "task-A", toTaskId: "task-B" });
	});
});
