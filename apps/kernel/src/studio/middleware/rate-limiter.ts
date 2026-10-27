// ---------------------------------------------------------------------------
// Oscorpex — Simple In-Memory Rate Limiter
// ---------------------------------------------------------------------------

import type { MiddlewareHandler } from "hono";
import { createLogger } from "../logger.js";

const log = createLogger("rate-limiter");

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 60s
setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of store) {
		if (entry.resetAt <= now) store.delete(key);
	}
}, 60_000).unref();

export function rateLimiter(opts: { windowMs?: number; max?: number } = {}): MiddlewareHandler {
	const windowMs = opts.windowMs ?? 60_000;
	const max = opts.max ?? 100;

	return async (c, next) => {
		// P1-5: Use authenticated actor ID as primary key when available
		const actorId = c.get?.("userId") || c.get?.("tenantId");
		const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
		// P1-5: Prefer actor-based keying; fall back to IP only when trusted proxy enabled
		const key = actorId
			? `actor:${actorId}:${c.req.path}`
			: `${process.env.OSCORPEX_TRUSTED_PROXY === "true" ? ip : "anon"}:${c.req.path}`;
		const now = Date.now();

		let entry = store.get(key);
		if (!entry || entry.resetAt <= now) {
			entry = { count: 0, resetAt: now + windowMs };
			store.set(key, entry);
		}

		entry.count++;

		c.header("X-RateLimit-Limit", String(max));
		c.header("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));
		c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

		if (entry.count > max) {
			log.warn(`[rate-limiter] Rate limit exceeded: ${ip} on ${c.req.path}`);
			return c.json({ error: "Too many requests" }, 429);
		}

		await next();
	};
}
