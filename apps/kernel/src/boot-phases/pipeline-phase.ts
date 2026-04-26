// ---------------------------------------------------------------------------
// Boot Phase — Pipeline Engine Hook Registration
// Registers task lifecycle hooks with the pipeline engine.
// ---------------------------------------------------------------------------

import { createLogger } from "../studio/logger.js";

const log = createLogger("boot:pipeline");

export async function pipelinePhase(): Promise<void> {
	const { pipelineEngine } = await import("../studio/pipeline-engine.js");
	pipelineEngine.registerTaskHook();
	log.info("Pipeline engine hooks registered");
}
