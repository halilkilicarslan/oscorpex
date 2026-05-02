// ---------------------------------------------------------------------------
// pipeline/ barrel — re-exports all pipeline sub-modules
// ---------------------------------------------------------------------------

export { PipelineBranchManager } from "./vcs-phase-hooks.js";
export { PipelineStateManager, runToState } from "./pipeline-state-service.js";
export { canAdvance } from "./replan-gate.js";
export { decideStageAdvance, type StageAdvanceDecision } from "./stage-advance-service.js";
