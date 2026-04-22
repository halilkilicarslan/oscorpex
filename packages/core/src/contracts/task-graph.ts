// @oscorpex/core — TaskGraph contract
// Interface for building and querying the DAG execution graph.

import type { PipelineStage } from "../domain/stage.js";

export interface TaskGraph {
	buildWaves(phases: PipelineStage[]): PipelineStage[][];
	resolveDependencies(taskId: string): string[];
	getExecutionOrder(): string[];
}