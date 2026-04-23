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
import { replayStore } from "../replay-store.js";

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
		throw new Error("RunStore.create not yet wired — Phase 10 stub");
	}
	async get(id: string): Promise<Run | null> {
		throw new Error("RunStore.get not yet wired — Phase 10 stub");
	}
	async update(id: string, partial: Partial<Run>): Promise<Run> {
		throw new Error("RunStore.update not yet wired — Phase 10 stub");
	}
	async list(filter: import("@oscorpex/core").RunListFilter): Promise<Run[]> {
		throw new Error("RunStore.list not yet wired — Phase 10 stub");
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
	buildWaves(phases: import("@oscorpex/core").PipelineStage[]): import("@oscorpex/core").PipelineStage[][] {
		throw new Error("TaskGraph.buildWaves not yet wired — Phase 10 stub");
	}
	resolveDependencies(taskId: string): string[] {
		throw new Error("TaskGraph.resolveDependencies not yet wired — Phase 10 stub");
	}
	getExecutionOrder(): string[] {
		throw new Error("TaskGraph.getExecutionOrder not yet wired — Phase 10 stub");
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
		throw new Error("VerificationRunner not yet wired — Phase 10 stub");
	}
	get policy(): PolicyEngineContract {
		throw new Error("PolicyEngine not yet wired — Phase 10 stub");
	}
	get cost(): CostReporter {
		throw new Error("CostReporter not yet wired — Phase 10 stub");
	}
	get memory(): MemoryProvider {
		throw new Error("MemoryProvider not yet wired — Phase 10 stub");
	}
	get replay(): ReplayStore {
		return replayStore;
	}

	// --- Run lifecycle (stubs — full wiring in Phase 12) ---

	async createRun(_input: { projectId: string; goal: string; mode: RunMode }): Promise<Run> {
		throw new Error("OscorpexKernel.createRun not yet wired — Phase 10 stub");
	}
	async getRun(_runId: string): Promise<Run | null> {
		throw new Error("OscorpexKernel.getRun not yet wired — Phase 10 stub");
	}
	async startRun(_runId: string): Promise<Run> {
		throw new Error("OscorpexKernel.startRun not yet wired — Phase 10 stub");
	}
	async pauseRun(_runId: string): Promise<Run> {
		throw new Error("OscorpexKernel.pauseRun not yet wired — Phase 10 stub");
	}
	async resumeRun(_runId: string): Promise<Run> {
		throw new Error("OscorpexKernel.resumeRun not yet wired — Phase 10 stub");
	}
	async failRun(_runId: string, _reason: string): Promise<Run> {
		throw new Error("OscorpexKernel.failRun not yet wired — Phase 10 stub");
	}
	async completeRun(_runId: string): Promise<Run> {
		throw new Error("OscorpexKernel.completeRun not yet wired — Phase 10 stub");
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

	// --- Provider execution (stub) ---

	async executeWithProvider(_providerId: string, _input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
		throw new Error("OscorpexKernel.executeWithProvider not yet wired — Phase 10 stub");
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