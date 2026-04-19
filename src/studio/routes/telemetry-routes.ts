// ---------------------------------------------------------------------------
// Oscorpex — Telemetry Debug Routes (V6 M5 F7)
// Only active when OSCORPEX_TRACE_ENABLED=true
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { tracer } from "../telemetry.js";

const router = new Hono();

/**
 * GET /telemetry/spans
 * List recently completed spans.
 * Query params:
 *   limit  — number of spans to return (default 50)
 *   name   — filter by span name (substring match, case-insensitive)
 */
router.get("/spans", (c) => {
	const limitParam = c.req.query("limit");
	const nameFilter = c.req.query("name");
	const limit = limitParam ? Math.min(Number.parseInt(limitParam, 10) || 50, 500) : 50;

	let spans = tracer.getRecentSpans(limit);

	if (nameFilter) {
		const lower = nameFilter.toLowerCase();
		spans = spans.filter((s) => s.name.toLowerCase().includes(lower));
	}

	return c.json({
		total: spans.length,
		spans,
	});
});

/**
 * GET /telemetry/spans/:spanId
 * Get a single completed span by spanId.
 */
router.get("/spans/:spanId", (c) => {
	const spanId = c.req.param("spanId");

	// Search in recent spans buffer (up to 1000)
	const all = tracer.getRecentSpans(1000);
	const span = all.find((s) => s.spanId === spanId);

	if (!span) {
		// Also check active spans
		const active = tracer.getActiveSpans().find((s) => s.spanId === spanId);
		if (active) {
			return c.json({ span: active, active: true });
		}
		return c.json({ error: "Span not found" }, 404);
	}

	return c.json({ span, active: false });
});

/**
 * GET /telemetry/active
 * List spans that are currently in-progress (no endTime yet).
 */
router.get("/active", (c) => {
	const spans = tracer.getActiveSpans();
	return c.json({
		total: spans.length,
		spans,
	});
});

export { router as telemetryRoutes };
