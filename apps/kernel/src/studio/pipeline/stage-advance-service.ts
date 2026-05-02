// ---------------------------------------------------------------------------
// Oscorpex — Stage Advance Service
// Pure decision helper for pipeline stage completion/failure checks.
// ---------------------------------------------------------------------------

export type StageAdvanceDecision = "failed" | "completed" | "waiting";

export function decideStageAdvance(statuses: string[]): StageAdvanceDecision {
	if (statuses.some((status) => status === "failed")) return "failed";
	if (statuses.length > 0 && statuses.every((status) => status === "done")) return "completed";
	return "waiting";
}
