// ---------------------------------------------------------------------------
// Oscorpex — Telemetry Debug Routes (V6 M5 F7)
// Only active when OSCORPEX_TRACE_ENABLED=true
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { tracer } from "../telemetry.js";
import { executionEngine } from "../execution-engine.js";
import { buildPerformanceBaseline } from "../performance-metrics.js";
import { createLogger } from "../logger.js";
const log = createLogger("telemetry-routes");

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

// ---------------------------------------------------------------------------
// Provider Telemetry (EPIC 3 observability)
// ---------------------------------------------------------------------------

/**
 * GET /telemetry/providers/latency
 * Per-provider latency and failure aggregates.
 */
router.get("/providers/latency", (c) => {
	const providers = ["claude-code", "codex", "cursor"];
	const results = providers.map((id) => ({
		provider: id,
		...executionEngine.telemetry.getLatencySnapshot(id),
	}));
	return c.json({ providers: results });
});

/**
 * GET /telemetry/providers/records/:runId/:taskId
 * Single provider execution record by runId:taskId.
 * NOTE: Must be registered BEFORE /providers/records to avoid Hono
 * matching ":runId" as a query parameter.
 */
router.get("/providers/records/:runId/:taskId", (c) => {
	const runId = c.req.param("runId");
	const taskId = c.req.param("taskId");
	const record = executionEngine.telemetry.getRecord(runId, taskId);
	if (!record) {
		return c.json({ error: "Record not found" }, 404);
	}
	return c.json({ record });
});

/**
 * GET /telemetry/providers/records
 * Recent provider execution records.
 * Query params:
 *   limit — max records (default 50, max 200)
 *   provider — filter by provider id
 *   success — filter by success boolean ("true" | "false")
 */
router.get("/providers/records", (c) => {
	const limitParam = c.req.query("limit");
	const providerFilter = c.req.query("provider");
	const successFilter = c.req.query("success");
	const limit = limitParam ? Math.min(Number.parseInt(limitParam, 10) || 50, 200) : 50;

	let records = executionEngine.telemetry.getRecentRecords(limit);

	if (providerFilter) {
		records = records.filter(
			(r) => (r.finalProvider ?? r.primaryProvider) === providerFilter,
		);
	}
	if (successFilter === "true") {
		records = records.filter((r) => r.success === true);
	} else if (successFilter === "false") {
		records = records.filter((r) => r.success === false);
	}

	return c.json({ total: records.length, records });
});

// ---------------------------------------------------------------------------
// Performance Baseline (EPIC Performance)
// ---------------------------------------------------------------------------

/**
 * GET /telemetry/performance/baseline
 * Aggregated performance snapshot for optimization decisions.
 * Query params:
 *   window — lookback in milliseconds (default 1h = 3600000)
 */
router.get("/performance/baseline", (c) => {
	const windowParam = c.req.query("window");
	const windowMs = windowParam ? Math.min(Number.parseInt(windowParam, 10) || 3600000, 24 * 3600000) : 3600000;

	const baseline = buildPerformanceBaseline(executionEngine.telemetry, windowMs);
	return c.json({ baseline });
});

export { router as telemetryRoutes };
