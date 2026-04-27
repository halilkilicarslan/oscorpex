// ---------------------------------------------------------------------------
// Observability — Traces (observability_traces / observability_spans)
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { query, queryOne } from "../studio/pg.js";

interface RawTrace {
	trace_id: string;
	root_span_id: string | null;
	entity_id: string | null;
	entity_type: string | null;
	start_time: string;
	end_time: string | null;
	span_count: number;
	created_at: string;
	updated_at: string;
}

interface RawSpan {
	span_id: string;
	trace_id: string;
	parent_span_id: string | null;
	entity_id: string | null;
	entity_type: string | null;
	name: string;
	kind: number;
	start_time: string;
	end_time: string | null;
	duration: number | null;
	status_code: number;
	status_message: string | null;
	attributes: string | null;
	events: string | null;
	created_at: string;
	updated_at: string;
}

interface ParsedAttributes {
	"span.type"?: string;
	"llm.model"?: string;
	"llm.usage.prompt_tokens"?: number;
	"llm.usage.completion_tokens"?: number;
	"llm.usage.total_tokens"?: number;
	"tool.name"?: string;
	"entity.name"?: string;
	input?: string;
	output?: string;
	"agent.state"?: string;
	[key: string]: unknown;
}

function parseAttrs(raw: string | null): ParsedAttributes {
	if (!raw) return {};
	try {
		return JSON.parse(raw) as ParsedAttributes;
	} catch {
		return {};
	}
}

function calcDurationMs(start: string, end: string | null): number | null {
	if (!end) return null;
	return new Date(end).getTime() - new Date(start).getTime();
}

function deriveTraceStatus(spans: RawSpan[], endTime: string | null): "success" | "error" | "running" {
	if (!endTime) return "running";
	const hasError = spans.some((s) => s.status_code === 2);
	return hasError ? "error" : "success";
}

function deriveSpanType(span: RawSpan): "agent" | "llm" | "tool" {
	const attrs = parseAttrs(span.attributes);
	const spanType = attrs["span.type"];
	if (spanType === "llm") return "llm";
	if (spanType === "tool") return "tool";
	return "agent";
}

function formatTrace(trace: RawTrace, spans: RawSpan[]) {
	const durationMs = calcDurationMs(trace.start_time, trace.end_time);
	const status = deriveTraceStatus(spans, trace.end_time);

	let totalTokens = 0;
	for (const span of spans) {
		const attrs = parseAttrs(span.attributes);
		const tokens = attrs["llm.usage.total_tokens"];
		if (typeof tokens === "number") totalTokens += tokens;
	}

	return {
		trace_id: trace.trace_id,
		root_span_id: trace.root_span_id,
		entity_id: trace.entity_id,
		entity_type: trace.entity_type,
		start_time: trace.start_time,
		end_time: trace.end_time,
		span_count: trace.span_count,
		duration_ms: durationMs,
		status,
		total_tokens: totalTokens > 0 ? totalTokens : null,
	};
}

function formatSpan(span: RawSpan) {
	const attrs = parseAttrs(span.attributes);
	return {
		span_id: span.span_id,
		trace_id: span.trace_id,
		parent_span_id: span.parent_span_id,
		entity_id: span.entity_id,
		entity_type: span.entity_type,
		name: span.name,
		kind: span.kind,
		start_time: span.start_time,
		end_time: span.end_time,
		duration_ms: span.duration ?? calcDurationMs(span.start_time, span.end_time),
		status_code: span.status_code,
		status_message: span.status_message,
		span_type: deriveSpanType(span),
		llm_model: attrs["llm.model"] ?? null,
		tool_name: attrs["tool.name"] ?? null,
		prompt_tokens: attrs["llm.usage.prompt_tokens"] ?? null,
		completion_tokens: attrs["llm.usage.completion_tokens"] ?? null,
		total_tokens: attrs["llm.usage.total_tokens"] ?? null,
		input: typeof attrs.input === "string" ? attrs.input.slice(0, 2000) : null,
		output: typeof attrs.output === "string" ? attrs.output.slice(0, 2000) : null,
		attributes: attrs,
	};
}

export const tracesRoutes = new Hono();

