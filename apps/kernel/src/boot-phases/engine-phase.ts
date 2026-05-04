// ---------------------------------------------------------------------------
// Boot Phase — Engine Initialization
// Instantiates the three engine facades in dependency order:
//   1. TaskEngine         — no engine dependencies
//   2. PipelineEngine     — reads taskEngine() at runtime (via import)
//   3. ExecutionEngine    — reads taskEngine() at runtime (via import)
//
// Must run after DB phase (engines call DB on first use) and before
// recovery phase (recovery calls executionEngine.recoverStuckTasks()).
// ---------------------------------------------------------------------------

import { createLogger } from "../studio/logger.js";

const log = createLogger("boot:engines");

export async function enginePhase(): Promise<void> {
	const { initTaskEngine } = await import("../studio/task-engine.js");
	const { initPipelineEngine } = await import("../studio/pipeline-engine.js");
	const { initExecutionEngine } = await import("../studio/execution-engine.js");

	initTaskEngine();
	log.info("[boot:engines] TaskEngine initialized");

	initPipelineEngine();
	log.info("[boot:engines] PipelineEngine initialized");

	initExecutionEngine();
	log.info("[boot:engines] ExecutionEngine initialized");
}
