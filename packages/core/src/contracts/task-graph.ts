// @oscorpex/core — TaskGraph contract
// Interface for building and querying the DAG execution graph.

import type { PipelineStage } from "../domain/stage.js";

export interface TaskGraph {
	buildWaves(projectId: string): Promise<PipelineStage[][]>;
	resolveDependencies(taskId: string): Promise<string[]>;
	getExecutionOrder(projectId: string): Promise<string[]>;
}