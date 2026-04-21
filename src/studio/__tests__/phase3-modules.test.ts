// ---------------------------------------------------------------------------
// Oscorpex — Phase 3 Module Unit Tests
// Tests for: graph-coordinator, goal-engine, sandbox-manager,
// adaptive-replanner, cross-project-learning.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------
vi.mock("../db.js", () => ({
	query: vi.fn().mockResolvedValue([]),
	queryOne: vi.fn().mockImplementation(async (_sql: string, params: any[]) => {
		// Return a mock row with an id from params[0]
		return { id: params?.[0] ?? "mock-id", project_id: "proj-1", created_at: new Date().toISOString() };
	}),
	execute: vi.fn().mockResolvedValue(undefined),
	getTask: vi.fn().mockImplementation(async (id: string) => ({
		id,
		phaseId: "phase-1",
		title: "Mock task",
		description: "mock",
		assignedAgent: "agent-1",
		status: "queued",
		complexity: "S",
		dependsOn: [],
		branch: "main",
	})),
	updateTask: vi.fn().mockResolvedValue(undefined),
	createTask: vi.fn().mockImplementation(async (params: any) => ({
		id: `task-${Date.now()}`,
		...params,
		status: "queued",
	})),
	listProjectTasks: vi.fn().mockResolvedValue([]),
	getPipelineRun: vi.fn().mockResolvedValue({ id: "run-1" }),
	getGraphMutation: vi.fn().mockResolvedValue({
		id: "mutation-1",
		projectId: "proj-1",
		pipelineRunId: "run-1",
		causedByAgentId: "agent-1",
		mutationType: "insert_node",
		payload: { phaseId: "phase-1", title: "Pending task", description: "from proposal", assignedAgent: "backend_dev" },
		status: "pending",
		createdAt: new Date().toISOString(),
	}),
	updateGraphMutation: vi.fn().mockImplementation(async (_id: string, updates: any) => ({
		id: "mutation-1",
		projectId: "proj-1",
		pipelineRunId: "run-1",
		causedByAgentId: "agent-1",
		mutationType: "insert_node",
		payload: updates.payload ?? {},
		status: updates.status ?? "applied",
		approvedBy: updates.approvedBy,
		appliedAt: updates.appliedAt,
		createdAt: new Date().toISOString(),
	})),
	recordGraphMutation: vi.fn().mockImplementation(async (params: any) => ({
		id: "mutation-1",
		...params,
		status: params.status ?? "applied",
		createdAt: new Date().toISOString(),
	})),
	listGraphMutations: vi.fn().mockResolvedValue([]),
	getLatestPlan: vi.fn().mockResolvedValue({ id: "plan-1" }),
	listPhases: vi.fn().mockResolvedValue([]),
	getProjectSetting: vi.fn().mockResolvedValue(null),
	getProject: vi.fn().mockResolvedValue({ id: "proj-1", repoPath: "/tmp/repo" }),
}));

vi.mock("../event-bus.js", () => ({
	eventBus: {
		emit: vi.fn(),
		emitTransient: vi.fn(),
	},
}));

// ---------------------------------------------------------------------------
// Graph Coordinator
// ---------------------------------------------------------------------------
import {
	insertNode,
	splitTask,
	addEdge,
	removeEdge,
	deferBranch,
	mergeIntoPhase,
	proposeGraphMutation,
	approveGraphMutationRequest,
} from "../graph-coordinator.js";

