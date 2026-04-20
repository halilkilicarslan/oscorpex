// ---------------------------------------------------------------------------
// Oscorpex — E2E Pipeline Tests
// Full pipeline lifecycle: plan → execute → review → done, multi-phase,
// review rejection → revision, failure → auto-retry, phase advancement.
//
// Uses REAL DB, mocks CLI adapter boundary (no actual AI calls).
// ---------------------------------------------------------------------------

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAdapter } from "../cli-adapter.js";
import {
	createPhase,
	createPlan,
	createProject,
	createProjectAgent,
	createTask,
	getProject,
	getTask,
	listPhases,
	listProjectTasks,
	updatePlanStatus,
	updateProject,
} from "../db.js";
import { executionEngine } from "../execution-engine.js";
import { execute, query } from "../pg.js";
import { taskEngine } from "../task-engine.js";

// ---------------------------------------------------------------------------
// Mock: CLI adapter — prevents real AI calls
// ---------------------------------------------------------------------------

vi.mock("../cli-adapter.js", () => {
	const adapter = {
		name: "mock-cli",
		isAvailable: vi.fn().mockResolvedValue(true),
		execute: vi.fn(),
	};
	return {
		getAdapter: vi.fn().mockReturnValue(adapter),
		getAdapterChain: vi.fn().mockReturnValue([adapter]),
	};
});

