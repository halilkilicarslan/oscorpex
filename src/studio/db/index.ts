// ---------------------------------------------------------------------------
// Oscorpex — DB module index: re-export all domain repos (backward compat)
// ---------------------------------------------------------------------------

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

// resetDb — close pool (used by tests)
export { resetDb } from "./reset.js";
