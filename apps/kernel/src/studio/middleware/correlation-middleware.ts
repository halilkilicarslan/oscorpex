// ---------------------------------------------------------------------------
// Oscorpex — Correlation ID HTTP Middleware
// Reads x-correlation-id from request headers, generates one if missing,
// and sets it on the response. All downstream handlers run inside the
// correlation context so logger calls automatically pick up the ID.
// ---------------------------------------------------------------------------

import type { MiddlewareHandler } from "hono";
import { getCurrentCorrelationId, withCorrelation } from "../correlation-context.js";
import { randomUUID } from "node:crypto";

const CORRELATION_HEADER = "x-correlation-id";

export const correlationMiddleware: MiddlewareHandler = async (c, next) => {
	const headerId = c.req.header(CORRELATION_HEADER);
	const correlationId = headerId ?? randomUUID();

	// Set response header so callers can trace the request
	c.header(CORRELATION_HEADER, correlationId);

	// Run the rest of the request inside the correlation context
	await withCorrelation(async () => {
		await next();
	}, correlationId);
};