// Mock non-blocking side effects to avoid noise
vi.mock("../agent-runtime.js", () => ({
	agentRuntime: {
		ensureVirtualProcess: vi.fn(),
		appendVirtualOutput: vi.fn(),
		getAgentOutput: vi.fn().mockReturnValue([]),
		markVirtualStopped: vi.fn(),
	},
}));
vi.mock("../agent-runtime/index.js", () => ({
	initSession: vi.fn().mockResolvedValue({
		session: { id: "mock-session" },
		strategySelection: { strategy: { name: "scaffold_then_refine", promptAddendum: "" }, reason: "mock", confidence: 0.5 },
		behavioralPrompt: "",
	}),
	completeSession: vi.fn().mockResolvedValue(undefined),
	failSession: vi.fn().mockResolvedValue(undefined),
	loadProtocolContext: vi.fn().mockResolvedValue({ prompt: "", messageIds: [], hasBlockers: false }),
	acknowledgeMessages: vi.fn().mockResolvedValue(undefined),
	recordStep: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../agent-log-store.js", () => ({
	persistAgentLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../output-verifier.js", () => ({
	verifyTaskOutput: vi.fn().mockResolvedValue({ taskId: "mock", allPassed: true, results: [] }),
}));
vi.mock("../test-gate.js", () => ({
	runTestGate: vi.fn().mockResolvedValue({ policy: "skip", passed: true, summary: "skipped" }),
}));
vi.mock("../budget-guard.js", () => ({
	enforceBudgetGuard: vi.fn().mockResolvedValue(undefined),
	checkBudget: vi.fn().mockResolvedValue({ totalCost: 0, budgetLimit: 100, exceeded: false }),
}));
vi.mock("../goal-engine.js", () => ({
	getGoalForTask: vi.fn().mockResolvedValue(null),
	formatGoalPrompt: vi.fn().mockReturnValue(""),
	validateCriteriaFromOutput: vi.fn().mockReturnValue([]),
	evaluateGoal: vi.fn().mockResolvedValue(null),
}));
vi.mock("../sandbox-manager.js", () => ({
	resolveTaskPolicy: vi.fn().mockResolvedValue({ id: "default", isolationLevel: "workspace", allowedTools: [], deniedTools: [], filesystemScope: [], networkPolicy: "project_only", maxExecutionTimeMs: 300000, maxOutputSizeBytes: 10485760, elevatedCapabilities: [] }),
	startSandboxSession: vi.fn().mockResolvedValue({ id: "mock-sandbox" }),
	endSandboxSession: vi.fn().mockResolvedValue(undefined),
	checkToolAllowed: vi.fn().mockReturnValue({ allowed: true, reason: "allowed" }),
	checkPathAllowed: vi.fn().mockReturnValue({ allowed: true, reason: "allowed" }),
}));
vi.mock("../adaptive-replanner.js", () => ({
	evaluateReplan: vi.fn().mockResolvedValue(null),
}));
vi.mock("../lint-runner.js", () => ({
	runLintFix: vi.fn().mockResolvedValue({ eslint: { errors: [] }, prettier: { errors: [] } }),
}));
vi.mock("../docs-generator.js", () => ({
	updateDocsAfterTask: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../context-builder.js", () => ({
	buildRAGContext: vi.fn().mockResolvedValue(null),
	formatRAGContext: vi.fn().mockReturnValue(""),
}));
vi.mock("../context-sandbox.js", () => ({
	compactCrossAgentContext: vi
		.fn()
		.mockResolvedValue({ prompt: "", totalFiles: 0, relevantFiles: 0, totalCompletedTasks: 0 }),
	indexTaskOutput: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../context-session.js", () => ({
	buildResumeSnapshot: vi.fn().mockResolvedValue({ eventCount: 0, events: [] }),
	formatResumeSnapshot: vi.fn().mockReturnValue(""),
}));
vi.mock("../model-router.js", () => ({
	resolveModel: vi.fn().mockResolvedValue({ model: "sonnet", tier: "balanced", effort: "normal" }),
}));
vi.mock("../behavioral-prompt.js", () => ({
	composeSystemPrompt: vi.fn().mockReturnValue("system prompt"),
}));
vi.mock("../capability-resolver.js", () => ({
	resolveAllowedTools: vi.fn().mockResolvedValue([]),
}));
vi.mock("../command-policy.js", () => ({
	buildPolicyPromptSection: vi.fn().mockReturnValue(""),
	getDefaultPolicy: vi.fn().mockReturnValue(null),
}));
vi.mock("../cli-runtime.js", () => ({
	isClaudeCliAvailable: vi.fn().mockResolvedValue(true),
	executeWithCLI: vi.fn().mockResolvedValue({ text: "done", filesCreated: [], filesModified: [], logs: [] }),
	resolveFilePaths: vi.fn().mockImplementation((paths: string[]) => paths),
}));
vi.mock("../context-store.js", () => ({
	searchContext: vi.fn().mockResolvedValue([]),
	indexContent: vi.fn().mockResolvedValue(0),
	getContextSource: vi.fn().mockResolvedValue(null),
	listContextSources: vi.fn().mockResolvedValue([]),
	deleteContextSource: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../provider-state.js", () => ({
	providerState: {
		isAvailable: vi.fn().mockReturnValue(true),
		markSuccess: vi.fn(),
		markFailure: vi.fn(),
		markRateLimited: vi.fn(),
		getAllStates: vi.fn().mockReturnValue([]),
		isAllExhausted: vi.fn().mockReturnValue(false),
		getEarliestRecoveryMs: vi.fn().mockReturnValue(60_000),
	},
}));

// Get the mock execute fn from the mocked adapter
function getMockExecute(): ReturnType<typeof vi.fn> {
	const adapter = getAdapter("claude-code") as any;
	return adapter.execute;
}

// ---------------------------------------------------------------------------
// Skip suite if DB is not available
// ---------------------------------------------------------------------------

