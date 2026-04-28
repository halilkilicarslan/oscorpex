// ---------------------------------------------------------------------------
// Oscorpex Control Plane — Operator Governance Layer
// Phase 1: Registry, Presence, Approvals, Audit, Cost, Incidents, Projections
// ---------------------------------------------------------------------------

// Registry
export * from "./registry/index.ts";
export * from "./registry/repo.ts";
export * from "./registry/service.ts";

// Presence
export * from "./presence/index.ts";
export * from "./presence/repo.ts";
export * from "./presence/service.ts";

// Approvals
export * from "./approvals/index.ts";
export * from "./approvals/repo.ts";
export * from "./approvals/service.ts";

// Audit
export * from "./audit/index.ts";
export * from "./audit/repo.ts";

// Usage/Cost
export * from "./usage-cost/index.ts";
export * from "./usage-cost/repo.ts";

// Incidents
export * from "./incidents/index.ts";
export * from "./incidents/repo.ts";

// Projections
export * from "./projections/index.ts";
export * from "./projections/service.ts";
export type {
	ControlPlaneSummary,
	ApprovalSummary,
	RuntimeHealthSummary,
	CostSummary,
} from "./projections/index.ts";

// Shared
export * from "./shared/index.ts";

// PG helpers
export { query, queryOne, execute, getPool } from "./pg.ts";
