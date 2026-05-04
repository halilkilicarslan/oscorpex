// ---------------------------------------------------------------------------
// Oscorpex — Module entry point
// ---------------------------------------------------------------------------

export * from "./types.js";
export * from "./db.js";
export { eventBus } from "./event-bus.js";
export { PM_SYSTEM_PROMPT } from "./pm-agent.js";
export { taskEngine, initTaskEngine } from "./task-engine.js";
export { agentRuntime } from "./agent-runtime.js";
export { executionEngine, initExecutionEngine } from "./execution-engine.js";
export { pipelineEngine, initPipelineEngine } from "./pipeline-engine.js";
export { gitManager } from "./git-manager.js";
export { studioRoutes } from "./routes.js";
export { default as authRoutes } from "./routes/auth-routes.js";
export { wsManager } from "./ws-manager.js";
export { startWSServer } from "./ws-server.js";
export * from "./agent-files.js";
export * from "./agent-messaging.js";

// Re-export typed event schema for consumer convenience.
// Producers can use createEventInput() + EventPayloadMap for type-safe event creation.
export type { EventPayloadMap, EmitInput, TypedEvent } from "@oscorpex/event-schema";
export { createEventInput } from "@oscorpex/event-schema";
