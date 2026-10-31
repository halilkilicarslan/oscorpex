// ---------------------------------------------------------------------------
// Allowed browser origins — one parser shared by the HTTP CORS layer and the WebSocket upgrade gate.
// ---------------------------------------------------------------------------

import { createLogger } from "../logger.js";
const log = createLogger("cors-origins");

const DEFAULT_ORIGINS = "http://localhost:5173,http://localhost:5161,http://127.0.0.1:5161";

let memo: { raw: string; origins: string[] } | undefined;

/** Reads OSCORPEX_CORS_ORIGINS; wildcard and malformed entries are dropped. Parsed once per distinct raw value. */
export function getAllowedOrigins(): string[] {
	const raw = process.env.OSCORPEX_CORS_ORIGINS ?? DEFAULT_ORIGINS;
	if (memo?.raw === raw) return memo.origins;
	const origins: string[] = [];
	for (const entry of raw.split(",")) {
		const o = entry.trim();
		if (!o) continue;
		// Reject wildcard origins when used with credentials-bearing endpoints
		if (o === "*") {
			log.warn("[routes] CORS wildcard '*' rejected — use explicit origins");
			continue;
		}
		try {
			// Browsers send the serialized origin: lowercase scheme/host, no trailing slash or path
			const normalized = new URL(o).origin;
			if (normalized === "null") throw new Error("opaque origin");
			if (!origins.includes(normalized)) origins.push(normalized);
		} catch {
			log.warn(`[routes] Invalid CORS origin rejected: "${o}"`);
		}
	}
	memo = { raw, origins };
	return origins;
}
