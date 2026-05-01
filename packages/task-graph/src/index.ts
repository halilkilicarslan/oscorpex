// @oscorpex/task-graph — DAG-based task scheduling and stage building
// Pure functions extracted from kernel's pipeline-engine.ts.
// No DB or event-bus dependencies — those remain in the kernel layer.

// Re-export canonical types from @oscorpex/core
export type {
	PipelineStage,
	PipelineStageStatus,
	PipelineStatus,
	PipelineState,
	PipelineRun,
	PhaseStatus,
	Stage,
} from "@oscorpex/core";

// Local types (lightweight input interfaces)
export type {
	GraphAgent,
	DependencyEdge,
	DependencyType,
	PlanTask,
	PlanPhase,
	StagePlan,
} from "./types.js";

// DAG topology
export { buildDAGWaves, findReviewerAgentId, findDevAgentId } from "./dag.js";
export type { DAGWaveResult } from "./dag.js";

// Stage building
export { buildDAGStages, buildLinearStages, buildAgentMatchSet, taskAssignedToStageAgents } from "./stages.js";
export type { AgentMatchSet } from "./stages.js";