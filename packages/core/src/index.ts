// @oscorpex/core — Provider-agnostic execution kernel
// Barrel export of all domain types, contract interfaces, errors, and utilities.

// --- Domain types ---
export type {
	RunStatus,
	RunMode,
	ProjectStatus,
} from "./domain/run.js";
export type { Run } from "./domain/run.js";
export { VALID_PROJECT_TRANSITIONS } from "./domain/run.js";

export type {
	TaskStatus,
	TaskType,
	TaskComplexity,
	ApprovalStatus,
	RiskLevel,
} from "./domain/task.js";
export type { TaskOutput, Task } from "./domain/task.js";

export type {
	PipelineStageStatus,
	PipelineStatus,
	PhaseStatus,
} from "./domain/stage.js";
export type { Stage, PipelineStage, PipelineState, PipelineRun } from "./domain/stage.js";

export type { ArtifactManifest } from "./domain/artifact.js";

export type {
	ProviderExecutionInput,
	ProviderExecutionUsage,
	ProviderExecutionResult,
	ProviderCapabilities,
	ProviderHealth,
} from "./domain/provider.js";
export type { ProviderAdapter as ProviderAdapterType } from "./domain/provider.js";

export type {
	VerificationStrictness,
	VerificationType,
	TestPolicy,
	GoalEnforcementMode,
	GoalStatus,
} from "./domain/verification.js";
export type {
	VerificationDetail,
	VerificationResult,
	VerificationReport,
	GateResult,
	CriterionResult,
	GoalDefinition,
	ExecutionGoal,
	VerificationInput,
} from "./domain/verification.js";

export type {
	PolicyAction,
	CapabilityScopeType,
	CapabilityPermission,
	SandboxEnforcementMode,
	DependencyType,
} from "./domain/policy.js";
export type {
	PolicyDecision,
	PolicyRule,
	AgentCapability,
	SandboxPolicy,
	SandboxViolation,
	SandboxSession,
	PolicyEvaluationInput,
} from "./domain/policy.js";

export type { ContextPacketMode } from "./domain/memory.js";
export type {
	ContextPacket,
	ContextPacketOptions,
	ProjectContextSnapshot,
	MemoryFact,
} from "./domain/memory.js";

export type { ReplaySnapshot } from "./domain/replay.js";

export type {
	CostRecord,
	BudgetCheck,
	ProjectCostSummary,
	CostBreakdownEntry,
	TokenUsage,
} from "./domain/cost.js";

export type { EventType } from "./domain/events.js";
export type { BaseEvent, LegacyStudioEvent } from "./domain/events.js";

// --- State machines ---
export { PROJECT_TRANSITIONS, canTransitionProject } from "./domain/state-machines.js";
export { TASK_TRANSITIONS, canTransitionTask } from "./domain/state-machines.js";
export { PIPELINE_STATUS_TRANSITIONS, canTransitionPipeline } from "./domain/state-machines.js";
export { STAGE_STATUS_TRANSITIONS, canTransitionStage } from "./domain/state-machines.js";
export { PHASE_STATUS_TRANSITIONS, canTransitionPhase } from "./domain/state-machines.js";
export { RUN_TRANSITIONS, canTransitionRun } from "./domain/state-machines.js";

// --- Contract interfaces ---
export type { ProviderAdapter } from "./contracts/provider-adapter.js";
export type { EventPublisher } from "./contracts/event-publisher.js";
export type { Scheduler } from "./contracts/scheduler.js";
export type { TaskGraph } from "./contracts/task-graph.js";
export type { RunStore, RunListFilter } from "./contracts/run-store.js";
export type { TaskStore, TaskListFilter } from "./contracts/task-store.js";
export type {
	WorkspaceAdapter,
	WorkspaceStatus,
	WorkspaceConfig,
} from "./contracts/workspace-adapter.js";
export type { VerificationRunner } from "./contracts/verification-runner.js";
export type { PolicyEngine } from "./contracts/policy-engine.js";
export type { ReplayStore } from "./contracts/replay-store.js";
export type { CostReporter } from "./contracts/cost-reporter.js";
export type { MemoryProvider } from "./contracts/memory-provider.js";
export type { HookPhase, HookContext, HookResult, SyncHook, AsyncHook, HookRegistration, HookRegistry } from "./contracts/hook-registry.js";
export type { OscorpexKernel } from "./contracts/kernel.js";

// --- Errors ---
export {
	OscorpexError,
	TaskTransitionError,
	PipelineError,
	PhaseTransitionError,
} from "./errors/domain-errors.js";

export {
	ProviderUnavailableError,
	ProviderTimeoutError,
	ProviderExecutionError,
	ProviderRateLimitError,
} from "./errors/provider-errors.js";

export {
	PolicyViolationError,
	SandboxViolationError,
	ApprovalRequiredError,
} from "./errors/policy-errors.js";

// --- Utilities ---
export { generateId, parseId, isId } from "./utils/ids.js";
export { ok, err, isOk, isErr, mapOk, mapErr, unwrap } from "./utils/result.js";
export type { Result } from "./utils/result.js";
export { now, isWithinWindow, durationMs, formatDuration } from "./utils/time.js";
export type { TimeWindow } from "./utils/time.js";