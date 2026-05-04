// ---------------------------------------------------------------------------
// Oscorpex Control Plane — Operator Governance Layer
// Phase 1: Registry, Presence, Approvals, Audit, Cost, Incidents, Projections
// ---------------------------------------------------------------------------

// Registry
export * from "./registry/index.js";

// Presence
export * from "./presence/index.js";

// Approvals
export * from "./approvals/index.js";

// Audit
export * from "./audit/index.js";

// Usage/Cost
export * from "./usage-cost/index.js";

// Incidents
export * from "./incidents/index.js";

// Projections
export * from "./projections/index.js";

// Operator Actions
export * from "./operator-actions/index.js";

// Policy Surface
export * from "./policy/index.js";

// Shared
export * from "./shared/index.js";

// Pool injection — kernel calls initPool() at boot to share its connection pool
export { initPool } from "./pg.js";
