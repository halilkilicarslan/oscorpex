// ---------------------------------------------------------------------------
// AI Dev Studio — Module entry point
// ---------------------------------------------------------------------------

export * from './types.js';
export * from './db.js';
export { eventBus } from './event-bus.js';
export { PM_SYSTEM_PROMPT, pmToolkit } from './pm-agent.js';
export { taskEngine } from './task-engine.js';
export { containerManager } from './container-manager.js';
export { executionEngine } from './execution-engine.js';
export { gitManager } from './git-manager.js';
export { studioRoutes } from './routes.js';
