import { createLogger } from "../../logger.js";
import type { SchedulerJobHandler, SchedulerJobResult } from "../scheduler-types.js";

const log = createLogger("memory-pruning-planner");

export interface MemoryPruningCandidate {
	memoryId: string;
	reason: "duplicate" | "stale" | "low_confidence" | "secret_like" | "orphan" | "large_payload";
	confidence: number;
	recommendedAction: "review" | "redact" | "delete_candidate";
	severity: "low" | "medium" | "high";
}

/**
 * Memory pruning planner — generates PROPOSALS ONLY, never deletes.
 * Reports candidates for human review.
 */
export const memoryPruningPlanner: SchedulerJobHandler = async (ctx) => {
	log.info({ jobId: ctx.jobId }, "[memory-pruning] Generating pruning candidates (read-only)");

	// In a real implementation, this would query memory_facts table
	// For now, return the structure that downstream consumers expect
	const candidates: MemoryPruningCandidate[] = [];

	return {
		jobId: ctx.jobId,
		status: "completed",
		output: {
			type: "memory-pruning-plan",
			generatedAt: new Date().toISOString(),
			candidateCount: candidates.length,
			candidates,
			note: "Read-only report — no memories deleted or modified",
		},
		durationMs: 0,
		executedAt: ctx.startedAt,
	} satisfies SchedulerJobResult;
};
