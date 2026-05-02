// @oscorpex/kernel — OscorpexKernel facade implementation
// Thin delegation layer that wires together the existing subsystems
// (task-engine, pipeline-engine, execution-engine, event-bus) under the
// single OscorpexKernel interface from @oscorpex/core.
// No behavioral changes — all calls delegate to the same singletons.

import type {
	BudgetCheck,
	ContextPacket,
	ContextPacketOptions,
	Task as CoreTask,
	TaskOutput as CoreTaskOutput,
	TaskStatus as CoreTaskStatus,
	CostRecord,
	CostReporter,
	EventPublisher,
	HookContext,
	HookPhase,
	HookRegistration,
	HookRegistry,
	HookResult,
	MemoryProvider,
	OscorpexKernel as OscorpexKernelContract,
	PipelineState,
	PipelineStatus,
	PolicyDecision,
	PolicyEngine as PolicyEngineContract,
	PolicyEvaluationInput,
	ProjectCostSummary,
	ProjectStatus,
	ProviderAdapter,
	ProviderExecutionInput,
	ProviderExecutionResult,
	ReplaySnapshot,
	ReplayStore,
	Run,
	RunMode,
	RunStatus,
	RunStore,
	Scheduler,
	TaskGraph as TaskGraphContract,
	TaskStore,
	VerificationInput,
	VerificationReport,
	VerificationResult,
	VerificationRunner,
} from "@oscorpex/core";
import { eventBus } from "../event-bus.js";
import { executionEngine } from "../execution-engine.js";
import { pipelineEngine } from "../pipeline-engine.js";
import { replayStore } from "../replay-store.js";
import { taskEngine } from "../task-engine.js";
import { costReporter } from "./cost-adapter.js";
import { hookRegistry, runHooks } from "./hook-registry.js";
import {
	toCoreTask,
	toCoreTaskOrNull,
	toCoreTaskOrThrow,
	toCorePipelineState,
	toKernelTask,
	toKernelTaskOutput,
	toStudioEventInput,
} from "./mappers.js";
import { memoryProvider } from "./memory-adapter.js";
import { policyEngine } from "./policy-adapter.js";
import { providerRegistry } from "./provider-registry.js";
import { verificationRunner } from "./verification-adapter.js";

// ---------------------------------------------------------------------------
// Adapter wrappers — kernel singletons behind contract interfaces
// ---------------------------------------------------------------------------

class KernelEventPublisher implements EventPublisher {
	async publish<TPayload>(event: import("@oscorpex/core").BaseEvent<string, TPayload>): Promise<void> {
		eventBus.emit(toStudioEventInput(event as import("@oscorpex/core").BaseEvent<string, unknown>));
	}
	publishTransient<TPayload>(event: import("@oscorpex/core").BaseEvent<string, TPayload>): void {
		eventBus.emitTransient(toStudioEventInput(event as import("@oscorpex/core").BaseEvent<string, unknown>));
	}
}

