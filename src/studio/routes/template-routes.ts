// ---------------------------------------------------------------------------
// Oscorpex — Template Routes (V6 M3)
// CRUD endpoints for custom project templates.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
	countTemplates,
	createTemplate,
	deleteTemplate,
	getTemplate,
	incrementTemplateUsage,
	listTemplates,
	rateTemplate,
	updateTemplate,
} from "../db.js";

const router = new Hono();

// ---------------------------------------------------------------------------
// GET /templates — list templates
// Query: category, search, limit, offset
// ---------------------------------------------------------------------------

router.get("/", async (c) => {
	try {
		const category = c.req.query("category") ?? undefined;
		const search = c.req.query("search") ?? undefined;
		const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
		const offset = Number(c.req.query("offset") ?? "0");

		const [templates, total] = await Promise.all([
			listTemplates({ category, search, limit, offset }),
			countTemplates({ category, search }),
		]);

		c.header("X-Total-Count", String(total));
		return c.json(templates);
	} catch (err) {
		console.error("[template-routes] GET /templates:", err);
		return c.json({ error: "Failed to fetch templates" }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /templates/:id — get single template
// ---------------------------------------------------------------------------

router.get("/:id", async (c) => {
	try {
		const template = await getTemplate(c.req.param("id"));
		if (!template) return c.json({ error: "Template not found" }, 404);
		return c.json(template);
	} catch (err) {
		console.error("[template-routes] GET /templates/:id:", err);
		return c.json({ error: "Failed to fetch template" }, 500);
	}
});

// ---------------------------------------------------------------------------
// POST /templates — create new template
// ---------------------------------------------------------------------------

router.post("/", async (c) => {
	try {
		const body = await c.req.json<{
			name: string;
			description?: string;
			category?: string;
			techStack?: string[];
			agentConfig?: Record<string, unknown>;
			phases?: unknown[];
			isPublic?: boolean;
			authorId?: string;
		}>();

		if (!body.name?.trim()) {
			return c.json({ error: "name is required" }, 400);
		}

		const template = await createTemplate({
			name: body.name.trim(),
			description: body.description,
			category: body.category,
			techStack: body.techStack,
			agentConfig: body.agentConfig,
			phases: body.phases,
			isPublic: body.isPublic,
			authorId: body.authorId ?? null,
		});

		return c.json(template, 201);
	} catch (err) {
		console.error("[template-routes] POST /templates:", err);
		return c.json({ error: "Failed to create template" }, 500);
	}
});

// ---------------------------------------------------------------------------
// PATCH /templates/:id — partial update
// ---------------------------------------------------------------------------

router.patch("/:id", async (c) => {
	try {
		const id = c.req.param("id");
		const body = await c.req.json<{
			name?: string;
			description?: string;
			category?: string;
			techStack?: string[];
			agentConfig?: Record<string, unknown>;
			phases?: unknown[];
			isPublic?: boolean;
		}>();

		const updated = await updateTemplate(id, body);
		if (!updated) return c.json({ error: "Template not found" }, 404);
		return c.json(updated);
	} catch (err) {
		console.error("[template-routes] PATCH /templates/:id:", err);
		return c.json({ error: "Failed to update template" }, 500);
	}
});

// ---------------------------------------------------------------------------
// DELETE /templates/:id
// ---------------------------------------------------------------------------

router.delete("/:id", async (c) => {
	try {
		const existing = await getTemplate(c.req.param("id"));
		if (!existing) return c.json({ error: "Template not found" }, 404);
		await deleteTemplate(c.req.param("id"));
		return c.json({ ok: true });
	} catch (err) {
		console.error("[template-routes] DELETE /templates/:id:", err);
		return c.json({ error: "Failed to delete template" }, 500);
	}
});

// ---------------------------------------------------------------------------
// POST /templates/:id/use — use template (increment usage, return data)
// ---------------------------------------------------------------------------

router.post("/:id/use", async (c) => {
	try {
		const id = c.req.param("id");
		const template = await getTemplate(id);
		if (!template) return c.json({ error: "Template not found" }, 404);
		await incrementTemplateUsage(id);
		return c.json({ ...template, usageCount: template.usageCount + 1 });
	} catch (err) {
		console.error("[template-routes] POST /templates/:id/use:", err);
		return c.json({ error: "Failed to use template" }, 500);
	}
});

// ---------------------------------------------------------------------------
// POST /templates/:id/rate — rate template
// ---------------------------------------------------------------------------

router.post("/:id/rate", async (c) => {
	try {
		const id = c.req.param("id");
		const body = await c.req.json<{ rating: number }>();
		const rating = Number(body.rating);
		if (Number.isNaN(rating) || rating < 0 || rating > 5) {
			return c.json({ error: "rating must be a number between 0 and 5" }, 400);
		}
		const existing = await getTemplate(id);
		if (!existing) return c.json({ error: "Template not found" }, 404);
		await rateTemplate(id, rating);
		return c.json({ ok: true });
	} catch (err) {
		console.error("[template-routes] POST /templates/:id/rate:", err);
		return c.json({ error: "Failed to rate template" }, 500);
	}
});

export { router as templateRoutes };
