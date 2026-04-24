// @oscorpex/kernel — OscorpexKernel facade implementation
// Thin delegation layer that wires together the existing subsystems
// (task-engine, pipeline-engine, execution-engine, event-bus) under the
// single OscorpexKernel interface from @oscorpex/core.
// No behavioral changes — all calls delegate to the same singletons.

import type {
	HookContext,
	HookPhase,
	HookRegistry,
	HookRegistration,
	HookResult,
	EventPublisher,
	RunStore,
	TaskStore,
	ProviderAdapter,
	VerificationRunner,
	PolicyEngine as PolicyEngineContract,
	CostReporter,
	MemoryProvider,
	ReplayStore,
	Scheduler,
	TaskGraph as TaskGraphContract,
	OscorpexKernel as OscorpexKernelContract,
	Run,
	RunMode,
	RunStatus,
	TaskOutput as CoreTaskOutput,
	PipelineState,
	PipelineStatus,
	ProjectStatus,
	ProviderExecutionInput,
	ProviderExecutionResult,
	VerificationInput,
	VerificationReport,
	VerificationResult,
	PolicyDecision,
	PolicyEvaluationInput,
	CostRecord,
	ProjectCostSummary,
	BudgetCheck,
	ContextPacketOptions,
	ContextPacket,
	ReplaySnapshot,
	Task as CoreTask,
	TaskStatus as CoreTaskStatus,
} from "@oscorpex/core";
import { hookRegistry, runHooks } from "./hook-registry.js";
import { eventBus } from "../event-bus.js";
import { taskEngine } from "../task-engine.js";
import { pipelineEngine } from "../pipeline-engine.js";
import { executionEngine } from "../execution-engine.js";
import { replayStore } from "../replay-store.js";
import { verificationRunner } from "./verification-adapter.js";
import { policyEngine } from "./policy-adapter.js";
import { costReporter } from "./cost-adapter.js";
import { providerRegistry } from "./provider-registry.js";
import { memoryProvider } from "./memory-adapter.js";

// ---------------------------------------------------------------------------
// Adapter wrappers — kernel singletons behind contract interfaces
// ---------------------------------------------------------------------------

class KernelEventPublisher implements EventPublisher {
	async publish<TPayload>(event: import("@oscorpex/core").BaseEvent<string, TPayload>): Promise<void> {
		eventBus.emit(event as any);
	}
	publishTransient<TPayload>(event: import("@oscorpex/core").BaseEvent<string, TPayload>): void {
		eventBus.emitTransient(event as any);
	}
}

class KernelTaskStore implements TaskStore {
	async create(task: CoreTask): Promise<CoreTask> {
		const { createTask } = await import("../db.js");
		const result = await createTask(task as any);
		return result as unknown as CoreTask;
	}
	async get(id: string): Promise<CoreTask | null> {
		const { getTask } = await import("../db.js");
		const t = await getTask(id);
		return t ? (t as unknown as CoreTask) : null;
	}
	async update(id: string, partial: Partial<CoreTask>): Promise<CoreTask> {
		const { updateTask } = await import("../db.js");
		return (await updateTask(id, partial as any)) as unknown as CoreTask;
	}
	async list(filter: import("@oscorpex/core").TaskListFilter): Promise<CoreTask[]> {
		const { listProjectTasks } = await import("../db.js");
		if (filter.projectId) {
			return (await listProjectTasks(filter.projectId)) as unknown as CoreTask[];
		}
		return [];
	}
	async claim(id: string, workerId: string): Promise<CoreTask> {
		const { claimTask } = await import("../db.js");
		const result = await claimTask(id, workerId);
		return result as unknown as CoreTask;
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
		return taskEngine.getReadyTasks(runId) as unknown as CoreTask[];
	}
	async claim(taskId: string, workerId: string): Promise<CoreTask> {
		const { claimTask } = await import("../db.js");
		return (await claimTask(taskId, workerId)) as unknown as CoreTask;
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
		const waveIds = buildDAGWaves(agents as any, deps as any);
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
		return waves.flat().map((s: any) => s.agents?.[0]?.id).filter(Boolean);
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
		eventBus.emit({ projectId: input.projectId, type: "run:created", payload: { runId: created.id, goal: input.goal, mode: input.mode } });
		return created;
	}

	async getRun(runId: string): Promise<Run | null> {
		return this.runs.get(runId);
	}

	async startRun(runId: string): Promise<Run> {
		const run = await this.runs.get(runId);
		if (!run) throw new Error(`Run ${runId} not found`);
		const { canTransitionRun } = await import("@oscorpex/core");
		if (!canTransitionRun(run.status, "running")) throw new Error(`Cannot transition run ${runId} from ${run.status} to running`);
		const updated = await this.runs.update(runId, { status: "running", startedAt: new Date().toISOString() });
		eventBus.emit({ projectId: run.projectId, type: "run:started", payload: { runId } });
		return updated;
	}

