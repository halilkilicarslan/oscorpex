// ---------------------------------------------------------------------------
// Oscorpex — execution/ barrel
// ---------------------------------------------------------------------------

export {
	ProviderExecutionService,
	isProvidersExhausted,
	type ExecuteTaskWithProviderInput,
	type NormalizedProviderResult,
	type ProvidersExhaustedResult,
} from "./provider-execution-service.js";
export { TaskExecutor, TaskTimeoutError } from "./task-executor.js";
export { startTaskForExecution } from "./task-start-service.js";
export { runProviderTask } from "./provider-task-runner.js";
export { executeSpecialTask } from "./special-task-runner.js";
export { executeTaskReview } from "./review-task-runner.js";
export {
	closeSandboxExecution,
	enforceSandboxHardPreflight,
	enforceSandboxPostExecution,
	enforceSandboxPreExecution,
	setupSandboxExecution,
	type SandboxExecutionContext,
} from "./sandbox-execution-guard.js";
export { runGoalGate, runOutputAndTestGates } from "./execution-gates-runner.js";
export { buildTaskOutput, recordOutputReceived, runTaskCompletionEffects } from "./task-output-handler.js";
export { computeQueueWaitMs } from "./queue-wait.js";
export { withTimeout } from "./task-timeout.js";
export { TaskDispatcher } from "./dispatch-coordinator.js";
export { ExecutionRecovery, runStartupRecoveryWithRetry } from "./execution-recovery.js";
export { ExecutionWatchdog } from "./execution-watchdog.js";
