// ---------------------------------------------------------------------------
// pipeline/ barrel — re-exports all pipeline sub-modules
// ---------------------------------------------------------------------------

export { PipelineBranchManager } from "./vcs-phase-hooks.js";
export { PipelineStateManager, runToState } from "./pipeline-state-service.js";
export { PipelineBuildService } from "./pipeline-build-service.js";
export { PipelineCompletionService } from "./pipeline-completion-service.js";
export { PipelineControlService } from "./pipeline-control-service.js";
export { PipelineReviewHelpers } from "./pipeline-review-helpers.js";
export { PipelineTaskHook } from "./pipeline-task-hook.js";
export { canAdvance } from "./replan-gate.js";
export { decideStageAdvance, type StageAdvanceDecision } from "./stage-advance-service.js";
