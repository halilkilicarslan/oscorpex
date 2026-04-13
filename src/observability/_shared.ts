// ---------------------------------------------------------------------------
// Observability — shared utilities
// ---------------------------------------------------------------------------

export function safeParseJSON(value: unknown): unknown {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}