class KernelTaskStore implements TaskStore {
	async create(task: CoreTask): Promise<CoreTask> {
		const { createTask } = await import("../db.js");
		const result = await createTask(toKernelTask(task));
		return toCoreTask(result);
	}
	async get(id: string): Promise<CoreTask | null> {
		const { getTask } = await import("../db.js");
		const t = await getTask(id);
		return toCoreTaskOrNull(t);
	}
	async update(id: string, partial: Partial<CoreTask>): Promise<CoreTask> {
		const { updateTask } = await import("../db.js");
		// Map only the fields that updateTask accepts; stageId→phaseId and type→taskType.
		const kernelPartial: Parameters<typeof updateTask>[1] = {
			...(partial.status !== undefined && { status: partial.status }),
			...(partial.assignedRole !== undefined && { assignedAgent: partial.assignedRole }),
			...(partial.output !== undefined && { output: toKernelTaskOutput(partial.output) }),
			...(partial.retryCount !== undefined && { retryCount: partial.retryCount }),
			...(partial.error !== undefined && { error: partial.error }),
			...(partial.startedAt !== undefined && { startedAt: partial.startedAt }),
			...(partial.completedAt !== undefined && { completedAt: partial.completedAt }),
			...(partial.reviewStatus !== undefined && { reviewStatus: partial.reviewStatus }),
			...(partial.reviewerAgentId !== undefined && { reviewerAgentId: partial.reviewerAgentId }),
			...(partial.reviewTaskId !== undefined && { reviewTaskId: partial.reviewTaskId }),
			...(partial.revisionCount !== undefined && { revisionCount: partial.revisionCount }),
			...(partial.assignedProvider !== undefined && { assignedAgentId: partial.assignedProvider }),
			...(partial.requiresApproval !== undefined && { requiresApproval: partial.requiresApproval }),
			...(partial.approvalStatus !== undefined && { approvalStatus: partial.approvalStatus }),
			...(partial.dependsOn !== undefined && { dependsOn: partial.dependsOn }),
			...(partial.riskLevel !== undefined && { riskLevel: partial.riskLevel }),
		};
		const result = await updateTask(id, kernelPartial);
		return toCoreTaskOrThrow(result, id);
	}
	async list(filter: import("@oscorpex/core").TaskListFilter): Promise<CoreTask[]> {
		const { listProjectTasks } = await import("../db.js");
		if (filter.projectId) {
			const tasks = await listProjectTasks(filter.projectId);
			return tasks.map(toCoreTask);
		}
		return [];
	}
	async claim(id: string, workerId: string): Promise<CoreTask> {
		const { claimTask } = await import("../db.js");
		const result = await claimTask(id, workerId);
		return toCoreTaskOrThrow(result, id);
	}
}

class KernelRunStore implements RunStore {
	async create(run: Run): Promise<Run> {
		const { createRun } = await import("../db/run-repo.js");
		return createRun(run);
	}
	async get(id: string): Promise<Run | null> {
		const { getRun } = await import("../db/run-repo.js");
		return getRun(id);
	}
	async update(id: string, partial: Partial<Run>): Promise<Run> {
		const { updateRun } = await import("../db/run-repo.js");
		return updateRun(id, partial);
	}
	async list(filter: import("@oscorpex/core").RunListFilter): Promise<Run[]> {
		const { listRuns } = await import("../db/run-repo.js");
		return listRuns(filter);
	}
}

class KernelScheduler implements Scheduler {
	async getReadyTasks(runId: string): Promise<CoreTask[]> {
		const tasks = await taskEngine.getReadyTasks(runId);
		return tasks.map(toCoreTask);
	}
	async claim(taskId: string, workerId: string): Promise<CoreTask> {
		const { claimTask } = await import("../db.js");
		const result = await claimTask(taskId, workerId);
		return toCoreTaskOrThrow(result, taskId);
	}
	async release(taskId: string, _workerId: string): Promise<void> {
		const { releaseTaskClaim } = await import("../db.js");
		await releaseTaskClaim(taskId);
	}
}

class KernelTaskGraph implements TaskGraphContract {
	async buildWaves(projectId: string): Promise<import("@oscorpex/core").PipelineStage[][]> {
		const { listProjectAgents, listAgentDependencies } = await import("../db.js");
		const agents = await listProjectAgents(projectId);
		const deps = await listAgentDependencies(projectId);
		const { buildDAGWaves } = await import("@oscorpex/task-graph");
		// ProjectAgent and AgentDependency are structurally compatible with GraphAgent
		// and DependencyEdge. The task-graph package uses `id` + `pipelineOrder` /
		// `from` + `to` — both present on the kernel types.
		const waveIds = buildDAGWaves(
			agents as import("@oscorpex/task-graph").GraphAgent[],
			deps as import("@oscorpex/task-graph").DependencyEdge[],
		);
		// Map agent ID waves to empty PipelineStage shells (order only)
		return waveIds.map((wave, idx) =>
			wave.map((agentId) => ({
				order: idx,
				agents: [{ id: agentId }],
				tasks: [],
				status: "pending" as const,
			})),
		);
	}
	async resolveDependencies(taskId: string): Promise<string[]> {
		const { getTask } = await import("../db.js");
		const task = await getTask(taskId);
		return task?.dependsOn ?? [];
	}
	async getExecutionOrder(projectId: string): Promise<string[]> {
		const waves = await this.buildWaves(projectId);
		return (
			waves
				.flat()
				// agents is typed as unknown in the core contract — extract id via narrowing
				.map((s: import("@oscorpex/core").PipelineStage) => (s.agents as Array<{ id?: string }>)?.[0]?.id)
				.filter((id): id is string => id !== undefined)
		);
	}
}