describe("Graph Coordinator", () => {
	const ctx = { projectId: "proj-1", pipelineRunId: "run-1", causedByAgentId: "agent-1" };

	it("should insert a new node into the graph", async () => {
		const result = await insertNode(ctx, {
			phaseId: "phase-1",
			title: "New task",
			description: "Injected by agent",
			assignedAgent: "backend_dev",
		});
		expect(result.success).toBe(true);
		expect(result.mutationType).toBe("insert_node");
		expect(result.mutationId).toBe("mutation-1");
	});

	it("should split a task into children", async () => {
		const result = await splitTask(ctx, {
			parentTaskId: "task-1",
			children: [
				{ title: "Sub A", description: "First part", assignedAgent: "backend_dev" },
				{ title: "Sub B", description: "Second part", assignedAgent: "backend_dev" },
			],
		});
		expect(result.success).toBe(true);
		expect(result.mutationType).toBe("split_task");
		expect((result.detail as any).childIds).toHaveLength(2);
	});

	it("should add an edge between tasks", async () => {
		const result = await addEdge(ctx, { fromTaskId: "task-1", toTaskId: "task-2" });
		expect(result.success).toBe(true);
		expect(result.mutationType).toBe("add_edge");
	});

	it("should remove an edge between tasks", async () => {
		const result = await removeEdge(ctx, { fromTaskId: "task-1", toTaskId: "task-2" });
		expect(result.success).toBe(true);
		expect(result.mutationType).toBe("remove_edge");
	});

	it("should defer a branch", async () => {
		const result = await deferBranch(ctx, { phaseId: "phase-1", reason: "Too many failures" });
		expect(result.success).toBe(true);
		expect(result.mutationType).toBe("defer_branch");
	});

	it("should merge findings into a target phase", async () => {
		const result = await mergeIntoPhase(ctx, {
			sourcePhaseId: "phase-1",
			targetPhaseId: "phase-2",
			tasks: [
				{ title: "Fix from phase 1", description: "Bug found", assignedAgent: "backend_dev" },
			],
		});
		expect(result.success).toBe(true);
		expect(result.mutationType).toBe("merge_into_phase");
	});

	it("should persist pending graph mutation proposals", async () => {
		const result = await proposeGraphMutation({
			projectId: "proj-1",
			causedByAgentId: "agent-1",
			mutationType: "insert_node",
			payload: {
				phaseId: "phase-1",
				title: "Pending task",
				description: "Awaiting approval",
				assignedAgent: "backend_dev",
			},
		});
		expect(result.mutationId).toBe("mutation-1");
	});

	it("should approve and apply a pending graph mutation", async () => {
		const result = await approveGraphMutationRequest("mutation-1", "human");
		expect(result.success).toBe(true);
		expect(result.mutationType).toBe("insert_node");
	});
});

// ---------------------------------------------------------------------------
// Goal Engine
// ---------------------------------------------------------------------------
import {
	formatGoalPrompt,
	ensureGoalForTask,
	validateCriteriaFromOutput,
	type ExecutionGoal,
} from "../goal-engine.js";

describe("Goal Engine", () => {
	const mockGoal: ExecutionGoal = {
		id: "goal-1",
		projectId: "proj-1",
		taskId: "task-1",
		definition: {
			goal: "Implement Google OAuth login",
			constraints: ["must use existing auth layer", "must not break email login"],
			successCriteria: [
				"user can log in with Google",
				"tests pass for auth module",
				"frontend handles auth errors",
			],
		},
		status: "active",
		criteriaResults: [],
		createdAt: new Date().toISOString(),
	};

	it("should format goal prompt with all sections", () => {
		const prompt = formatGoalPrompt(mockGoal);
		expect(prompt).toContain("GOAL");
		expect(prompt).toContain("Implement Google OAuth login");
		expect(prompt).toContain("must use existing auth layer");
		expect(prompt).toContain("user can log in with Google");
		expect(prompt).toContain("tests pass for auth module");
	});

	it("should validate criteria from output with matching keywords", () => {
		const results = validateCriteriaFromOutput(mockGoal, {
			filesCreated: ["src/auth/google-oauth.ts"],
			filesModified: ["src/auth/index.ts"],
			logs: ["Google OAuth integration complete", "All auth tests passing", "Frontend error handling added for auth"],
			testResults: { passed: 12, failed: 0, total: 12 },
		});
		expect(results).toHaveLength(3);
		// At least some criteria should match based on keyword overlap
		const metCount = results.filter((r) => r.met).length;
		expect(metCount).toBeGreaterThan(0);
	});

	it("should fail criteria when output has no relevant content", () => {
		const results = validateCriteriaFromOutput(mockGoal, {
			filesCreated: [],
			filesModified: [],
			logs: ["setup complete"],
		});
		expect(results).toHaveLength(3);
		// With minimal output, most criteria should not be met
		const metCount = results.filter((r) => r.met).length;
		expect(metCount).toBeLessThan(3);
	});

	it("should include evidence in criterion results", () => {
		const results = validateCriteriaFromOutput(mockGoal, {
			filesCreated: ["src/auth/google.ts"],
			logs: ["tests pass"],
		});
		for (const r of results) {
			expect(r.evidence).toBeTruthy();
		}
	});

	it("should create and activate a goal for a task", async () => {
		vi.mocked(queryOne)
			.mockResolvedValueOnce(undefined as any)
			.mockResolvedValueOnce({
				id: "goal-new",
				project_id: "proj-1",
				task_id: "task-1",
				definition: {
					goal: "Stabilize auth flow",
					constraints: ["keep existing API"],
					successCriteria: ["tests pass"],
				},
				status: "pending",
				criteria_results: [],
				created_at: new Date().toISOString(),
			} as any)
			.mockResolvedValueOnce({
				id: "goal-new",
				project_id: "proj-1",
				task_id: "task-1",
				definition: {
					goal: "Stabilize auth flow",
					constraints: ["keep existing API"],
					successCriteria: ["tests pass"],
				},
				status: "active",
				criteria_results: [],
				created_at: new Date().toISOString(),
			} as any);

		const goal = await ensureGoalForTask({
			projectId: "proj-1",
			taskId: "task-1",
			definition: {
				goal: "Stabilize auth flow",
				constraints: ["keep existing API"],
				successCriteria: ["tests pass"],
			},
		});
		expect(goal.status).toBe("active");
		expect(goal.taskId).toBe("task-1");
	});
});