// GET /api/observability/traces/stats — MUST be before /:traceId
tracesRoutes.get("/traces/stats", async (c) => {
	const [totalRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM observability_traces");
	const totalTraces = Number(totalRow?.n ?? 0);

	const completedTraces = await query<{ start_time: string; end_time: string }>(
		"SELECT start_time, end_time FROM observability_traces WHERE end_time IS NOT NULL",
	);

	let totalDurationMs = 0;
	let durationCount = 0;
	for (const row of completedTraces) {
		const d = calcDurationMs(row.start_time, row.end_time);
		if (d !== null) {
			totalDurationMs += d;
			durationCount++;
		}
	}
	const avgDurationMs = durationCount > 0 ? totalDurationMs / durationCount : null;

	const [errorCountRow] = await query<{ n: string }>(
		"SELECT COUNT(DISTINCT trace_id) as n FROM observability_spans WHERE status_code = 2",
	);
	const errorTraceCount = Number(errorCountRow?.n ?? 0);
	const errorRate = totalTraces > 0 ? Math.round((errorTraceCount / totalTraces) * 1000) / 10 : 0;

	// PostgreSQL JSON operator: attributes is TEXT, cast to jsonb
	const [tokenRow] = await query<{ total: string | null }>(
		`SELECT SUM((attributes::jsonb->>'llm.usage.total_tokens')::numeric) as total FROM observability_spans`,
	);
	const totalTokens = tokenRow?.total != null ? Number(tokenRow.total) : 0;

	const topAgents = await query<{ name: string; count: string }>(
		"SELECT entity_id as name, COUNT(*) as count FROM observability_traces WHERE entity_id IS NOT NULL GROUP BY entity_id ORDER BY count DESC LIMIT 10",
	);

	return c.json({
		totalTraces,
		avgDurationMs,
		errorRate,
		totalTokens,
		topAgents: topAgents.map((r) => ({ name: r.name, count: Number(r.count) })),
	});
});

// GET /api/observability/traces — list + pagination + filters
tracesRoutes.get("/traces", async (c) => {
	const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "50", 10), 200);
	const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
	const entityId = c.req.query("entity_id");
	const statusFilter = c.req.query("status"); // 'success' | 'error' | 'running'
	const from = c.req.query("from");
	const to = c.req.query("to");

	const conditions: string[] = [];
	const params: unknown[] = [];

	if (entityId) {
		conditions.push(`t.entity_id = $${params.length + 1}`);
		params.push(entityId);
	}
	if (from) {
		conditions.push(`t.start_time >= $${params.length + 1}`);
		params.push(from);
	}
	if (to) {
		conditions.push(`t.start_time <= $${params.length + 1}`);
		params.push(to);
	}

	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

	const [totalResult] = await query<{ n: string }>(
		`SELECT COUNT(*) as n FROM observability_traces t ${whereClause}`,
		params,
	);

	const limitIdx = params.length + 1;
	const offsetIdx = params.length + 2;
	const rawTraces = await query<RawTrace>(
		`SELECT t.* FROM observability_traces t ${whereClause} ORDER BY t.start_time DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
		[...params, limit, offset],
	);

	// Fetch spans for each trace and format
	const traces = await Promise.all(
		rawTraces.map(async (trace) => {
			const spans = await query<RawSpan>("SELECT * FROM observability_spans WHERE trace_id = $1", [trace.trace_id]);
			return formatTrace(trace, spans);
		}),
	);

	// Status filter — column not in DB, apply in-process
	const filtered = statusFilter ? traces.filter((t) => t.status === statusFilter) : traces;

	return c.json({
		traces: filtered,
		total: Number(totalResult?.n ?? 0),
		limit,
		offset,
	});
});

// GET /api/observability/traces/:traceId — single trace + all spans
tracesRoutes.get("/traces/:traceId", async (c) => {
	const { traceId } = c.req.param();

	const trace = await queryOne<RawTrace>("SELECT * FROM observability_traces WHERE trace_id = $1", [traceId]);

	if (!trace) {
		return c.json({ error: "Trace not found" }, 404);
	}

	const rawSpans = await query<RawSpan>(
		"SELECT * FROM observability_spans WHERE trace_id = $1 ORDER BY start_time ASC",
		[traceId],
	);

	const spans = rawSpans.map(formatSpan);
	const formattedTrace = formatTrace(trace, rawSpans);

	return c.json({
		trace: formattedTrace,
		spans,
	});
});
