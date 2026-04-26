// ---------------------------------------------------------------------------
// Boot Phase — Execution Engine Recovery
// Attempts to recover stuck tasks from previous runs.
// Non-fatal: logged as error but boot continues.
// ---------------------------------------------------------------------------

import { createLogger } from "../studio/logger.js";

const log = createLogger("boot:recovery");

export async function recoveryPhase(): Promise<void> {
	const { executionEngine } = await import("../studio/execution-engine.js");
	await executionEngine.recoverStuckTasks().catch((err) => {
		log.error({ err }, "Startup recovery failed");
	});
}