// ---------------------------------------------------------------------------
// Sandbox Manager
// ---------------------------------------------------------------------------
import {
	checkToolAllowed,
	checkPathAllowed,
	checkOutputSize,
	type SandboxPolicy,
} from "../sandbox-manager.js";

describe("Sandbox Manager", () => {
	const defaultPolicy: SandboxPolicy = {
		id: "policy-1",
		projectId: "proj-1",
		isolationLevel: "workspace",
		allowedTools: ["read", "write", "bash"],
		deniedTools: ["rm_rf", "sudo"],
		filesystemScope: ["/tmp/repo"],
		networkPolicy: "project_only",
		maxExecutionTimeMs: 300_000,
		maxOutputSizeBytes: 10_485_760,
		elevatedCapabilities: [],
		enforcementMode: "hard",
	};

	describe("checkToolAllowed", () => {
		it("should allow tools in the allowed list", () => {
			expect(checkToolAllowed(defaultPolicy, "read").allowed).toBe(true);
			expect(checkToolAllowed(defaultPolicy, "write").allowed).toBe(true);
		});

		it("should deny explicitly denied tools", () => {
			expect(checkToolAllowed(defaultPolicy, "rm_rf").allowed).toBe(false);
			expect(checkToolAllowed(defaultPolicy, "sudo").allowed).toBe(false);
		});

		it("should deny tools not in allowed list when list is non-empty", () => {
			expect(checkToolAllowed(defaultPolicy, "network_call").allowed).toBe(false);
		});

		it("should allow any tool when allowed list is empty", () => {
			const openPolicy = { ...defaultPolicy, allowedTools: [], deniedTools: [] };
			expect(checkToolAllowed(openPolicy, "anything").allowed).toBe(true);
		});
	});

	describe("checkPathAllowed", () => {
		it("should allow paths within scope", () => {
			expect(checkPathAllowed(defaultPolicy, "/tmp/repo/src/index.ts").allowed).toBe(true);
		});

		it("should deny paths outside scope", () => {
			expect(checkPathAllowed(defaultPolicy, "/etc/passwd").allowed).toBe(false);
			expect(checkPathAllowed(defaultPolicy, "/home/user/.ssh/id_rsa").allowed).toBe(false);
		});

		it("should allow any path when scope is empty", () => {
			const openPolicy = { ...defaultPolicy, filesystemScope: [] };
			expect(checkPathAllowed(openPolicy, "/anywhere/file.ts").allowed).toBe(true);
		});
	});

	describe("checkOutputSize", () => {
		it("should allow output within limit", () => {
			expect(checkOutputSize(defaultPolicy, 1024).allowed).toBe(true);
		});

		it("should deny output exceeding limit", () => {
			expect(checkOutputSize(defaultPolicy, 20_000_000).allowed).toBe(false);
		});
	});
});

