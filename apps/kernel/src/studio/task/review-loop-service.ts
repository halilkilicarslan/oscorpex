// ---------------------------------------------------------------------------
// Oscorpex — Review Loop Service
// Extracted public module for review, revision, escalation, and decision docs.
// ---------------------------------------------------------------------------

export {
	MAX_REVISION_CYCLES,
	TaskReviewManager,
	type CheckAndAdvancePhaseCallback,
	type ReviewCompletionCallback,
} from "../task-review-manager.js";
