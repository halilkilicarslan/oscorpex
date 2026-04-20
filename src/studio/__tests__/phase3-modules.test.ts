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
	recordGraphMutation: vi.fn().mockImplementation(async (params: any) => ({
		id: "mutation-1",
		...params,
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
});

// ---------------------------------------------------------------------------
// Goal Engine
// ---------------------------------------------------------------------------
import {
	formatGoalPrompt,
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
import { shouldReplan, type ReplanTrigger } from "../adaptive-replanner.js";
import { queryOne, getProjectSetting } from "../db.js";

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
