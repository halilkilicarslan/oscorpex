// ---------------------------------------------------------------------------
// Boot Phase — Execution Engine Recovery
// Attempts to recover stuck tasks from previous runs with deadlock-retry logic.
// Non-fatal: logged as error but boot continues.
// ---------------------------------------------------------------------------

import { createLogger } from "../studio/logger.js";

const log = createLogger("boot:recovery");

export async function recoveryPhase(): Promise<void> {
	if (process.env.VITEST === "true") return;

	const { executionEngine, runStartupRecoveryWithRetry } = await import("../studio/execution-engine.js");
	const engine = executionEngine();
	// Access the internal recovery instance for the deadlock-retry wrapper.
	const _engine = engine as unknown as {
		recovery: import("../studio/execution/execution-recovery.js").ExecutionRecovery;
	};

	await runStartupRecoveryWithRetry(_engine.recovery).catch((err) => {
		log.error({ err }, "Startup recovery failed");
	});
}
