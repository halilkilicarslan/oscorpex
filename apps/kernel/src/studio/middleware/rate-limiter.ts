// ---------------------------------------------------------------------------
// Oscorpex — Simple In-Memory Rate Limiter
// ---------------------------------------------------------------------------

import type { Context, MiddlewareHandler } from "hono";
import { verifyJwt } from "../auth/jwt.js";
import { createLogger } from "../logger.js";

const log = createLogger("rate-limiter");

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

const store = new Map<string, RateLimitEntry>();
const DEFAULT_MAX_KEYS = 10_000;
const CALLER_KEY = "rateLimitCaller";

export function rateLimitStoreSize(): number {
	return store.size;
}

// Cleanup stale entries every 60s
setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of store) {
		if (entry.resetAt <= now) store.delete(key);
	}
}, 60_000).unref();

/**
 * Who is calling: the authenticated user when known (set by an earlier middleware, or a signature-verified JWT —
 * checked without a DB round trip so the limiter can run before the access guard), else the client address.
 * The address comes from resolveClientIp.
 */
/** Client address: the Node socket's; X-Forwarded-For (right-most entry) is honoured only behind OSCORPEX_TRUSTED_PROXY=true. */
export function resolveClientIp(c: Context): string {
	const socketIp = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket
		?.remoteAddress;
	const forwarded =
		process.env.OSCORPEX_TRUSTED_PROXY === "true"
			? c.req.header("x-forwarded-for")?.split(",").pop()?.trim()
			: undefined;
	return forwarded || socketIp || "unknown";
}

function callerKey(c: Context): { key: string; ip: string } {
	const cached = c.get(CALLER_KEY) as { key: string; ip: string } | undefined;
	if (cached) return cached;
	const ip = resolveClientIp(c);

	const authHeader = c.req.header("authorization");
	const verified =
		authHeader?.startsWith("Bearer ") && !authHeader.startsWith("Bearer osx_")
			? verifyJwt(authHeader.slice(7))?.sub
			: undefined;
	const actorId = c.get("userId") || verified;
	const caller = { key: actorId ? `actor:${actorId}` : `ip:${ip}`, ip };
	c.set(CALLER_KEY, caller);
	return caller;
}

export function rateLimiter(
	opts: { windowMs?: number; max?: number; name?: string; maxKeys?: number } = {},
): MiddlewareHandler {
	const windowMs = opts.windowMs ?? 60_000;
	const max = opts.max ?? 100;
	const maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;
	const scope = opts.name ? `${opts.name}:` : "";

	return async (c, next) => {
		const caller = callerKey(c);
		const key = `${scope}${caller.key}:${c.req.path}`;
		const now = Date.now();

		let entry = store.get(key);
		if (!entry || entry.resetAt <= now) {
			entry = { count: 0, resetAt: now + windowMs };
			store.delete(key);
			store.set(key, entry);
			// Map iterates in insertion order, so the first keys are the oldest.
			for (const oldest of store.keys()) {
				if (store.size <= maxKeys) break;
				store.delete(oldest);
			}
		}

		entry.count++;

		c.header("X-RateLimit-Limit", String(max));
		c.header("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));
		c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

		if (entry.count > max) {
			log.warn(`[rate-limiter] Rate limit exceeded: ${caller.key} on ${c.req.path}`);
			return c.json({ error: "Too many requests" }, 429);
		}

		await next();
	};
}
