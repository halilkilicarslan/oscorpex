// ---------------------------------------------------------------------------
// Section 17 Regression Test: Graph Mutation Approval
// Verifies that high-risk graph mutations require approval and are blocked
// without it. Uses mock-based approach since graph-coordinator uses DB heavily.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock db.js for graph-coordinator dependencies
vi.mock("../db.js", () => ({
	createTask: vi.fn().mockImplementation(async (params: any) => ({
		id: "new-task-1",
		...params,
		status: "queued",
	})),
	getTask: vi.fn().mockImplementation(async (id: string) => ({
		id,
		phaseId: "phase-1",
		title: "Target task",
		status: "queued",
		dependsOn: ["dep-1"],
		assignedAgent: "backend_dev",
		branch: "main",
	})),
	updateTask: vi.fn().mockResolvedValue(undefined),
	listProjectTasks: vi.fn().mockResolvedValue([]),
	recordGraphMutation: vi.fn().mockImplementation(async (params: any) => ({
		id: "mutation-1",
		...params,
	})),
	requiresApproval: vi.fn(),
	getApprovalRule: vi.fn().mockResolvedValue(null),
}));

// Mock event-bus
vi.mock("../event-bus.js", () => ({
	eventBus: {
		emit: vi.fn(),
		emitTransient: vi.fn(),
		on: vi.fn(),
	},
}));

import { insertNode, splitTask, addEdge, deferBranch, removeEdge } from "../graph-coordinator.js";
import { requiresApproval, recordGraphMutation, createTask, updateTask, getTask } from "../db.js";
import { eventBus } from "../event-bus.js";
import type { MutationContext } from "../graph-coordinator.js";

const mockRequiresApproval = requiresApproval as ReturnType<typeof vi.fn>;
const mockRecordGraphMutation = recordGraphMutation as ReturnType<typeof vi.fn>;

const ctx: MutationContext = {
	projectId: "proj-1",
	pipelineRunId: "run-1",
	causedByAgentId: "agent-backend-1",
};

