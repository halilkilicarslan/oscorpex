// ---------------------------------------------------------------------------
// Observability — Prompt Templates
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { execute, query, queryOne } from "../studio/pg.js";
import { safeParseJSON } from "./_shared.js";

interface PromptTemplate {
	id: string;
	name: string;
	description: string;
	category: string;
	content: string;
	variables: string;
	tags: string;
	version: number;
	parent_id: string | null;
	is_active: number;
	usage_count: number;
	created_at: string;
	updated_at: string;
}

function parsePromptTemplate(row: PromptTemplate) {
	return {
		...row,
		variables: safeParseJSON(row.variables) as string[],
		tags: safeParseJSON(row.tags) as string[],
		is_active: Boolean(row.is_active),
	};
}

export const promptsRoutes = new Hono();

// GET /api/observability/prompts/stats
promptsRoutes.get("/prompts/stats", async (c) => {
	const [activeRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM prompt_templates WHERE is_active = 1");
	const totalTemplates = Number(activeRow?.n ?? 0);

	const [allRow] = await query<{ n: string }>("SELECT COUNT(*) as n FROM prompt_templates");
	const totalVersions = Number(allRow?.n ?? 0);

	const categoryRows = await query<{ category: string; n: string }>(
		"SELECT category, COUNT(*) as n FROM prompt_templates WHERE is_active = 1 GROUP BY category",
	);

	const byCategory: Record<string, number> = {
		system: 0,
		user: 0,
		agent: 0,
		tool: 0,
		general: 0,
	};
	for (const row of categoryRows) {
		byCategory[row.category] = (byCategory[row.category] ?? 0) + Number(row.n);
	}

	const mostUsed = await query<{
		id: string;
		name: string;
		usage_count: number;
	}>("SELECT id, name, usage_count FROM prompt_templates WHERE is_active = 1 ORDER BY usage_count DESC LIMIT 5");

	const recentlyUpdated = await query<{
		id: string;
		name: string;
		updated_at: string;
	}>("SELECT id, name, updated_at FROM prompt_templates WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 5");

	return c.json({
		totalTemplates,
		byCategory,
		totalVersions,
		mostUsed,
		recentlyUpdated,
	});
});

// GET /api/observability/prompts
promptsRoutes.get("/prompts", async (c) => {
	const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "50", 10), 200);
	const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
	const category = c.req.query("category");
	const tag = c.req.query("tag");
	const search = c.req.query("search");
	const activeOnly = c.req.query("active_only") !== "false";
	const sort = c.req.query("sort") ?? "recent"; // most_used | recent | alpha

	const conditions: string[] = [];
	const params: unknown[] = [];

	if (activeOnly) {
		conditions.push("is_active = 1");
	}
	if (category && category !== "all") {
		conditions.push(`category = $${params.length + 1}`);
		params.push(category);
	}
	if (tag) {
		conditions.push(`tags ILIKE $${params.length + 1}`);
		params.push(`%${tag}%`);
	}
	if (search) {
		conditions.push(`(name ILIKE $${params.length + 1} OR content ILIKE $${params.length + 2})`);
		params.push(`%${search}%`, `%${search}%`);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

	const orderBy =
		sort === "most_used"
			? "ORDER BY usage_count DESC, updated_at DESC"
			: sort === "alpha"
				? "ORDER BY name ASC"
				: "ORDER BY updated_at DESC";

	const [countRow] = await query<{ n: string }>(`SELECT COUNT(*) as n FROM prompt_templates ${where}`, params);
	const total = Number(countRow?.n ?? 0);

	const limitIdx = params.length + 1;
	const offsetIdx = params.length + 2;
	const rows = await query<PromptTemplate>(
		`SELECT * FROM prompt_templates ${where} ${orderBy} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
		[...params, limit, offset],
	);

	return c.json({
		templates: rows.map(parsePromptTemplate),
		total,
		limit,
		offset,
	});
});

// POST /api/observability/prompts
promptsRoutes.post("/prompts", async (c) => {
	const body = (await c.req.json()) as {
		name: string;
		description?: string;
		category?: string;
		content: string;
		variables?: string[];
		tags?: string[];
	};

	if (!body.name || !body.content) {
		return c.json({ error: "name and content are required" }, 400);
	}

	const id = crypto.randomUUID();
	const now = new Date().toISOString();

	await execute(
		`INSERT INTO prompt_templates (id, name, description, category, content, variables, tags, version, parent_id, is_active, usage_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, NULL, 1, 0, $8, $9)`,
		[
			id,
			body.name,
			body.description ?? "",
			body.category ?? "general",
			body.content,
			JSON.stringify(body.variables ?? []),
			JSON.stringify(body.tags ?? []),
			now,
			now,
		],
	);

	const created = await queryOne<PromptTemplate>("SELECT * FROM prompt_templates WHERE id = $1", [id]);
	if (!created) throw new Error("Failed to create prompt template");
	return c.json({ template: parsePromptTemplate(created) }, 201);
});

// GET /api/observability/prompts/:id
promptsRoutes.get("/prompts/:id", async (c) => {
	const id = c.req.param("id");

	const template = await queryOne<PromptTemplate>("SELECT * FROM prompt_templates WHERE id = $1", [id]);

	if (!template) {
		return c.json({ error: "Not found" }, 404);
	}

	// Build version history chain by walking parent_id backwards
	const history: PromptTemplate[] = [];
	let current: PromptTemplate | undefined = template;
	while (current?.parent_id) {
		const parentId: string = current.parent_id;
		const parent: PromptTemplate | undefined = await queryOne<PromptTemplate>(
			"SELECT * FROM prompt_templates WHERE id = $1",
			[parentId],
		);
		if (parent) {
			history.push(parent);
			current = parent;
		} else {
			break;
		}
	}

	return c.json({
		template: parsePromptTemplate(template),
		history: history.map(parsePromptTemplate),
	});
});

// PUT /api/observability/prompts/:id
promptsRoutes.put("/prompts/:id", async (c) => {
	const id = c.req.param("id");

	const existing = await queryOne<PromptTemplate>("SELECT * FROM prompt_templates WHERE id = $1", [id]);

	if (!existing) {
		return c.json({ error: "Not found" }, 404);
	}

	const body = (await c.req.json()) as {
		name?: string;
		description?: string;
		category?: string;
		content?: string;
		variables?: string[];
		tags?: string[];
	};

	// Create new version: new row with parent_id pointing to current id
	const newId = crypto.randomUUID();
	const now = new Date().toISOString();

	await execute(
		`INSERT INTO prompt_templates (id, name, description, category, content, variables, tags, version, parent_id, is_active, usage_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, 0, $10, $11)`,
		[
			newId,
			body.name ?? existing.name,
			body.description ?? existing.description,
			body.category ?? existing.category,
			body.content ?? existing.content,
			JSON.stringify(body.variables ?? (safeParseJSON(existing.variables) as string[])),
			JSON.stringify(body.tags ?? (safeParseJSON(existing.tags) as string[])),
			existing.version + 1,
			id, // parent_id = old id
			existing.created_at, // keep original created_at
			now,
		],
	);

	// Soft-deactivate old version
	await execute("UPDATE prompt_templates SET is_active = 0 WHERE id = $1", [id]);

	const updated = await queryOne<PromptTemplate>("SELECT * FROM prompt_templates WHERE id = $1", [newId]);
	if (!updated) throw new Error("Failed to update prompt template");
	return c.json({ template: parsePromptTemplate(updated) });
});

// DELETE /api/observability/prompts/:id
promptsRoutes.delete("/prompts/:id", async (c) => {
	const id = c.req.param("id");

	const existing = await queryOne<{ id: string }>("SELECT id FROM prompt_templates WHERE id = $1", [id]);

	if (!existing) {
		return c.json({ error: "Not found" }, 404);
	}

	await execute("UPDATE prompt_templates SET is_active = 0, updated_at = $1 WHERE id = $2", [
		new Date().toISOString(),
		id,
	]);

	return c.json({ success: true });
});

// POST /api/observability/prompts/:id/duplicate
promptsRoutes.post("/prompts/:id/duplicate", async (c) => {
	const id = c.req.param("id");

	const existing = await queryOne<PromptTemplate>("SELECT * FROM prompt_templates WHERE id = $1", [id]);

	if (!existing) {
		return c.json({ error: "Not found" }, 404);
	}

	const newId = crypto.randomUUID();
	const now = new Date().toISOString();

	await execute(
		`INSERT INTO prompt_templates (id, name, description, category, content, variables, tags, version, parent_id, is_active, usage_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, NULL, 1, 0, $8, $9)`,
		[
			newId,
			`${existing.name} (Copy)`,
			existing.description,
			existing.category,
			existing.content,
			existing.variables,
			existing.tags,
			now,
			now,
		],
	);

	const created = await queryOne<PromptTemplate>("SELECT * FROM prompt_templates WHERE id = $1", [newId]);
	if (!created) throw new Error("Failed to clone prompt template");
	return c.json({ template: parsePromptTemplate(created) }, 201);
});

// POST /api/observability/prompts/:id/use
promptsRoutes.post("/prompts/:id/use", async (c) => {
	const id = c.req.param("id");

	const existing = await queryOne<{ id: string }>("SELECT id FROM prompt_templates WHERE id = $1", [id]);

	if (!existing) {
		return c.json({ error: "Not found" }, 404);
	}

	await execute("UPDATE prompt_templates SET usage_count = usage_count + 1 WHERE id = $1", [id]);

	const updated = await queryOne<{ usage_count: number }>("SELECT usage_count FROM prompt_templates WHERE id = $1", [
		id,
	]);
	return c.json({ usage_count: updated?.usage_count ?? 0 });
});
