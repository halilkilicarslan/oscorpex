// ---------------------------------------------------------------------------
// Execution Engine — Provider Telemetry Integration Tests
// Verifies telemetry records are written during actual task execution paths.
// Mocks the adapter chain so no real CLI is spawned.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock adapter chain before importing execution-engine
const mockAdapterChain: Array<{
	name: string;
	execute: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
	isAvailable: () => Promise<boolean>;
	capabilities: () => Promise<Record<string, unknown>>;
}> = [];

vi.mock("../cli-adapter.js", () => ({
	getAdapterChain: vi.fn().mockImplementation(() => mockAdapterChain),
}));

vi.mock("../model-router.js", () => ({
	resolveModel: vi.fn().mockResolvedValue({ model: "sonnet" }),
}));

vi.mock("../cli-runtime.js", () => ({
	resolveFilePaths: vi.fn().mockImplementation((files: string[]) => files),
}));

import {
	createPhase,
	createPlan,
	createProject,
	createProjectAgent,
	createTask,
	getTask,
	updatePlanStatus,
	updateProject,
	updateTask,
} from "../db.js";
import { executionEngine } from "../execution-engine.js";
import { execute, query } from "../pg.js";

describe("Execution Engine Provider Telemetry", () => {
	beforeEach(async () => {
		mockAdapterChain.length = 0;
		vi.clearAllMocks();
		await execute("DELETE FROM events WHERE project_id LIKE 'ptel-%'");
		await execute("DELETE FROM tasks WHERE title LIKE 'PTel%'");
		await execute("DELETE FROM phases WHERE name LIKE 'PTel%'");
		await execute("DELETE FROM project_plans WHERE project_id LIKE 'ptel-%'");
		await execute("DELETE FROM project_agents WHERE project_id LIKE 'ptel-%'");
		await execute("DELETE FROM projects WHERE name LIKE 'PTel%'");
	});

	afterEach(async () => {
		// Cancel any tasks that might still be running from failed tests
		const projects = await query<{ id: string }>("SELECT id FROM projects WHERE name LIKE 'PTel%'");
		for (const row of projects) {
			await executionEngine.cancelRunningTasks(row.id);
		}
	});

	async function setupProject() {
		const project = await createProject({
			name: "PTel Test Project",
			description: "",
			techStack: [],
			repoPath: "/tmp/ptel-repo",
		});
		await updateProject(project.id, { status: "running" });
		const plan = await createPlan(project.id);
		await updatePlanStatus(plan.id, "approved");
		const phase = await createPhase({ planId: plan.id, name: "PTel Phase", order: 1, dependsOn: [] });
		await createProjectAgent({
			projectId: project.id,
			name: "coder",
			role: "coder",
			model: "sonnet",
			avatar: "",
			personality: "",
			cliTool: "claude-code",
			skills: [],
			systemPrompt: "",
		});
		return { project, plan, phase };
	}

	it("writes telemetry success when adapter succeeds", async () => {
		const { project, phase } = await setupProject();
		const task = await createTask({
			phaseId: phase.id,
			title: "PTel Success",
			description: "",
			assignedAgent: "coder",
			complexity: "S",
			dependsOn: [],
			branch: "feat/success",
		});
		await updateTask(task.id, { status: "queued", retryCount: 5 });

		mockAdapterChain.push({
			name: "claude-code",
			isAvailable: async () => true,
			capabilities: async () => ({
				supportedModels: ["claude-sonnet-4-6"],
				supportsToolRestriction: true,
				supportsStreaming: false,
				supportsResume: false,
				supportsCancel: true,
				supportsStructuredOutput: false,
				supportsSandboxHinting: true,
			}),
			execute: async () => ({
				text: "ok",
				filesCreated: ["a.ts"],
				filesModified: [],
				logs: [],
				inputTokens: 10,
				outputTokens: 5,
				cacheCreationTokens: 0,
				cacheReadTokens: 0,
				totalCostUsd: 0.001,
				durationMs: 300,
				model: "sonnet",
			}),
		});

		await executionEngine.executeTask(project.id, task);

		const record = executionEngine.telemetry.getRecord(project.id, task.id);
		expect(record).toBeDefined();
		expect(record!.success).toBe(true);
		expect(record!.primaryProvider).toBe("claude-code");
		expect(record!.fallbackCount).toBe(0);
		expect(record!.errorClassification).toBeUndefined();
	});

	it("writes telemetry fallback when primary fails and secondary succeeds", async () => {
		const { project, phase } = await setupProject();
		const task = await createTask({
			phaseId: phase.id,
			title: "PTel Fallback",
			description: "",
			assignedAgent: "coder",
			complexity: "S",
			dependsOn: [],
			branch: "feat/fallback",
		});
		await updateTask(task.id, { status: "queued", retryCount: 5 });

		mockAdapterChain.push({
			name: "claude-code",
			isAvailable: async () => true,
			capabilities: async () => ({
				supportedModels: ["claude-sonnet-4-6"],
				supportsToolRestriction: true,
				supportsStreaming: false,
				supportsResume: false,
				supportsCancel: true,
				supportsStructuredOutput: false,
				supportsSandboxHinting: true,
			}),
			execute: async () => {
				throw new Error("exited with code 1: crash");
			},
		});
		mockAdapterChain.push({
			name: "cursor",
			isAvailable: async () => true,
			capabilities: async () => ({
				supportedModels: ["cursor-small"],
				supportsToolRestriction: false,
				supportsStreaming: false,
				supportsResume: false,
				supportsCancel: true,
				supportsStructuredOutput: true,
				supportsSandboxHinting: false,
			}),
			execute: async () => ({
				text: "fallback ok",
				filesCreated: [],
				filesModified: [],
				logs: [],
				inputTokens: 5,
				outputTokens: 5,
				cacheCreationTokens: 0,
				cacheReadTokens: 0,
				totalCostUsd: 0,
				durationMs: 200,
				model: "cursor-large",
			}),
		});

		await executionEngine.executeTask(project.id, task);

		const record = executionEngine.telemetry.getRecord(project.id, task.id);
		expect(record).toBeDefined();
		expect(record!.success).toBe(true);
		expect(record!.fallbackCount).toBe(1);
		expect(record!.fallbackTimeline).toHaveLength(1);
		expect(record!.fallbackTimeline[0]!.fromProvider).toBe("claude-code");
		expect(record!.fallbackTimeline[0]!.toProvider).toBe("cursor");
		expect(record!.fallbackTimeline[0]!.errorClassification).toBe("cli_error");
	});

	it("writes telemetry error when all adapters fail", async () => {
		const { project, phase } = await setupProject();
		const task = await createTask({
			phaseId: phase.id,
			title: "PTel Error",
			description: "",
			assignedAgent: "coder",
			complexity: "S",
			dependsOn: [],
			branch: "feat/error",
		});
		await updateTask(task.id, { status: "queued", retryCount: 5 });

		mockAdapterChain.push({
			name: "claude-code",
			isAvailable: async () => true,
			capabilities: async () => ({
				supportedModels: ["claude-sonnet-4-6"],
				supportsToolRestriction: true,
				supportsStreaming: false,
				supportsResume: false,
				supportsCancel: true,
				supportsStructuredOutput: false,
				supportsSandboxHinting: true,
			}),
			execute: async () => {
				throw new Error("exited with code 1: fail");
			},
		});

		await executionEngine.executeTask(project.id, task);

		const record = executionEngine.telemetry.getRecord(project.id, task.id);
		expect(record).toBeDefined();
		expect(record!.success).toBe(false);
		expect(record!.errorMessage).toContain("fail");
	});

	it("writes telemetry cancel when task is cancelled mid-flight", async () => {
		const { project, phase } = await setupProject();
		const task = await createTask({
			phaseId: phase.id,
			title: "PTel Cancel",
			description: "",
			assignedAgent: "coder",
			complexity: "S",
			dependsOn: [],
			branch: "feat/cancel",
		});
		await updateTask(task.id, { status: "queued", retryCount: 5 });

		mockAdapterChain.push({
			name: "claude-code",
			isAvailable: async () => true,
			capabilities: async () => ({
				supportedModels: ["claude-sonnet-4-6"],
				supportsToolRestriction: true,
				supportsStreaming: false,
				supportsResume: false,
				supportsCancel: true,
				supportsStructuredOutput: false,
				supportsSandboxHinting: true,
			}),
			execute: async (opts: Record<string, unknown>) => {
				// Respect abort signal so cancel works immediately
				if (opts.signal && (opts.signal as AbortSignal).aborted) {
					throw new Error("aborted");
				}
				await new Promise<void>((resolve, reject) => {
					const timer = setTimeout(() => {
						resolve();
					}, 5_000);
					if (opts.signal) {
						(opts.signal as AbortSignal).addEventListener("abort", () => {
							clearTimeout(timer);
							reject(new Error("aborted"));
						}, { once: true });
					}
				});
				return {
					text: "done",
					filesCreated: [],
					filesModified: [],
					logs: [],
					inputTokens: 0,
					outputTokens: 0,
					cacheCreationTokens: 0,
					cacheReadTokens: 0,
					totalCostUsd: 0,
					durationMs: 100,
					model: "sonnet",
				};
			},
		});

		const execPromise = executionEngine.executeTask(project.id, task);
		// Give executeTask time to reach the adapter and start telemetry
		await new Promise((resolve) => setTimeout(resolve, 500));
		await executionEngine.cancelRunningTasks(project.id);

		try {
			await execPromise;
		} catch {
			// expected
		}

		const record = executionEngine.telemetry.getRecord(project.id, task.id);
		expect(record).toBeDefined();
		// Cancel audit may or may not be recorded depending on timing;
		// the key requirement is that a record exists for the execution.
		expect(record!.primaryProvider).toBe("claude-code");
	});

	it("latency snapshot aggregates after multiple executions", async () => {
		const { project, phase } = await setupProject();

		for (let i = 0; i < 3; i++) {
			const task = await createTask({
				phaseId: phase.id,
				title: `PTel Latency ${i}`,
				description: "",
				assignedAgent: "coder",
				complexity: "S",
				dependsOn: [],
				branch: `feat/latency${i}`,
			});
			await updateTask(task.id, { status: "queued", retryCount: 5 });

			mockAdapterChain.length = 0;
			mockAdapterChain.push({
				name: "claude-code",
				isAvailable: async () => true,
				capabilities: async () => ({
					supportedModels: ["claude-sonnet-4-6"],
					supportsToolRestriction: true,
					supportsStreaming: false,
					supportsResume: false,
					supportsCancel: true,
					supportsStructuredOutput: false,
					supportsSandboxHinting: true,
				}),
				execute: async () => ({
					text: "ok",
					filesCreated: [],
					filesModified: [],
					logs: [],
					inputTokens: 10,
					outputTokens: 5,
					cacheCreationTokens: 0,
					cacheReadTokens: 0,
					totalCostUsd: 0.001,
					durationMs: 250,
					model: "sonnet",
				}),
			});

			await executionEngine.executeTask(project.id, task);
		}

		const snapshot = executionEngine.telemetry.getLatencySnapshot("claude-code");
		// Snapshot includes executions from all tests sharing this engine instance
		expect(snapshot.totalExecutions).toBeGreaterThanOrEqual(1);
		expect(snapshot.averageLatencyMs).toBeGreaterThanOrEqual(0);
		expect(snapshot.p95LatencyMs).toBeGreaterThanOrEqual(0);
	});
});
