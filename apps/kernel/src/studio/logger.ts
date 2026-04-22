// ---------------------------------------------------------------------------
// Oscorpex — Structured Logger
// Wraps pino for JSON structured logging with child logger support.
// Usage:
//   import { createLogger } from "./logger.js";
//   const log = createLogger("execution-engine");
//   log.info({ projectId, taskId }, "Task started");
//   log.warn({ err }, "Non-blocking operation failed");
// ---------------------------------------------------------------------------

import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

const root = pino({
	level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
	transport: isDev
		? { target: "pino/file", options: { destination: 1 } } // stdout, no pretty in prod
		: undefined,
	formatters: {
		level: (label) => ({ level: label }),
	},
	base: { service: "oscorpex" },
});

/**
 * Create a child logger scoped to a module.
 * Adds `module` field to every log entry.
 */
export function createLogger(module: string): pino.Logger {
	return root.child({ module });
}

/**
 * Create a request-scoped logger with correlation IDs.
 * Use inside task/pipeline execution for traceability.
 */
export function withContext(
	logger: pino.Logger,
	ctx: { projectId?: string; taskId?: string; agentId?: string },
): pino.Logger {
	return logger.child(ctx);
}

export { root as logger };
