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
export { computeQueueWaitMs } from "./queue-wait.js";
export { withTimeout } from "./task-timeout.js";
export { TaskDispatcher } from "./dispatch-coordinator.js";
export { ExecutionRecovery, runStartupRecoveryWithRetry } from "./execution-recovery.js";
export { ExecutionWatchdog } from "./execution-watchdog.js";