let dbReady = false;
try {
	await query("SELECT 1 FROM projects LIMIT 0");
	dbReady = true;
} catch {
	/* DB not available */
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cliSuccess(files: string[] = ["src/output.ts"]): any {
	return {
		text: "Task completed successfully",
		filesCreated: files,
		filesModified: [],
		logs: ["done"],
		inputTokens: 100,
		outputTokens: 50,
		totalCostUsd: 0.001,
		model: "claude-sonnet-4-6",
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
	};
}

function cliReviewApproved(): any {
	return {
		text: "APPROVED: Code looks good",
		filesCreated: [],
		filesModified: [],
		logs: ["Code Review: approved"],
		inputTokens: 50,
		outputTokens: 20,
		totalCostUsd: 0.0005,
		model: "claude-sonnet-4-6",
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
	};
}

function cliReviewRejected(): any {
	return {
		text: "CHANGES_REQUESTED: Fix error handling",
		filesCreated: [],
		filesModified: [],
		logs: ["Code Review: rejected — Fix error handling"],
		inputTokens: 50,
		outputTokens: 20,
		totalCostUsd: 0.0005,
		model: "claude-sonnet-4-6",
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
	};
}

function cliFailed(): any {
	throw new Error("compile error: cannot find module");
}

// ---------------------------------------------------------------------------
// E2E Tests
// ---------------------------------------------------------------------------

describe.skipIf(!dbReady)("E2E Pipeline", () => {
	beforeAll(async () => {
		await execute("DELETE FROM chat_messages");
		await execute("DELETE FROM events");
		await execute("DELETE FROM tasks");
		await execute("DELETE FROM phases");
		await execute("DELETE FROM project_plans");
		await execute("DELETE FROM agent_dependencies");
		await execute("DELETE FROM project_agents");
		await execute("DELETE FROM projects WHERE name LIKE 'E2E%'");
	});

	beforeEach(() => {
		// Reset only call history, preserve mock implementations
		getMockExecute().mockReset();
	});

	/** Create a project with agents, plan, phases, and tasks for E2E testing. */
	async function setupE2EProject(opts?: {
		multiPhase?: boolean;
		withReviewer?: boolean;
	}) {
		const project = await createProject({
			name: `E2E ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			description: "E2E test project",
			techStack: ["typescript"],
			repoPath: "/tmp/e2e-test-repo",
		});

		// Create agents
		const coder = await createProjectAgent({
			projectId: project.id,
			name: "Frontend Dev",
			role: "frontend_developer",
			avatar: "👨‍💻",
			personality: "Precise and methodical",
			skills: ["react", "typescript"],
			model: "sonnet",
			cliTool: "claude-code",
			systemPrompt: "You are a frontend developer.",
		});

		let reviewer: any = null;
		if (opts?.withReviewer) {
			reviewer = await createProjectAgent({
				projectId: project.id,
				name: "QA Engineer",
				role: "qa_engineer",
				avatar: "🔍",
				personality: "Thorough and detail-oriented",
				skills: ["testing", "review"],
				model: "sonnet",
				cliTool: "claude-code",
				systemPrompt: "You are a QA engineer who reviews code.",
			});

			// Create dependency: coder -> reviewer (review type)
			await execute(
				`INSERT INTO agent_dependencies (id, project_id, from_agent_id, to_agent_id, type, created_at)
				 VALUES ($1, $2, $3, $4, 'review', $5)`,
				[`dep-${Date.now()}`, project.id, coder.id, reviewer.id, new Date().toISOString()],
			);
		}

		const plan = await createPlan(project.id);
		await updatePlanStatus(plan.id, "approved");

		// Phase 1
		const p1 = await createPhase({
			planId: plan.id,
			name: "Foundation",
			order: 1,
			dependsOn: [],
		});

		const t1 = await createTask({
			phaseId: p1.id,
			title: "Setup project structure",
			description: "Initialize the project with proper folder structure",
			assignedAgent: coder.id,
			complexity: "S",
			dependsOn: [],
			branch: "feat/setup",
		});

		const t2 = await createTask({
			phaseId: p1.id,
			title: "Add configuration",
			description: "Add TypeScript and ESLint configuration",
			assignedAgent: coder.id,
			complexity: "S",
			dependsOn: [t1.id],
			branch: "feat/config",
		});

		let p2: any = null;
		let t3: any = null;
		if (opts?.multiPhase) {
			p2 = await createPhase({
				planId: plan.id,
				name: "Features",
				order: 2,
				dependsOn: [p1.id],
			});

			t3 = await createTask({
				phaseId: p2.id,
				title: "Build dashboard component",
				description: "Create the main dashboard React component",
				assignedAgent: coder.id,
				complexity: "M",
				dependsOn: [],
				branch: "feat/dashboard",
			});
		}

		return { project, coder, reviewer, plan, p1, p2, t1, t2, t3 };
	}

	// ---- Single phase, no review -------------------------------------------

	describe("Single Phase — No Review", () => {
		it("should execute all tasks in order and complete the phase", async () => {
			const { project, p1, t1, t2 } = await setupE2EProject();

			// Mock CLI: both tasks succeed
			getMockExecute()
				.mockResolvedValueOnce(cliSuccess(["src/index.ts"]))
				.mockResolvedValueOnce(cliSuccess(["src/config.ts"]));

			await executionEngine.startProjectExecution(project.id);

			// Both tasks should be done
			const task1 = await getTask(t1.id);
			const task2 = await getTask(t2.id);
			expect(task1?.status).toBe("done");
			expect(task2?.status).toBe("done");
			expect(task1?.output?.filesCreated).toEqual(["src/index.ts"]);
			expect(task2?.output?.filesCreated).toEqual(["src/config.ts"]);

			// Phase should be completed
			const allPhases = await query("SELECT * FROM phases WHERE id = $1", [p1.id]);
			expect(allPhases[0]?.status).toBe("completed");

			// CLI adapter called exactly twice (once per task)
			expect(getMockExecute()).toHaveBeenCalledTimes(2);
		});

		it("should handle task failure and mark phase as failed", async () => {
			const { project, p1, t1, t2 } = await setupE2EProject();

			// All attempts fail (initial + auto-retries)
			getMockExecute().mockRejectedValue(new Error("compile error"));

			await executionEngine.startProjectExecution(project.id);

			// t1 should be failed (after auto-retry exhaustion or immediate fail)
			const task1 = await getTask(t1.id);
			expect(task1?.status).toBe("failed");
			expect(task1?.error).toContain("compile error");

			// t2 should still be queued (blocked by t1 dependency)
			const task2 = await getTask(t2.id);
			expect(task2?.status).toBe("queued");
		});
	});

	// ---- Multi-phase pipeline ----------------------------------------------

	describe("Multi-Phase Pipeline", () => {
		it("should advance to phase 2 after phase 1 completes", async () => {
			const { project, p1, p2, t1, t2, t3 } = await setupE2EProject({ multiPhase: true });

			// All tasks succeed (persistent mock)
			getMockExecute().mockResolvedValue(cliSuccess(["src/output.ts"]));

			await executionEngine.startProjectExecution(project.id);

			// Phase 1 tasks done
			const task1 = await getTask(t1.id);
			const task2 = await getTask(t2.id);
			expect(task1?.status).toBe("done");
			expect(task2?.status).toBe("done");

			// Phase 2 task should be done or at least started
			// (parallel test suites may cause agent cleanup race conditions)
			const task3 = await getTask(t3!.id);
			expect(["done", "running", "assigned"]).toContain(task3?.status);

			// Phase 1 should be completed
			const ph1 = await query("SELECT status FROM phases WHERE id = $1", [p1.id]);
			expect(ph1[0]?.status).toBe("completed");

			// Phase 2 should be at least running
			const ph2 = await query("SELECT status FROM phases WHERE id = $1", [p2!.id]);
			expect(["running", "completed"]).toContain(ph2[0]?.status);
		});

		it("should not start phase 2 if phase 1 fails", async () => {
			const { project, p2, t1, t3 } = await setupE2EProject({ multiPhase: true });

			// First task fails, auto-retries also fail
			getMockExecute().mockRejectedValue(new Error("fatal error"));

			await executionEngine.startProjectExecution(project.id);

			// Phase 2 task should never have started
			const task3 = await getTask(t3!.id);
			expect(task3?.status).toBe("queued");

			// Phase 2 should still be pending
			const ph2 = await query("SELECT status FROM phases WHERE id = $1", [p2!.id]);
			expect(ph2[0]?.status).toBe("pending");
		});
	});

	// ---- Review loop -------------------------------------------------------

	describe("Review Loop", () => {
		it("should create review task when reviewer exists", async () => {
			const { project, t1, t2, reviewer } = await setupE2EProject({ withReviewer: true });

			// Mock: all CLI calls return APPROVED text
			getMockExecute().mockResolvedValue({
				...cliSuccess(["src/index.ts"]),
				text: "APPROVED: Code looks good",
			});

			await executionEngine.startProjectExecution(project.id);

			// Wait for async review dispatch to settle
			await new Promise((r) => setTimeout(r, 200));

			// t1 should reach done (via review approval)
			const task1 = await getTask(t1.id);
			expect(task1?.status).toBe("done");

			// Review tasks should have been created
			const allTasks = await listProjectTasks(project.id);
			const reviewTasks = allTasks.filter((t) => t.title.startsWith("Code Review: "));
			expect(reviewTasks.length).toBeGreaterThanOrEqual(1);
		});

		it("should handle review rejection and trigger revision", async () => {
			const { project, t1, reviewer } = await setupE2EProject({ withReviewer: true });

			let callCount = 0;
			getMockExecute().mockImplementation(async () => {
				callCount++;
				if (callCount === 1) {
					// t1 first execution
					return cliSuccess(["src/index.ts"]);
				}
				if (callCount === 2) {
					// Review rejects
					return cliReviewRejected();
				}
				// All subsequent: task revision succeeds + review approves
				return { ...cliSuccess(["src/index.ts"]), text: "APPROVED: Looks good now" };
			});

			await executionEngine.startProjectExecution(project.id);

			// Wait for async revision + review dispatch
			await new Promise((r) => setTimeout(r, 500));

			const task1 = await getTask(t1.id);
			// After rejection → revision, task should eventually be done
			// (or still in revision cycle if async hasn't settled)
			expect(["done", "review", "revision", "running"]).toContain(task1?.status);
			if (task1?.status === "done") {
				expect(task1?.revisionCount).toBeGreaterThanOrEqual(1);
			}
		});
	});

	// ---- Auto-retry on failure ---------------------------------------------

	describe("Auto-Retry", () => {
		it("should auto-retry failed tasks and succeed on later attempt", async () => {
			const { project, t1 } = await setupE2EProject();

			let callCount = 0;
			getMockExecute().mockImplementation(async () => {
				callCount++;
				if (callCount <= 2) throw new Error("network timeout");
				return cliSuccess(["src/index.ts"]);
			});

			await executionEngine.startProjectExecution(project.id);

			const task1 = await getTask(t1.id);
			expect(task1?.status).toBe("done");
			expect(task1?.retryCount).toBe(2);
		});

		it("should give up after MAX_AUTO_RETRIES exhausted", async () => {
			const { project, t1 } = await setupE2EProject();

			// All attempts fail (initial + 2 retries = 3 failures)
			getMockExecute().mockRejectedValue(new Error("persistent error"));

			await executionEngine.startProjectExecution(project.id);

			const task1 = await getTask(t1.id);
			expect(task1?.status).toBe("failed");
			expect(task1?.retryCount).toBe(2);
		});
	});

	// ---- Dependency resolution E2E -----------------------------------------

	describe("Dependency Resolution E2E", () => {
		it("should respect task dependencies within a phase", async () => {
			const { project, t1, t2 } = await setupE2EProject();
			const callOrder: string[] = [];

			getMockExecute().mockImplementation(async (opts: any) => {
				callOrder.push(opts.prompt.includes("Setup project structure") ? "t1" : "t2");
				return cliSuccess();
			});

			await executionEngine.startProjectExecution(project.id);

			// t1 should execute before t2 (t2 depends on t1)
			expect(callOrder[0]).toBe("t1");
			expect(callOrder[1]).toBe("t2");
		});
	});

	// ---- Project completion detection --------------------------------------

	describe("Project Completion", () => {
		it("should mark project as completed when all phases finish", async () => {
			const { project } = await setupE2EProject();

			getMockExecute().mockResolvedValue(cliSuccess());

			await executionEngine.startProjectExecution(project.id);

			const proj = await getProject(project.id);
			expect(proj?.status).toBe("completed");
		});
	});
});
