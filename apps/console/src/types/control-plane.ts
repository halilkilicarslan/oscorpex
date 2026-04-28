// ---------------------------------------------------------------------------
// Control Plane — Console contract re-exports
// All canonical types live in @oscorpex/control-plane.
// This file is a thin barrel so UI imports stay stable.
// ---------------------------------------------------------------------------

export type {
	ApprovalRequest,
	ApprovalEvent,
	ApprovalWithSla,
	ApprovalSla,
	AuditEvent,
	SecurityEvent,
	Incident,
	IncidentEvent,
	AgentInstance,
	ProviderRuntime,
	CapabilitySnapshot,
	ControlPlaneSummary,
	ApprovalSummary,
	RuntimeHealthSummary,
	CostSummary,
	HeartbeatRecord,
	UsageRollup,
	CostRollup,
	BudgetSnapshot,
} from "@oscorpex/control-plane";
