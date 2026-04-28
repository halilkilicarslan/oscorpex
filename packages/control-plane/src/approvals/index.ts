// ---------------------------------------------------------------------------
// Approval Center — Types, Repository, Service
// ---------------------------------------------------------------------------

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "escalated";

export type ApprovalKind =
	| "high_risk_task"
	| "policy_override"
	| "provider_override"
	| "runtime_override";

// Canonical contract types — aliased from row types for semantic naming
export type { ApprovalRow as ApprovalRequest } from "./repo.ts";
export type { ApprovalEventRow as ApprovalEvent } from "./repo.ts";