// ---------------------------------------------------------------------------
// OscorpexKernel — facade class
// ---------------------------------------------------------------------------

class OscorpexKernelImpl implements OscorpexKernelContract {
	readonly hooks: HookRegistry = hookRegistry;
	readonly events: EventPublisher = new KernelEventPublisher();
	readonly runs: RunStore = new KernelRunStore();
	readonly tasks: TaskStore = new KernelTaskStore();
	readonly providers: Map<string, ProviderAdapter> = new Map();
	readonly scheduler: Scheduler = new KernelScheduler();
	readonly graph: TaskGraphContract = new KernelTaskGraph();

	// Subsystem stubs — wired incrementally over Phase 10-12
	// These throw clear errors if called before wiring is complete.
	get verification(): VerificationRunner {
		return verificationRunner;
	}
	get policy(): PolicyEngineContract {
		return policyEngine;
	}
	get cost(): CostReporter {
		return costReporter;
	}
	get memory(): MemoryProvider {
		return memoryProvider;
	}
	get replay(): ReplayStore {
		return replayStore;
	}

	// --- Run lifecycle ---

	async createRun(input: { projectId: string; goal: string; mode: RunMode }): Promise<Run> {
		const { randomUUID } = await import("node:crypto");
		const run: Run = {
			id: randomUUID(),
			projectId: input.projectId,
			goal: input.goal,
			mode: input.mode,
			status: "created",
			createdAt: new Date().toISOString(),
		};
		const created = await this.runs.create(run);
		eventBus.emit({
			projectId: input.projectId,
			type: "run:created",
			payload: { runId: created.id, goal: input.goal, mode: input.mode },
		});
		return created;
	}

	async getRun(runId: string): Promise<Run | null> {
		return this.runs.get(runId);
	}

	async startRun(runId: string): Promise<Run> {
		const run = await this.runs.get(runId);
		if (!run) throw new Error(`Run ${runId} not found`);
		const { canTransitionRun } = await import("@oscorpex/core");
		if (!canTransitionRun(run.status, "running"))
			throw new Error(`Cannot transition run ${runId} from ${run.status} to running`);
		const updated = await this.runs.update(runId, { status: "running", startedAt: new Date().toISOString() });
		eventBus.emit({ projectId: run.projectId, type: "run:started", payload: { runId } });
		return updated;
	}

	async pauseRun(runId: string): Promise<Run> {
		const run = await this.runs.get(runId);
		if (!run) throw new Error(`Run ${runId} not found`);
		const { canTransitionRun } = await import("@oscorpex/core");
		if (!canTransitionRun(run.status, "paused"))
			throw new Error(`Cannot transition run ${runId} from ${run.status} to paused`);
		const updated = await this.runs.update(runId, { status: "paused" });
		eventBus.emit({ projectId: run.projectId, type: "run:paused", payload: { runId } });
		return updated;
	}

	async resumeRun(runId: string): Promise<Run> {
		const run = await this.runs.get(runId);
		if (!run) throw new Error(`Run ${runId} not found`);
		const { canTransitionRun } = await import("@oscorpex/core");
		if (!canTransitionRun(run.status, "running"))
			throw new Error(`Cannot transition run ${runId} from ${run.status} to running`);
		const updated = await this.runs.update(runId, { status: "running" });
		eventBus.emit({ projectId: run.projectId, type: "run:resumed", payload: { runId } });
		return updated;
	}