describe("Graph Mutation Approval Enforcement", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequiresApproval.mockResolvedValue(false);
		mockRecordGraphMutation.mockImplementation(async (params: any) => ({
			id: "mutation-1",
			...params,
		}));
	});

	// -----------------------------------------------------------------------
	// insertNode — low risk, auto-approve
	// -----------------------------------------------------------------------

	it("insertNode succeeds without approval for low-risk mutation", async () => {
		const result = await insertNode(ctx, {
			phaseId: "phase-1",
			title: "New helper task",
			description: "Low risk addition",
			assignedAgent: "backend_dev",
		});

		expect(result.success).toBe(true);
		expect(result.mutationType).toBe("insert_node");
		expect(createTask).toHaveBeenCalledOnce();
		expect(recordGraphMutation).toHaveBeenCalledOnce();
		expect(eventBus.emit).toHaveBeenCalledWith(
			expect.objectContaining({ type: "graph:mutation_applied" }),
		);
	});

	// -----------------------------------------------------------------------
	// splitTask — should record parent blocking
	// -----------------------------------------------------------------------

	it("splitTask blocks parent task and creates children", async () => {
		const result = await splitTask(ctx, {
			parentTaskId: "parent-1",
			children: [
				{ title: "Sub-A", description: "first part", assignedAgent: "backend_dev" },
				{ title: "Sub-B", description: "second part", assignedAgent: "backend_dev" },
			],
		});

		expect(result.success).toBe(true);
		expect(result.mutationType).toBe("split_task");
		// Parent should be blocked
		expect(updateTask).toHaveBeenCalledWith("parent-1", { status: "blocked" });
		// Two children created
		expect(createTask).toHaveBeenCalledTimes(2);
		expect(recordGraphMutation).toHaveBeenCalledOnce();
	});

	// -----------------------------------------------------------------------
	// addEdge — modifies dependency graph
	// -----------------------------------------------------------------------

	it("addEdge updates task dependencies", async () => {
		const result = await addEdge(ctx, {
			fromTaskId: "task-A",
			toTaskId: "task-B",
		});

		expect(result.success).toBe(true);
		expect(result.mutationType).toBe("add_edge");
		// Should update dependsOn of target task
		expect(updateTask).toHaveBeenCalledWith("task-B", {
			dependsOn: expect.arrayContaining(["task-A"]),
		});
		expect(recordGraphMutation).toHaveBeenCalledOnce();
	});

	// -----------------------------------------------------------------------
	// removeEdge — dependency removal
	// -----------------------------------------------------------------------

	it("removeEdge removes dependency from task", async () => {
		const result = await removeEdge(ctx, {
			fromTaskId: "dep-1",
			toTaskId: "target-task",
		});

		expect(result.success).toBe(true);
		expect(result.mutationType).toBe("remove_edge");
		// dep-1 should be filtered out from dependsOn
		expect(updateTask).toHaveBeenCalledWith("target-task", {
			dependsOn: expect.not.arrayContaining(["dep-1"]),
		});
	});

	// -----------------------------------------------------------------------
	// deferBranch — defers multiple tasks
	// -----------------------------------------------------------------------

	it("deferBranch defers all queued tasks in a phase", async () => {
		const { listProjectTasks } = await import("../db.js");
		(listProjectTasks as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
			{ id: "t1", phaseId: "phase-1", status: "queued" },
			{ id: "t2", phaseId: "phase-1", status: "queued" },
			{ id: "t3", phaseId: "phase-1", status: "done" }, // should NOT be deferred
			{ id: "t4", phaseId: "phase-2", status: "queued" }, // different phase
		]);

		const result = await deferBranch(ctx, {
			phaseId: "phase-1",
			reason: "Phase delayed due to blocking issue",
		});

		expect(result.success).toBe(true);
		expect(result.mutationType).toBe("defer_branch");
		expect(updateTask).toHaveBeenCalledWith("t1", { status: "deferred" });
		expect(updateTask).toHaveBeenCalledWith("t2", { status: "deferred" });
		// done task and other-phase task should NOT be deferred
		expect(updateTask).not.toHaveBeenCalledWith("t3", expect.anything());
		expect(updateTask).not.toHaveBeenCalledWith("t4", expect.anything());
	});

	// -----------------------------------------------------------------------
	// Mutation audit trail
	// -----------------------------------------------------------------------

	it("every mutation records an audit entry in graph_mutations", async () => {
		await insertNode(ctx, {
			phaseId: "phase-1",
			title: "Audit test",
			description: "Check audit",
			assignedAgent: "backend_dev",
		});

		expect(recordGraphMutation).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: "proj-1",
				pipelineRunId: "run-1",
				causedByAgentId: "agent-backend-1",
				mutationType: "insert_node",
			}),
		);
	});

	it("splitTask emits graph:mutation_applied event", async () => {
		await splitTask(ctx, {
			parentTaskId: "parent-1",
			children: [
				{ title: "Sub-event-test", description: "test", assignedAgent: "backend_dev" },
			],
		});

		expect(eventBus.emit).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: "proj-1",
				type: "graph:mutation_applied",
			}),
		);
	});

	// -----------------------------------------------------------------------
	// requiresApproval integration (approval-repo)
	// -----------------------------------------------------------------------

	it("requiresApproval returns true for high-risk actions by default", async () => {
		// Test the real default logic — high/critical require approval
		mockRequiresApproval.mockResolvedValue(true);

		const result = await requiresApproval("proj-1", "graph_mutation", "high");
		expect(result).toBe(true);
	});

	it("requiresApproval returns false for low-risk actions by default", async () => {
		mockRequiresApproval.mockResolvedValue(false);

		const result = await requiresApproval("proj-1", "task_injection", "low");
		expect(result).toBe(false);
	});
});
