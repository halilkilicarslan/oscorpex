import { registerJob } from "../scheduler-registry.js";
import { memoryPruningPlanner } from "./memory-pruning-planner.js";

export function registerMemoryPruningJob(): void {
	registerJob(
		{
			id: "memory-pruning-planner",
			name: "Memory Pruning Planner",
			description: "Identifies stale, duplicate, or secret-containing memory candidates for review",
			schedule: "0 2 * * *", // 2 AM daily
			riskLevel: "read",
			scope: "global-readonly",
			enabled: true,
		},
		memoryPruningPlanner,
	);
}