	async failRun(runId: string, reason: string): Promise<Run> {
		const run = await this.runs.get(runId);
		if (!run) throw new Error(`Run ${runId} not found`);
		const { canTransitionRun } = await import("@oscorpex/core");
		if (!canTransitionRun(run.status, "failed"))
			throw new Error(`Cannot transition run ${runId} from ${run.status} to failed`);
		const updated = await this.runs.update(runId, { status: "failed", completedAt: new Date().toISOString() });
		eventBus.emit({ projectId: run.projectId, type: "run:failed", payload: { runId, reason } });
		return updated;
	}

	async completeRun(runId: string): Promise<Run> {
		const run = await this.runs.get(runId);
		if (!run) throw new Error(`Run ${runId} not found`);
		const { canTransitionRun } = await import("@oscorpex/core");
		if (!canTransitionRun(run.status, "completed"))
			throw new Error(`Cannot transition run ${runId} from ${run.status} to completed`);
		const updated = await this.runs.update(runId, { status: "completed", completedAt: new Date().toISOString() });
		eventBus.emit({ projectId: run.projectId, type: "run:completed", payload: { runId } });
		return updated;
	}

	// --- Task lifecycle — delegates to taskEngine + hooks ---

	async assignTask(taskId: string, agentId: string): Promise<CoreTask> {
		const result = await taskEngine.assignTask(taskId, agentId);
		return toCoreTask(result);
	}

	async startTask(taskId: string): Promise<CoreTask> {
		const ctx: HookContext = { runId: "", taskId, projectId: "" };
		const proceed = await runHooks("before_task_start", ctx);
		if (!proceed) throw new Error(`Task ${taskId} blocked by pre-start hook`);

		const result = await taskEngine.startTask(taskId);
		return toCoreTask(result);
	}

	async completeTask(taskId: string, output?: CoreTaskOutput): Promise<CoreTask> {
		const kernelOutput = output !== undefined ? toKernelTaskOutput(output) : undefined;
		const result = await taskEngine.completeTask(
			taskId,
			// completeTask requires a non-optional TaskOutput; supply an empty one when omitted
			kernelOutput ?? { filesCreated: [], filesModified: [], logs: [] },
		);
		await runHooks("after_task_complete", { runId: "", taskId: result.id, projectId: "" });
		return toCoreTask(result);
	}

	async failTask(taskId: string, error: string): Promise<CoreTask> {
		const result = await taskEngine.failTask(taskId, error);
		await runHooks("after_task_fail", { runId: "", taskId: result.id, projectId: "", metadata: { error } });
		return toCoreTask(result);
	}

	async retryTask(taskId: string): Promise<CoreTask> {
		const result = await taskEngine.retryTask(taskId);
		return toCoreTask(result);
	}

	async submitReview(taskId: string, approved: boolean, feedback?: string): Promise<CoreTask> {
		const result = await taskEngine.submitReview(taskId, approved, feedback);
		return toCoreTask(result);
	}

	async restartRevision(taskId: string): Promise<CoreTask> {
		const result = await taskEngine.restartRevision(taskId);
		return toCoreTask(result);
	}

	async approveTask(taskId: string): Promise<CoreTask> {
		const result = await taskEngine.approveTask(taskId);
		return toCoreTask(result);
	}

	async rejectTask(taskId: string, reason?: string): Promise<CoreTask> {
		const result = await taskEngine.rejectTask(taskId, reason);
		return toCoreTask(result);
	}

	async executeTask(projectId: string, task: CoreTask): Promise<void> {
		executionEngine.executeTask(projectId, toKernelTask(task)).catch((err) => {
			// eslint-disable-next-line no-console
			console.warn("[kernel] executeTask background error:", err?.message ?? err);
		});
	}

