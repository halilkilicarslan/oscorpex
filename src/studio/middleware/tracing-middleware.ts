// ---------------------------------------------------------------------------
// Oscorpex — Tracing Middleware (V6 M5 F7)
// Creates an OpenTelemetry-compatible span for each HTTP request.
// W3C traceparent header propagation: version-traceId-parentSpanId-flags
// ---------------------------------------------------------------------------

import type { MiddlewareHandler } from "hono";
import { tracer } from "../telemetry.js";

/**
 * Parse a W3C traceparent header.
 * Format: {version}-{traceId}-{parentSpanId}-{traceFlags}
 * e.g.   00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 */
function parseTraceparent(header: string): { traceId: string; parentSpanId: string } | null {
	const parts = header.split("-");
	if (parts.length !== 4) return null;
	const [, traceId, parentSpanId] = parts;
	if (!traceId || !parentSpanId) return null;
	// Validate lengths (traceId: 32 hex chars, spanId: 16 hex chars)
	if (traceId.length !== 32 || parentSpanId.length !== 16) return null;
	return { traceId, parentSpanId };
}

/**
 * tracingMiddleware — Attach an OTel-compatible span to every HTTP request.
 *
 * Usage (global, applied inside routes/index.ts):
 *   studio.use("*", tracingMiddleware());
 *
 * Currently opt-in and commented out in routes/index.ts by default.
 * Enable by setting OSCORPEX_TRACE_ENABLED=true.
 */
export function tracingMiddleware(): MiddlewareHandler {
	return async (c, next) => {
		// Parse parent context from W3C traceparent header
		const traceparentHeader = c.req.header("traceparent");
		const parentCtx = traceparentHeader ? parseTraceparent(traceparentHeader) : null;

		const method = c.req.method;
		const url = c.req.url;
		const pathname = new URL(url, "http://localhost").pathname;

		const span = tracer.startSpan(`HTTP ${method} ${pathname}`, {
			traceId: parentCtx?.traceId,
			parentSpanId: parentCtx?.parentSpanId,
			attributes: {
				"http.method": method,
				"http.url": url,
				"http.route": pathname,
			},
		});

		// Expose span on context for downstream handlers
		c.set("traceSpan" as never, span);
		c.set("traceId" as never, span.traceId);

		try {
			await next();
		} finally {
			const status = c.res.status;
			tracer.setAttribute(span, "http.status_code", status);
			tracer.setAttribute(span, "http.duration_ms", Date.now() - span.startTime);

			const spanStatus = status >= 500 ? "error" : "ok";
			tracer.endSpan(span, spanStatus);
		}
	};
}
