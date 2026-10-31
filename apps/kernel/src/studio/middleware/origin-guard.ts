// ---------------------------------------------------------------------------
// Oscorpex — Origin guard
// Every method except GET/HEAD/OPTIONS, carrying a browser Origin outside the CORS allowlist are refused before auth and handlers run.
// Requests without an Origin (API clients, curl) and safe methods pass; reads are CORS's concern.
// ---------------------------------------------------------------------------

import type { MiddlewareHandler } from "hono";
import { getAllowedOrigins } from "../auth/cors-origins.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function originGuard(): MiddlewareHandler {
	return async (c, next) => {
		const origin = c.req.header("origin");
		if (
			origin !== undefined &&
			!SAFE_METHODS.has(c.req.method.toUpperCase()) &&
			!getAllowedOrigins().includes(origin)
		) {
			return c.json({ error: "Forbidden — origin not allowed" }, 403);
		}
		await next();
	};
}
