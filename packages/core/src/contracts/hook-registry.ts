// @oscorpex/core — Hook registry types
// The kernel uses hooks to call into verification, policy, cost, memory, etc.
// Hooks are registered at boot time and called synchronously or asynchronously
// at well-defined points in the task/pipeline lifecycle.

export type HookPhase =
	| "before_task_start"
	| "after_task_complete"
	| "after_task_fail"
	| "before_pipeline_start"
	| "after_pipeline_complete"
	| "after_pipeline_fail"
	| "before_stage_advance"
	| "after_stage_advance"
	| "before_provider_execute"
	| "after_provider_execute"
	| "before_approval"
	| "after_approval";

export interface HookContext {
	runId: string;
	taskId?: string;
	projectId: string;
	stageId?: string;
	agentId?: string;
	provider?: string;
	metadata?: Record<string, unknown>;
}

export interface HookResult {
	proceed: boolean;
	reason?: string;
	modifiedContext?: Partial<HookContext>;
}

export type SyncHook = (ctx: HookContext) => HookResult;
export type AsyncHook = (ctx: HookContext) => Promise<HookResult>;

export interface HookRegistration {
	id: string;
	phase: HookPhase;
	hook: SyncHook | AsyncHook;
	priority: number;
	description?: string;
}

export interface HookRegistry {
	register(registration: HookRegistration): void;
	unregister(hookId: string): void;
	getHooks(phase: HookPhase): HookRegistration[];
	clear(): void;
}