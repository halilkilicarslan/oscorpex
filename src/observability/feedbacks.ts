// ---------------------------------------------------------------------------
// Observability — Feedbacks
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { execute, query, queryOne } from "../studio/pg.js";

type FeedbackRow = {
	id: string;
	trace_id: string | null;
	span_id: string | null;
	agent_id: string | null;
	rating: number;
	rating_type: string;
	comment: string;
	tags: string;
	user_id: string;
	created_at: string;
};

function parseFeedbackRow(row: FeedbackRow) {
	let parsedTags: string[] = [];
	try {
		parsedTags = JSON.parse(row.tags) as string[];
	} catch {
		// ignore
	}
	return { ...row, tags: parsedTags };
}

export const feedbacksRoutes = new Hono();

// GET /api/observability/feedbacks/stats — registered before /:id to avoid param clash
feedbacksRoutes.get("/feedbacks/stats", async (c) => {
	const [totalRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM feedbacks");
	const totalFeedbacks = Number(totalRow?.n ?? 0);

	const [avgRow] = await query<{ avg: number | null }>(
		"SELECT AVG(CAST(rating AS REAL)) as avg FROM feedbacks WHERE rating_type = 'stars'",
	);
	const avgRating = avgRow?.avg != null ? Math.round(avgRow.avg * 100) / 100 : null;

	const distRows = await query<{ rating: number; cnt: string }>(
		"SELECT rating, COUNT(*) as cnt FROM feedbacks WHERE rating_type = 'stars' GROUP BY rating",
	);
	const ratingDistribution: Record<number, number> = {
		1: 0,
		2: 0,
		3: 0,
		4: 0,
		5: 0,
	};
	for (const row of distRows) {
		ratingDistribution[row.rating] = Number(row.cnt);
	}

	const byAgentRows = await query<{
		name: string;
		avgRating: number;
		count: string;
	}>(
		`SELECT agent_id as name,
            AVG(CAST(rating AS REAL)) as "avgRating",
            COUNT(*) as count
     FROM feedbacks
     WHERE agent_id IS NOT NULL AND agent_id != '' AND rating_type = 'stars'
     GROUP BY agent_id
     ORDER BY count DESC`,
	);
	const byAgent = byAgentRows.map((r) => ({
		name: r.name,
		avgRating: Math.round(r.avgRating * 100) / 100,
		count: Number(r.count),
	}));

	const allTagsRows = await query<{ tags: string }>("SELECT tags FROM feedbacks");
	const tagCounts: Record<string, number> = {};
	for (const row of allTagsRows) {
		try {
			const tags = JSON.parse(row.tags) as string[];
			for (const tag of tags) {
				tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
			}
		} catch {
			// ignore
		}
	}
	const topTags = Object.entries(tagCounts)
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 20);

	const recentTrendRows = await query<{ day: string; cnt: string }>(
		`SELECT DATE(created_at) as day, COUNT(*) as cnt
     FROM feedbacks
     WHERE created_at >= CURRENT_DATE - INTERVAL '6 days'
     GROUP BY day
     ORDER BY day ASC`,
	);
	const recentTrend = recentTrendRows.map((r) => ({
		day: r.day,
		count: Number(r.cnt),
	}));

	return c.json({
		totalFeedbacks,
		avgRating,
		ratingDistribution,
		byAgent,
		topTags,
		recentTrend,
	});
});

// GET /api/observability/feedbacks
feedbacksRoutes.get("/feedbacks", async (c) => {
	const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "50", 10), 200);
	const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
	const agentId = c.req.query("agent_id");
	const ratingType = c.req.query("rating_type");
	const minRating = c.req.query("min_rating");
	const tag = c.req.query("tag");

	const conditions: string[] = [];
	const params: unknown[] = [];

	if (agentId) {
		conditions.push(`agent_id = $${params.length + 1}`);
		params.push(agentId);
	}
	if (ratingType) {
		conditions.push(`rating_type = $${params.length + 1}`);
		params.push(ratingType);
	}
	if (minRating) {
		conditions.push(`rating >= $${params.length + 1}`);
		params.push(Number.parseInt(minRating, 10));
	}
	if (tag) {
		conditions.push(`tags ILIKE $${params.length + 1}`);
		params.push(`%${tag}%`);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

	const [countRow] = await query<{ n: string }>(`SELECT COUNT(*) as n FROM feedbacks ${where}`, params);
	const total = Number(countRow?.n ?? 0);

	const limitIdx = params.length + 1;
	const offsetIdx = params.length + 2;
	const rows = await query<FeedbackRow>(
		`SELECT * FROM feedbacks ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
		[...params, limit, offset],
	);

	return c.json({
		feedbacks: rows.map(parseFeedbackRow),
		total,
		limit,
		offset,
	});
});

// POST /api/observability/feedbacks
feedbacksRoutes.post("/feedbacks", async (c) => {
	const body = (await c.req.json()) as {
		trace_id?: string;
		span_id?: string;
		agent_id?: string;
		rating: number;
		rating_type?: string;
		comment?: string;
		tags?: string[];
		user_id?: string;
	};

	if (body.rating === undefined || body.rating === null) {
		return c.json({ error: "rating is required" }, 400);
	}

	const id = crypto.randomUUID();
	const now = new Date().toISOString();

	await execute(
		`INSERT INTO feedbacks (id, trace_id, span_id, agent_id, rating, rating_type, comment, tags, user_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		[
			id,
			body.trace_id ?? null,
			body.span_id ?? null,
			body.agent_id ?? null,
			body.rating,
			body.rating_type ?? "stars",
			body.comment ?? "",
			JSON.stringify(body.tags ?? []),
			body.user_id ?? "anonymous",
			now,
		],
	);

	const feedback = await queryOne<FeedbackRow>("SELECT * FROM feedbacks WHERE id = $1", [id]);
	if (!feedback) throw new Error("Failed to create feedback");
	return c.json(parseFeedbackRow(feedback), 201);
});

// GET /api/observability/feedbacks/:id
feedbacksRoutes.get("/feedbacks/:id", async (c) => {
	const row = await queryOne<FeedbackRow>("SELECT * FROM feedbacks WHERE id = $1", [c.req.param("id")]);
	if (!row) return c.json({ error: "Not found" }, 404);
	return c.json(parseFeedbackRow(row));
});

// DELETE /api/observability/feedbacks/:id
feedbacksRoutes.delete("/feedbacks/:id", async (c) => {
	const id = c.req.param("id");
	const existing = await queryOne<{ id: string }>("SELECT id FROM feedbacks WHERE id = $1", [id]);
	if (!existing) {
		return c.json({ error: "Not found" }, 404);
	}
	await execute("DELETE FROM feedbacks WHERE id = $1", [id]);
	return c.json({ success: true });
});
