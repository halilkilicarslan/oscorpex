// ---------------------------------------------------------------------------
// Oscorpex — DB module index: re-export all domain repos (backward compat)
// ---------------------------------------------------------------------------

export { query, queryOne, execute, withTransaction, setTenantContext } from "../pg.js";
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
export * from "./agent-stats-repo.js";
// M5: Plugin SDK
export * from "./plugin-repo.js";
// M6: Multi-Tenant Identity
export * from "./tenant-repo.js";
// V6 M1: In-App Notifications
export * from "./notification-repo.js";

// resetDb — close pool (used by tests)
export { resetDb } from "./reset.js";
