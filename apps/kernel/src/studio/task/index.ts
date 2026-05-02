// ---------------------------------------------------------------------------
// task/ barrel — re-exports task sub-services
// ---------------------------------------------------------------------------

export * from "./approval-service.js";
export * from "./review-loop-service.js";
export * from "./task-progress-service.js";
export {
	TaskLifecycle,
	isStrictFixTask,
	type GetProjectIdCallback,
	type NotifyCompletedCallback as TaskLifecycleNotifyCompletedCallback,
	type RequireTaskCallback,
} from "./task-lifecycle-service.js";
export * from "./zero-file-guard.js";
export * from "./task-completion-effects.js";
export {
	checkSubtaskRollup,
	type NotifyCompletedCallback as SubtaskRollupNotifyCompletedCallback,
} from "./subtask-rollup-service.js";
