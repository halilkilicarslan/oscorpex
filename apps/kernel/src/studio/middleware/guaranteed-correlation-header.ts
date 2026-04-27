// ---------------------------------------------------------------------------
// Oscorpex — Guaranteed Correlation ID Header
// Ensures x-correlation-id is present on every HTTP response,
// including error responses that bypass normal middleware flow.
// ---------------------------------------------------------------------------

import type { MiddlewareHandler } from "hono";
import { getCurrentCorrelationId } from "../correlation-context.js";

const CORRELATION_HEADER = "x-correlation-id";

export const guaranteedCorrelationHeader: MiddlewareHandler = async (c, next) => {
	await next();

	// If the response doesn't already have the header, inject it from context
	if (!c.res.headers.get(CORRELATION_HEADER)) {
		const id = getCurrentCorrelationId();
		c.header(CORRELATION_HEADER, id);
	}
};
