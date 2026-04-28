// ---------------------------------------------------------------------------
// Approval Center — Types, Repository, Service
// ---------------------------------------------------------------------------

export type { ApprovalStatus, ApprovalKind } from "./service.js";
export type { ApprovalRow as ApprovalRequest } from "./repo.js";
export type { ApprovalEventRow as ApprovalEvent } from "./repo.js";
export {
	requestApproval,
	approve,
	reject,
	expireStaleApprovals,
	getApprovalWithEvents,
	listPendingApprovals,
	listApprovals,
	listApprovalsWithSla,
	escalateApproval,
	 type ApprovalSla,
	 type ApprovalWithSla,
} from "./service.js";
