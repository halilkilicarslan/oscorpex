// ---------------------------------------------------------------------------
// Oscorpex — Non-blocking Side-effect Helper
//
// runNonBlocking() fires a Promise-returning function and absorbs any
// rejection via structured logging. Use this for side-effects that must
// never throw into the caller's execution path (telemetry, event emission,
// cache invalidation, cleanup tasks, etc.).
//
// Usage:
//   runNonBlocking("record search metrics", () => recordSearchMetrics(id, n));
//
// Convention: label should identify the call-site module and operation,
// e.g. "[context-store] record search metrics" or just a short description.
// The "[non-blocking]" prefix is added automatically in the log message.
// ---------------------------------------------------------------------------

import { createLogger } from "../logger.js";

const log = createLogger("non-blocking");

/**
 * Fire-and-forget wrapper for async side-effects.
 *
 * Executes `fn` immediately and attaches a `.catch` handler that logs the
 * error at WARN level with structured context. The caller is not blocked and
 * the Promise is not returned.
 *
 * @param label  Short description used in the warning message on failure
 * @param fn     Async function to execute as a side-effect
 */
export function runNonBlocking(label: string, fn: () => Promise<unknown>): void {
	fn().catch((err: unknown) => {
		log.warn({ err }, `[non-blocking] ${label} failed`);
	});
}