	async pauseRun(runId: string): Promise<Run> {
		const run = await this.runs.get(runId);
		if (!run) throw new Error(`Run ${runId} not found`);
		const { canTransitionRun } = await import("@oscorpex/core");
		if (!canTransitionRun(run.status, "paused")) throw new Error(`Cannot transition run ${runId} from ${run.status} to paused`);
		const updated = await this.runs.update(runId, { status: "paused" });
		eventBus.emit({ projectId: run.projectId, type: "run:paused", payload: { runId } });
		return updated;
	}

	async resumeRun(runId: string): Promise<Run> {
		const run = await this.runs.get(runId);
		if (!run) throw new Error(`Run ${runId} not found`);
		const { canTransitionRun } = await import("@oscorpex/core");
		if (!canTransitionRun(run.status, "running")) throw new Error(`Cannot transition run ${runId} from ${run.status} to running`);
		const updated = await this.runs.update(runId, { status: "running" });
		eventBus.emit({ projectId: run.projectId, type: "run:resumed", payload: { runId } });
		return updated;
	}

	async failRun(runId: string, reason: string): Promise<Run> {
		const run = await this.runs.get(runId);
		if (!run) throw new Error(`Run ${runId} not found`);
		const { canTransitionRun } = await import("@oscorpex/core");
		if (!canTransitionRun(run.status, "failed")) throw new Error(`Cannot transition run ${runId} from ${run.status} to failed`);
		const updated = await this.runs.update(runId, { status: "failed", completedAt: new Date().toISOString() });
		eventBus.emit({ projectId: run.projectId, type: "run:failed", payload: { runId, reason } });
		return updated;
	}

	async completeRun(runId: string): Promise<Run> {
		const run = await this.runs.get(runId);
		if (!run) throw new Error(`Run ${runId} not found`);
		const { canTransitionRun } = await import("@oscorpex/core");
		if (!canTransitionRun(run.status, "completed")) throw new Error(`Cannot transition run ${runId} from ${run.status} to completed`);
		const updated = await this.runs.update(runId, { status: "completed", completedAt: new Date().toISOString() });
		eventBus.emit({ projectId: run.projectId, type: "run:completed", payload: { runId } });
		return updated;
	}

	// --- Task lifecycle — delegates to taskEngine + hooks ---

	async assignTask(taskId: string, agentId: string): Promise<CoreTask> {
		const result = await taskEngine.assignTask(taskId, agentId);
		return result as unknown as CoreTask;
	}

	async startTask(taskId: string): Promise<CoreTask> {
		const ctx: HookContext = { runId: "", taskId, projectId: "" };
		const proceed = await runHooks("before_task_start", ctx);
		if (!proceed) throw new Error(`Task ${taskId} blocked by pre-start hook`);

		const result = await taskEngine.startTask(taskId);
		return result as unknown as CoreTask;
	}

	async completeTask(taskId: string, output?: CoreTaskOutput): Promise<CoreTask> {
		const result = await taskEngine.completeTask(taskId, output as any);
		await runHooks("after_task_complete", { runId: "", taskId: result.id, projectId: "" });
		return result as unknown as CoreTask;
	}

	async failTask(taskId: string, error: string): Promise<CoreTask> {
		const result = await taskEngine.failTask(taskId, error);
		await runHooks("after_task_fail", { runId: "", taskId: result.id, projectId: "", metadata: { error } });
		return result as unknown as CoreTask;
	}

	async retryTask(taskId: string): Promise<CoreTask> {
		const result = await taskEngine.retryTask(taskId);
		return result as unknown as CoreTask;
	}

	async submitReview(taskId: string, approved: boolean, feedback?: string): Promise<CoreTask> {
		const result = await taskEngine.submitReview(taskId, approved, feedback);
		return result as unknown as CoreTask;
	}

	async restartRevision(taskId: string): Promise<CoreTask> {
		const result = await taskEngine.restartRevision(taskId);
		return result as unknown as CoreTask;
	}

	async approveTask(taskId: string): Promise<CoreTask> {
		const result = await taskEngine.approveTask(taskId);
		return result as unknown as CoreTask;
	}

	async rejectTask(taskId: string, reason?: string): Promise<CoreTask> {
		const result = await taskEngine.rejectTask(taskId, reason);
		return result as unknown as CoreTask;
	}

	async executeTask(projectId: string, task: CoreTask): Promise<void> {
		executionEngine.executeTask(projectId, task as any).catch((err) => {
			// eslint-disable-next-line no-console
			console.warn("[kernel] executeTask background error:", err?.message ?? err);
		});
	}

	async startPipeline(projectId: string): Promise<void> {
		await pipelineEngine.startPipeline(projectId);
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
		return listGoals(projectId, status as any);
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
		return state as PipelineState | null;
	}
}

export const kernel = new OscorpexKernelImpl();

// Re-export hook utilities for convenient external use
export { hookRegistry, runHooks };