// ---------------------------------------------------------------------------
// Observability — Logs + Studio Events
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { query } from "../studio/pg.js";
import { safeParseJSON } from "./_shared.js";

interface ObservabilityLog {
	id: number;
	timestamp: string;
	trace_id: string | null;
	span_id: string | null;
	trace_flags: number | null;
	severity_number: number | null;
	severity_text: string | null;
	body: string;
	attributes: string | null;
	resource: string | null;
	instrumentation_scope: string | null;
	created_at: string | null;
}

interface StudioEventRow {
	id: string;
	project_id: string;
	type: string;
	payload: string;
	created_at: string;
}

export const logsRoutes = new Hono();

// GET /api/observability/logs
logsRoutes.get("/logs", async (c) => {
	const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "100", 10), 500);
	const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
	const severity = c.req.query("severity");
	const traceId = c.req.query("trace_id");
	const search = c.req.query("search");
	const from = c.req.query("from");
	const to = c.req.query("to");

	const conditions: string[] = [];
	const params: unknown[] = [];

	if (severity) {
		conditions.push(`severity_text = $${params.length + 1}`);
		params.push(severity.toUpperCase());
	}
	if (traceId) {
		conditions.push(`trace_id = $${params.length + 1}`);
		params.push(traceId);
	}
	if (search) {
		conditions.push(`body ILIKE $${params.length + 1}`);
		params.push(`%${search}%`);
	}
	if (from) {
		conditions.push(`timestamp >= $${params.length + 1}`);
		params.push(from);
	}
	if (to) {
		conditions.push(`timestamp <= $${params.length + 1}`);
		params.push(to);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

	const [countRow] = await query<{ cnt: string }>(`SELECT COUNT(*) as cnt FROM observability_logs ${where}`, params);

	const limitIdx = params.length + 1;
	const offsetIdx = params.length + 2;
	const rows = await query<ObservabilityLog>(
		`SELECT * FROM observability_logs ${where} ORDER BY timestamp DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
		[...params, limit, offset],
	);

	const logs = rows.map((row) => ({
		...row,
		attributes: row.attributes ? (safeParseJSON(row.attributes) as Record<string, unknown>) : null,
	}));

	return c.json({ logs, total: Number(countRow?.cnt ?? 0) });
});

// GET /api/observability/logs/stats
logsRoutes.get("/logs/stats", async (c) => {
	const [totalRow] = await query<{ cnt: string }>("SELECT COUNT(*) as cnt FROM observability_logs");

	const severityRows = await query<{
		severity_text: string | null;
		cnt: string;
	}>(
		`SELECT severity_text, COUNT(*) as cnt
     FROM observability_logs
     GROUP BY severity_text`,
	);

	const bySeverity: Record<string, number> = {
		DEBUG: 0,
		INFO: 0,
		WARN: 0,
		ERROR: 0,
	};
	for (const row of severityRows) {
		const key = (row.severity_text ?? "DEBUG").toUpperCase();
		bySeverity[key] = (bySeverity[key] ?? 0) + Number(row.cnt);
	}

	const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
	const [recentRow] = await query<{ cnt: string }>(
		"SELECT COUNT(*) as cnt FROM observability_logs WHERE timestamp >= $1",
		[since],
	);

	return c.json({
		total: Number(totalRow?.cnt ?? 0),
		bySeverity,
		recentRate: Number(recentRow?.cnt ?? 0),
	});
});

// GET /api/observability/events  (studio DB)
logsRoutes.get("/events", async (c) => {
	const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "100", 10), 500);
	const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
	const type = c.req.query("type");
	const projectId = c.req.query("project_id");

	const conditions: string[] = [];
	const params: unknown[] = [];

	if (type) {
		conditions.push(`type = $${params.length + 1}`);
		params.push(type);
	}
	if (projectId) {
		conditions.push(`project_id = $${params.length + 1}`);
		params.push(projectId);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

	const [countRow] = await query<{ cnt: string }>(`SELECT COUNT(*) as cnt FROM events ${where}`, params);

	const limitIdx = params.length + 1;
	const offsetIdx = params.length + 2;
	const rows = await query<StudioEventRow>(
		`SELECT * FROM events ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
		[...params, limit, offset],
	);

	const events = rows.map((row) => ({
		...row,
		payload: safeParseJSON(row.payload) as Record<string, unknown>,
	}));

	return c.json({ events, total: Number(countRow?.cnt ?? 0) });
});
