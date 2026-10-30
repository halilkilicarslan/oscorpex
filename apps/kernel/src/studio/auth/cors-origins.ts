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
	const origins = raw
		.split(",")
		.map((o) => o.trim())
		.filter((o) => {
			if (!o) return false;
			// Reject wildcard origins when used with credentials-bearing endpoints
			if (o === "*") {
				log.warn("[routes] CORS wildcard '*' rejected — use explicit origins");
				return false;
			}
			try {
				new URL(o);
				return true;
			} catch {
				log.warn(`[routes] Invalid CORS origin rejected: "${o}"`);
				return false;
			}
		});
	memo = { raw, origins };
	return origins;
}
