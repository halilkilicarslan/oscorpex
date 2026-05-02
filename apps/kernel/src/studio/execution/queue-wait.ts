// ---------------------------------------------------------------------------
// Oscorpex — Queue Wait Computation
// Single source of truth for queue-wait metric calculation.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// computeQueueWaitMs
// ---------------------------------------------------------------------------

/**
 * Computes queue wait time in milliseconds from a task's createdAt and startedAt timestamps.
 * Returns 0 if either timestamp is missing.
 *
 * Definition: queue wait = task startedAt − task createdAt
 *   - createdAt: set when task is first inserted into DB (tasks.created_at DEFAULT now())
 *   - startedAt: set when task transitions from "assigned" → "running"
 *
 * This is the **single source of truth** for queue wait calculation.
 */
export function computeQueueWaitMs(task: { createdAt?: string | null; startedAt?: string | null }): number {
	if (!task.createdAt || !task.startedAt) return 0;
	const wait = new Date(task.startedAt).getTime() - new Date(task.createdAt).getTime();
	return Math.max(0, wait);
}
