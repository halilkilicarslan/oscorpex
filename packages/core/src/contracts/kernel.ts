// @oscorpex/core — Kernel facade interface
// The OscorpexKernel is the single entry point for all execution operations.
// External code talks to the kernel; the kernel delegates to stores, adapters,
// and hooks. This interface defines the contract — implementation comes in Phase 10.

import type { Run, RunStatus, ProjectStatus } from "../domain/run.js";
import type { Task, TaskStatus } from "../domain/task.js";
import type { PipelineState, PipelineStatus } from "../domain/stage.js";
import type { ProviderExecutionInput, ProviderExecutionResult } from "../domain/provider.js";
import type { HookRegistry } from "./hook-registry.js";
import type { EventPublisher } from "./event-publisher.js";
import type { RunStore } from "./run-store.js";
import type { TaskStore } from "./task-store.js";
import type { ProviderAdapter } from "./provider-adapter.js";
import type { VerificationRunner } from "./verification-runner.js";
import type { PolicyEngine } from "./policy-engine.js";
import type { CostReporter } from "./cost-reporter.js";
import type { MemoryProvider } from "./memory-provider.js";
import type { ReplayStore } from "./replay-store.js";
import type { Scheduler } from "./scheduler.js";
import type { TaskGraph } from "./task-graph.js";

export interface OscorpexKernel {
	// --- Subsystem accessors ---
	readonly hooks: HookRegistry;
	readonly events: EventPublisher;
	readonly runs: RunStore;
	readonly tasks: TaskStore;
	readonly providers: Map<string, ProviderAdapter>;
	readonly verification: VerificationRunner;
	readonly policy: PolicyEngine;
	readonly cost: CostReporter;
	readonly memory: MemoryProvider;
	readonly replay: ReplayStore;
	readonly scheduler: Scheduler;
	readonly graph: TaskGraph;

	// --- Run lifecycle ---
	createRun(input: { projectId: string; goal: string; mode: import("../domain/run.js").RunMode }): Promise<Run>;
	getRun(runId: string): Promise<Run | null>;
	startRun(runId: string): Promise<Run>;
	pauseRun(runId: string): Promise<Run>;
	resumeRun(runId: string): Promise<Run>;
	failRun(runId: string, reason: string): Promise<Run>;
	completeRun(runId: string): Promise<Run>;

	// --- Task lifecycle ---
	assignTask(taskId: string, agentId: string): Promise<Task>;
	startTask(taskId: string): Promise<Task>;
	completeTask(taskId: string, output?: import("../domain/task.js").TaskOutput): Promise<Task>;
	failTask(taskId: string, error: string): Promise<Task>;
	retryTask(taskId: string): Promise<Task>;

	// --- Provider execution ---
	executeWithProvider(providerId: string, input: ProviderExecutionInput): Promise<ProviderExecutionResult>;

	// --- Status queries ---
	getProjectStatus(projectId: string): Promise<ProjectStatus | null>;
	getPipelineState(projectId: string): Promise<PipelineState | null>;
}