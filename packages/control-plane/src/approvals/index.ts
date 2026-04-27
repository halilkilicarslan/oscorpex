// ---------------------------------------------------------------------------
// Approval Center — Types, Repository, Service
// ---------------------------------------------------------------------------

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "escalated";

export type ApprovalKind =
	| "high_risk_task"
	| "policy_override"
	| "provider_override"
	| "runtime_override";

export interface ApprovalRequest {
	id: string;
	projectId: string | null;
	kind: ApprovalKind;
	status: ApprovalStatus;
	title: string;
	description: string;
	requestedBy: string;
	approvedBy: string | null;
	rejectedBy: string | null;
	createdAt: string;
	resolvedAt: string | null;
	expiresAt: string;
}

export interface ApprovalEvent {
	id: string;
	approvalId: string;
	eventType: "created" | "approved" | "rejected" | "expired" | "escalated";
	actor: string;
	payload: Record<string, unknown>;
	createdAt: string;
}