	async startPipeline(projectId: string): Promise<void> {
		try {
			await pipelineEngine.startPipeline(projectId);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const retryableRunningState =
				message.includes("duplicate key value violates unique constraint") || message.includes("already exists");
			if (!retryableRunningState) {
				throw err;
			}
		}

		// Ensure dispatcher is always kicked, even when pipeline run already exists.
		await executionEngine.startProjectExecution(projectId);
	}

	async advancePipeline(projectId: string): Promise<void> {
		await pipelineEngine.advanceStage(projectId);
	}

	async startProjectExecution(projectId: string): Promise<void> {
		await executionEngine.startProjectExecution(projectId);
	}

	async getProjectProgress(projectId: string): Promise<any> {
		return taskEngine.getProgress(projectId);
	}

	async getPipelineStatus(projectId: string): Promise<any> {
		return pipelineEngine.getEnrichedPipelineStatus(projectId);
	}

	async getExecutionStatus(projectId: string): Promise<any> {
		return executionEngine.getExecutionStatus(projectId);
	}

	async pausePipeline(projectId: string): Promise<void> {
		await pipelineEngine.pausePipeline(projectId);
	}

	async resumePipeline(projectId: string): Promise<void> {
		await pipelineEngine.resumePipeline(projectId);
	}

	async retryPipeline(projectId: string): Promise<void> {
		await pipelineEngine.retryFailedPipeline(projectId);
	}

	// --- Kernel-first passthroughs for routes that still import engines directly ---

	async getReadyTasks(phaseId: string): Promise<any[]> {
		return taskEngine.getReadyTasks(phaseId);
	}

	async runStandup(projectId: string): Promise<any> {
		const { runStandup } = await import("../ceremony-engine.js");
		return runStandup(projectId);
	}

	async runRetrospective(projectId: string): Promise<any> {
		const { runRetrospective } = await import("../ceremony-engine.js");
		return runRetrospective(projectId);
	}

	// --- Goal engine passthroughs ---

	async listGoals(projectId: string, status?: string): Promise<any[]> {
		const { listGoals } = await import("../goal-engine.js");
		return listGoals(projectId, status as import("../goal-engine.js").GoalStatus | undefined);
	}

	async getGoal(goalId: string): Promise<any | null> {
		const { getGoal } = await import("../goal-engine.js");
		return getGoal(goalId);
	}

	async getGoalForTask(taskId: string): Promise<any | null> {
		const { getGoalForTask } = await import("../goal-engine.js");
		return getGoalForTask(taskId);
	}

	async createGoal(input: { projectId: string; taskId?: string; definition: any }): Promise<any> {
		const { createGoal } = await import("../goal-engine.js");
		return createGoal(input);
	}

	async activateGoal(goalId: string): Promise<any> {
		const { activateGoal } = await import("../goal-engine.js");
		return activateGoal(goalId);
	}

	async evaluateGoal(goalId: string, results: any[]): Promise<any> {
		const { evaluateGoal } = await import("../goal-engine.js");
		return evaluateGoal(goalId, results);
	}

	async failGoal(goalId: string, reason: string): Promise<any> {
		const { failGoal } = await import("../goal-engine.js");
		return failGoal(goalId, reason);
	}

	// --- Provider execution (stub) ---

	async executeWithProvider(providerId: string, input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
		return providerRegistry.execute(providerId, input);
	}

	// --- Status queries — delegates to pipelineEngine ---

	async getProjectStatus(projectId: string): Promise<ProjectStatus | null> {
		const { getProject } = await import("../db.js");
		const project = await getProject(projectId);
		return (project?.status as ProjectStatus) ?? null;
	}

	async getPipelineState(projectId: string): Promise<PipelineState | null> {
		const state = await pipelineEngine.getPipelineState(projectId);
		return state !== null ? toCorePipelineState(state) : null;
	}
}

export const kernel = new OscorpexKernelImpl();

// Re-export hook utilities for convenient external use
export { hookRegistry, runHooks };