// ---------------------------------------------------------------------------
// Adaptive Replanner
// ---------------------------------------------------------------------------
import { shouldReplan, evaluateReplan, approveReplanEvent, type ReplanTrigger } from "../adaptive-replanner.js";
import { eventBus } from "../event-bus.js";
import { queryOne, getProjectSetting, getLatestPlan, listPhases, listProjectTasks } from "../db.js";

describe("Adaptive Replanner", () => {
	beforeEach(() => {
		vi.mocked(getProjectSetting).mockResolvedValue(undefined); // not disabled
		vi.mocked(queryOne).mockResolvedValue(null); // no recent replan
	});

	it("should allow replan when enabled and not rate-limited", async () => {
		const result = await shouldReplan("proj-1", "phase_end");
		expect(result).toBe(true);
	});

	it("should deny replan when explicitly disabled", async () => {
		vi.mocked(getProjectSetting).mockResolvedValueOnce("false");
		const result = await shouldReplan("proj-1", "phase_end");
		expect(result).toBe(false);
	});

	it("should rate-limit replans to 1 per 10 minutes", async () => {
		vi.mocked(queryOne).mockResolvedValueOnce({ id: "recent-replan" } as any);
		const result = await shouldReplan("proj-1", "phase_end");
		expect(result).toBe(false);
	});

	it("should create a pending replan event when phase_end detects review rejections", async () => {
		vi.mocked(getLatestPlan).mockResolvedValueOnce({ id: "plan-1" } as any);
		vi.mocked(listPhases).mockResolvedValueOnce([
			{ id: "phase-2", name: "Next", status: "pending", tasks: [], order: 2, dependsOn: [] } as any,
		]);
		vi.mocked(listProjectTasks).mockResolvedValueOnce([
			{ id: "t-1", phaseId: "phase-1", status: "done", reviewStatus: "rejected" } as any,
			{ id: "t-2", phaseId: "phase-2", status: "queued" } as any,
		]);
		vi.mocked(queryOne).mockResolvedValueOnce(null);

		const result = await evaluateReplan({ projectId: "proj-1", trigger: "phase_end" });
		expect(result?.status).toBe("pending");
		expect(result?.pendingApproval).toBeGreaterThan(0);
	});

	it("should generate queue bottleneck patch when queueRatio > 0.4", async () => {
		vi.mocked(getLatestPlan).mockResolvedValueOnce({ id: "plan-1" } as any);
		vi.mocked(listPhases).mockResolvedValueOnce([
			{ id: "phase-2", name: "Build", status: "running", tasks: [], order: 1, dependsOn: [] } as any,
		]);
		// 5 queued out of 10 total → queueRatio = 0.5 > 0.4
		vi.mocked(listProjectTasks).mockResolvedValueOnce([
			...Array.from({ length: 5 }, (_, i) => ({ id: `q-${i}`, phaseId: "phase-2", status: "queued" } as any)),
			...Array.from({ length: 3 }, (_, i) => ({ id: `d-${i}`, phaseId: "phase-2", status: "done" } as any)),
			...Array.from({ length: 2 }, (_, i) => ({ id: `r-${i}`, phaseId: "phase-2", status: "running" } as any)),
		]);
		vi.mocked(queryOne).mockResolvedValueOnce(null);

		const result = await evaluateReplan({ projectId: "proj-1", trigger: "phase_end" });
		expect(result).not.toBeNull();
		const bottleneckPatch = result!.patchEntries.find((p) => p.reason.includes("bottleneck"));
		expect(bottleneckPatch).toBeDefined();
		expect(bottleneckPatch!.action).toBe("add_task");
	});

	it("should generate defer_phase patch for repeated_provider_failure", async () => {
		vi.mocked(getLatestPlan).mockResolvedValueOnce({ id: "plan-1" } as any);
		vi.mocked(listPhases).mockResolvedValueOnce([
			{ id: "phase-1", name: "Deploy", status: "running", tasks: [], order: 1, dependsOn: [] } as any,
		]);
		vi.mocked(listProjectTasks).mockResolvedValueOnce([
			{ id: "t-1", phaseId: "phase-1", status: "queued" } as any,
		]);
		vi.mocked(queryOne).mockResolvedValueOnce(null);

		const result = await evaluateReplan({ projectId: "proj-1", trigger: "repeated_provider_failure" });
		expect(result).not.toBeNull();
		const deferPatch = result!.patchEntries.find((p) => p.action === "defer_phase");
		expect(deferPatch).toBeDefined();
		expect(deferPatch!.riskLevel).toBe("medium");
	});

	it("should include replanEventId in event payload", async () => {
		vi.mocked(getLatestPlan).mockResolvedValueOnce({ id: "plan-1" } as any);
		vi.mocked(listPhases).mockResolvedValueOnce([
			{ id: "phase-2", name: "Next", status: "pending", tasks: [], order: 2, dependsOn: [] } as any,
		]);
		vi.mocked(listProjectTasks).mockResolvedValueOnce([
			{ id: "t-1", phaseId: "phase-1", status: "done", reviewStatus: "rejected" } as any,
		]);
		vi.mocked(queryOne).mockResolvedValueOnce(null);

		const result = await evaluateReplan({ projectId: "proj-1", trigger: "phase_end" });
		expect(result).not.toBeNull();

		const emitCalls = vi.mocked(eventBus.emit).mock.calls;
		const replanEvent = emitCalls.find((c) => (c[0] as any).type === "plan:replanned");
		expect(replanEvent).toBeDefined();
		expect((replanEvent![0] as any).payload.replanEventId).toBeDefined();
		expect(typeof (replanEvent![0] as any).payload.replanEventId).toBe("string");
		expect((replanEvent![0] as any).payload.patchSummary).toBeDefined();
		expect(Array.isArray((replanEvent![0] as any).payload.patchSummary)).toBe(true);
	});

	it("should approve and apply pending replan patches", async () => {
		vi.mocked(queryOne).mockResolvedValueOnce({
			id: "replan-1",
			project_id: "proj-1",
			trigger: "phase_end",
			patch_entries: [
				{
					action: "add_task",
					payload: {
						phaseId: "phase-2",
						title: "Address review findings before next phase",
						description: "follow-up",
						assignedAgent: "tech-lead",
					},
					riskLevel: "medium",
					reason: "review findings",
				},
			],
			auto_applied: 0,
			pending_approval: 1,
			status: "pending",
			created_at: new Date().toISOString(),
		} as any);
		vi.mocked(queryOne).mockResolvedValueOnce({
			id: "replan-1",
			project_id: "proj-1",
			trigger: "phase_end",
			patch_entries: [
				{
					action: "add_task",
					payload: {
						phaseId: "phase-2",
						title: "Address review findings before next phase",
						description: "follow-up",
						assignedAgent: "tech-lead",
					},
					riskLevel: "medium",
					reason: "review findings",
				},
			],
			auto_applied: 1,
			pending_approval: 1,
			status: "applied",
			approved_by: "human",
			applied_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
		} as any);

		const result = await approveReplanEvent("replan-1", "human");
		expect(result.status).toBe("applied");
		expect(result.autoApplied).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Cross-Project Learning
// ---------------------------------------------------------------------------
import { getLearningPatterns } from "../cross-project-learning.js";
import { query } from "../db.js";

describe("Cross-Project Learning", () => {
	it("should return empty patterns when none exist", async () => {
		vi.mocked(query).mockResolvedValueOnce([]);
		const patterns = await getLearningPatterns("implementation", "backend_dev", "tenant-1");
		expect(patterns).toEqual([]);
	});

	it("should map rows to LearningPattern objects", async () => {
		vi.mocked(query).mockResolvedValueOnce([
			{
				id: "lp-1",
				tenant_id: "tenant-1",
				learning_type: "strategy_success",
				task_type: "implementation",
				agent_role: "backend_dev",
				pattern: { strategy: "scaffold_then_refine" },
				sample_count: 10,
				success_rate: 0.85,
				is_global: false,
				created_at: "2026-04-20",
				updated_at: "2026-04-20",
			},
		]);
		const patterns = await getLearningPatterns("implementation", "backend_dev", "tenant-1");
		expect(patterns).toHaveLength(1);
		expect(patterns[0].learningType).toBe("strategy_success");
		expect(patterns[0].successRate).toBe(0.85);
		expect(patterns[0].pattern).toEqual({ strategy: "scaffold_then_refine" });
	});
});
