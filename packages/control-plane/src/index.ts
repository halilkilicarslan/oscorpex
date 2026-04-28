// ---------------------------------------------------------------------------
// Oscorpex Control Plane — Operator Governance Layer
// Phase 1: Registry, Presence, Approvals, Audit, Cost, Incidents, Projections
// ---------------------------------------------------------------------------

// Registry
export * from "./registry/index.js";
export * from "./registry/repo.js";
export * from "./registry/service.js";

// Presence
export * from "./presence/index.js";
export * from "./presence/repo.js";
export * from "./presence/service.js";

// Approvals
export * from "./approvals/index.js";
export * from "./approvals/repo.js";
export * from "./approvals/service.js";

// Audit
export * from "./audit/index.js";
export * from "./audit/repo.js";

// Usage/Cost
export * from "./usage-cost/index.js";
export * from "./usage-cost/repo.js";

// Incidents
export * from "./incidents/index.js";
export * from "./incidents/repo.js";

// Projections
export * from "./projections/index.js";
export * from "./projections/service.js";

// Shared
export * from "./shared/index.js";

// PG helpers
export { query, queryOne, execute, getPool } from "./pg.js";
