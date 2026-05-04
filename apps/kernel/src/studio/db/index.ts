// ---------------------------------------------------------------------------
// Oscorpex — DB module index: re-export all domain repos (backward compat)
// ---------------------------------------------------------------------------

export { query, queryOne, execute, withTransaction, setTenantContext, getPool } from "../pg.js";
export * from "./helpers.js";
export * from "./project-repo.js";
export * from "./task-repo.js";
export * from "./agent-repo.js";
export * from "./team-repo.js";
export * from "./provider-repo.js";
export * from "./analytics-repo.js";
export * from "./event-repo.js";
export * from "./pipeline-repo.js";
export * from "./dependency-repo.js";
export * from "./webhook-repo.js";
export * from "./settings-repo.js";
export * from "./seed.js";

// v3.2: Work Items
export * from "./work-item-repo.js";
// v3.4: Memory Architecture
export * from "./memory-repo.js";
// v3.0 B1: Interactive Planner intake questions
export * from "./intake-repo.js";
// v4.0: Context Store
export * from "./context-repo.js";
// v4.1: DiffViewer, Search Log, Agent Stats
export * from "./diff-repo.js";
export * from "./search-log-repo.js";
// OSC-001: Run Store
export * from "./run-repo.js";
export * from "./agent-stats-repo.js";
// M5: Plugin SDK
export * from "./plugin-repo.js";
// M6: Multi-Tenant Identity
export * from "./tenant-repo.js";
// V6 M1: In-App Notifications
export * from "./notification-repo.js";
// V6 M2: Automated Test Results
export * from "./test-results-repo.js";
// V6 M3: Project Templates
export * from "./template-repo.js";
// V6 M3 F12: CI Tracking
export * from "./ci-repo.js";
// V6 M4: Durable Job Queue
export * from "./job-repo.js";
// V6 M6 F6: Agent Marketplace
export * from "./marketplace-repo.js";

// v7.0 Phase 2: Agentic Core
export * from "./episode-repo.js";
export * from "./session-repo.js";
export * from "./strategy-repo.js";
export * from "./proposal-repo.js";
export * from "./protocol-repo.js";
export * from "./approval-repo.js";
export * from "./quality-gate-repo.js";
export * from "./release-decision-repo.js";
export * from "./artifact-reference-repo.js";

// v7.0 Phase 3: Dynamic Agentic Platform
export * from "./graph-mutation-repo.js";
// v7.0 Section 14.3: Capability Grants
export * from "./capability-grant-repo.js";

// v8.1: Task Session Inspector
export * from "./inspector-repo.js";
// v8.2: Platform Stats + Analytics
export * from "./platform-stats-repo.js";

// resetDb — close pool (used by tests)
export { resetDb } from "./reset.js";
