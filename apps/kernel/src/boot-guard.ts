// ---------------------------------------------------------------------------
// Oscorpex — boot failure guard
// Imported first by index.ts: static imports evaluated after it cannot be wrapped in try/catch, but their
// load-time throws surface as uncaught exceptions, which this guard reports as one redacted message.
// ---------------------------------------------------------------------------

import { redactConnectionStrings } from "./studio/redact-secrets.js";

export function reportBootFailure(err: unknown): never {
	// Never print the raw error object (e.g. ERR_INVALID_URL carries the URL in `input`).
	const lines = [redactConnectionStrings(err instanceof Error ? (err.stack ?? err.message) : String(err))];
	const cause = err instanceof Error ? err.cause : undefined;
	if (cause !== undefined) {
		lines.push(`caused by: ${redactConnectionStrings(cause instanceof Error ? cause.message : String(cause))}`);
	}
	console.error(`kernel boot failed: ${lines.join("\n")}`);
	process.exit(1);
}

process.on("uncaughtException", reportBootFailure);
process.on("unhandledRejection", reportBootFailure);

/** Boot succeeded: normal runtime error handling takes over. */
export function disarmBootGuard(): void {
	process.off("uncaughtException", reportBootFailure);
	process.off("unhandledRejection", reportBootFailure);
}
