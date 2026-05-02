// ---------------------------------------------------------------------------
// Oscorpex — Telemetry Debug Routes (V6 M5 F7)
// Only active when OSCORPEX_TRACE_ENABLED=true
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { executionEngine } from "../execution-engine.js";
import { createLogger } from "../logger.js";
import { buildPerformanceBaseline } from "../performance-metrics.js";
import { tracer } from "../telemetry.js";
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
		records = records.filter((r) => (r.finalProvider ?? r.primaryProvider) === providerFilter);
	}
	if (successFilter === "true") {
		records = records.filter((r) => r.success === true);
	} else if (successFilter === "false") {
		records = records.filter((r) => r.success === false);
	}

	return c.json({ total: records.length, records });
});

// ---------------------------------------------------------------------------
// Queue Wait Debug Surface (TASK 2.3)
// ---------------------------------------------------------------------------

/**
 * GET /telemetry/providers/queue-wait
 * Recent provider execution records with queue wait times exposed.
 * Useful for verifying that queueWaitMs is being recorded correctly.
 * Query params:
 *   limit — max records (default 20, max 100)
 */
router.get("/providers/queue-wait", (c) => {
	const limitParam = c.req.query("limit");
	const limit = limitParam ? Math.min(Number.parseInt(limitParam, 10) || 20, 100) : 20;

	const records = executionEngine.telemetry.getRecentRecords(limit);
	const withQueueWait = records.map((r) => ({
		runId: r.runId,
		taskId: r.taskId,
		provider: r.finalProvider ?? r.primaryProvider,
		queueWaitMs: r.queueWaitMs ?? 0,
		latencyMs: r.latencyMs ?? 0,
		success: r.success,
		errorClassification: r.errorClassification,
		startedAt: r.startedAt,
	}));

	const queueWaits = withQueueWait.map((r) => r.queueWaitMs).filter((v) => v > 0);
	const avgQueueWait =
		queueWaits.length > 0 ? Math.round(queueWaits.reduce((a, b) => a + b, 0) / queueWaits.length) : 0;
	const maxQueueWait = queueWaits.length > 0 ? Math.max(...queueWaits) : 0;

	return c.json({
		total: withQueueWait.length,
		recordsWithQueueWait: queueWaits.length,
		avgQueueWaitMs: avgQueueWait,
		maxQueueWaitMs: maxQueueWait,
		records: withQueueWait,
	});
});

// ---------------------------------------------------------------------------
// Adaptive Concurrency Debug Surface (TASK 3.3)
// ---------------------------------------------------------------------------

/**
 * GET /telemetry/concurrency
 * Real-time adaptive concurrency state.
 */
router.get("/concurrency", (c) => {
	// Access private controller via type assertion for debug endpoint
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const engine = executionEngine as any;
	const controller = engine._concurrencyController as
		| import("../adaptive-concurrency.js").AdaptiveConcurrencyController
		| undefined;

	if (!controller) {
		return c.json({ error: "Adaptive concurrency controller not available" }, 503);
	}

	return c.json({
		adaptive: controller.getRuntimeState(),
	});
});

// ---------------------------------------------------------------------------
// Cache & Cooldown Debug Surface (TASK 6)
// ---------------------------------------------------------------------------

import { providerRuntimeCache } from "../provider-runtime-cache.js";
import { providerState } from "../provider-state.js";

/**
 * GET /telemetry/cache
 * Runtime cache hit/miss statistics and entries.
 */
router.get("/cache", (c) => {
	const stats = providerRuntimeCache.getStats();
	const availabilityEntries = Array.from(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(providerRuntimeCache as any).availability.entries() as Iterable<
			[string, { providerId: string; available: boolean; expiresAt: number; source: string }]
		>,
	).map(([id, e]) => ({
		providerId: id,
		available: e.available,
		expiresInMs: Math.max(0, e.expiresAt - Date.now()),
		source: e.source,
	}));

	return c.json({
		stats,
		availabilityEntries,
	});
});

/**
 * GET /telemetry/cooldown
 * Active cooldown states per provider.
 */
router.get("/cooldown", (c) => {
	const states = providerState.getAllStates();
	const now = Date.now();
	const activeCooldowns = states
		.filter((s) => s.rateLimited && s.cooldownUntil && s.cooldownUntil.getTime() > now)
		.map((s) => ({
			provider: s.adapter,
			trigger: s.lastCooldownTrigger ?? "unknown",
			cooldownUntil: s.cooldownUntil?.toISOString(),
			remainingMs: s.cooldownUntil ? Math.max(0, s.cooldownUntil.getTime() - now) : 0,
			consecutiveFailures: s.consecutiveFailures,
		}));

	return c.json({
		totalProviders: states.length,
		activeCooldownCount: activeCooldowns.length,
		activeCooldowns,
		earliestRecoveryMs: providerState.getEarliestRecoveryMs(),
	});
});

// ---------------------------------------------------------------------------
// Preflight Warm-up Telemetry (TASK 7)
// ---------------------------------------------------------------------------

import { getLastPreflightTelemetry } from "../preflight-warmup.js";

/**
 * GET /telemetry/preflight
 * Last preflight warm-up results and cold-start state.
 */
router.get("/preflight", (c) => {
	const telemetry = getLastPreflightTelemetry();
	return c.json({
		hasRun: telemetry !== null,
		telemetry,
	});
});

// ---------------------------------------------------------------------------
// DB Pool Telemetry (EPIC 2)
// ---------------------------------------------------------------------------

import { getDbPoolSnapshot } from "../db-pool-metrics.js";
import { getPerformanceConfigSnapshot } from "../performance-config.js";

/**
 * GET /telemetry/db-pool
 * Current DB connection pool snapshot.
 */
router.get("/db-pool", (c) => {
	const snapshot = getDbPoolSnapshot();
	return c.json({ pool: snapshot });
});

// ---------------------------------------------------------------------------
// Runtime Infra Debug Surface (EPIC 13)
// ---------------------------------------------------------------------------

/**
 * GET /telemetry/runtime
 * Active execution runtime state.
 */
router.get("/runtime", (c) => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const engine = executionEngine as any;
	return c.json({
		runtime: {
			dispatchingTaskCount: engine._dispatchingTasks?.size ?? 0,
			activeControllerCount: engine._activeControllers?.size ?? 0,
			semaphore: {
				active: engine._semaphore?.activeCount ?? 0,
				pending: engine._semaphore?.pendingCount ?? 0,
				max: engine._semaphore?.maxConcurrency ?? 0,
			},
			workerId: engine._workerId,
		},
	});
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

/**
 * GET /telemetry/performance/config
 * Current performance configuration snapshot (read-only).
 */
router.get("/performance/config", (c) => {
	const config = getPerformanceConfigSnapshot();
	return c.json({ config });
});

export { router as telemetryRoutes };
