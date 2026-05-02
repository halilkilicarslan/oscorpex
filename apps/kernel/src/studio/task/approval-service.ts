// ---------------------------------------------------------------------------
// Oscorpex — Approval Service
// Extracted public module for approval and budget gating responsibilities.
// ---------------------------------------------------------------------------

export {
	DEFAULT_APPROVAL_KEYWORDS,
	TaskApprovalManager,
	getApprovalKeywords,
	shouldRequireApproval,
	type GetProjectIdForTaskCallback,
} from "../task-approval-manager.js";
