// ---------------------------------------------------------------------------
// Oscorpex — Template Routes (V6 M3)
// CRUD endpoints for custom project templates.
// ---------------------------------------------------------------------------

import { type Context, Hono } from "hono";
import { callerUserId, isPlatformAdminRequest } from "../auth/request-identity.js";
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
import type { ProjectTemplate } from "../db/template-repo.js";
import { createLogger } from "../logger.js";
import { CreateTemplateSchema, parseBody, validateTemplateJsonFields } from "./validation-schemas.js";
const log = createLogger("template-routes");

const router = new Hono();

function caller(c: Context): { userId: string | null; isAdmin: boolean } {
	return { userId: callerUserId(c) ?? null, isAdmin: isPlatformAdminRequest(c) };
}

/** Public templates are readable by anyone authenticated; private ones only by their author or a platform admin. */
function canRead(t: ProjectTemplate, who: { userId: string | null; isAdmin: boolean }): boolean {
	return who.isAdmin || t.isPublic || (who.userId !== null && t.authorId === who.userId);
}

/** Public templates are written by platform admins only; private ones by their author (or an admin). */
function canWrite(t: ProjectTemplate, who: { userId: string | null; isAdmin: boolean }): boolean {
	if (who.isAdmin) return true;
	return !t.isPublic && who.userId !== null && t.authorId === who.userId;
}

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
			listTemplates({ category, search, limit, offset, visibleTo: caller(c) }),
			countTemplates({ category, search, visibleTo: caller(c) }),
		]);

		c.header("X-Total-Count", String(total));
		return c.json(templates);
	} catch (err) {
		log.error(`[template-routes] GET /templates: ${String(err)}`);
		return c.json({ error: "Failed to fetch templates" }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /templates/:id — get single template
// ---------------------------------------------------------------------------

router.get("/:id", async (c) => {
	try {
		const template = await getTemplate(c.req.param("id"));
		if (!template || !canRead(template, caller(c))) return c.json({ error: "Template not found" }, 404);
		return c.json(template);
	} catch (err) {
		log.error(`[template-routes] GET /templates/:id: ${String(err)}`);
		return c.json({ error: "Failed to fetch template" }, 500);
	}
});

// ---------------------------------------------------------------------------
// POST /templates — create new template
// ---------------------------------------------------------------------------

router.post("/", async (c) => {
	try {
		const raw = await c.req.json();
		// P4-5: Validate with Zod schema — enforce required name, strip unknown fields
		const parsed = parseBody(CreateTemplateSchema, raw);
		if (!parsed.success) return c.json({ error: parsed.error }, 400);
		const limitError = validateTemplateJsonFields(raw as { agentConfig?: unknown; phases?: unknown });
		if (limitError) return c.json({ error: limitError }, 400);
		const body = parsed.data;
		const who = caller(c);
		const wantsPublic = (raw as Record<string, unknown>).isPublic === true;
		if (wantsPublic && !who.isAdmin) return c.json({ error: "Only platform admins can create public templates" }, 403);

		const template = await createTemplate({
			name: body.name.trim(),
			description: body.description,
			category: body.category,
			// Passthrough extra fields not in schema (techStack, agentConfig, phases, isPublic, authorId)
			// as the DB repo accepts a broader type — use raw fallback for those
			techStack: (raw as Record<string, unknown>).techStack as string[] | undefined,
			agentConfig: (raw as Record<string, unknown>).agentConfig as Record<string, unknown> | undefined,
			phases: (raw as Record<string, unknown>).phases as unknown[] | undefined,
			isPublic: wantsPublic,
			// Author always comes from the authenticated caller — never from the request body
			authorId: who.userId,
		});

		return c.json(template, 201);
	} catch (err) {
		log.error(`[template-routes] POST /templates: ${String(err)}`);
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

		const limitError = validateTemplateJsonFields(body);
		if (limitError) return c.json({ error: limitError }, 400);
		const who = caller(c);
		const existing = await getTemplate(id);
		if (!existing || !canRead(existing, who) || !canWrite(existing, who)) {
			return c.json({ error: "Template not found" }, 404);
		}
		if (body.isPublic === true && !who.isAdmin) {
			return c.json({ error: "Only platform admins can publish templates" }, 403);
		}
		const { isPublic: _ignored, ...rest } = body;
		const updated = await updateTemplate(id, who.isAdmin ? body : rest);
		if (!updated) return c.json({ error: "Template not found" }, 404);
		return c.json(updated);
	} catch (err) {
		log.error(`[template-routes] PATCH /templates/:id: ${String(err)}`);
		return c.json({ error: "Failed to update template" }, 500);
	}
});

// ---------------------------------------------------------------------------
// DELETE /templates/:id
// ---------------------------------------------------------------------------

router.delete("/:id", async (c) => {
	try {
		const existing = await getTemplate(c.req.param("id"));
		if (!existing || !canWrite(existing, caller(c))) return c.json({ error: "Template not found" }, 404);
		await deleteTemplate(c.req.param("id"));
		return c.json({ ok: true });
	} catch (err) {
		log.error(`[template-routes] DELETE /templates/:id: ${String(err)}`);
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
		if (!template || !canRead(template, caller(c))) return c.json({ error: "Template not found" }, 404);
		await incrementTemplateUsage(id);
		return c.json({ ...template, usageCount: template.usageCount + 1 });
	} catch (err) {
		log.error(`[template-routes] POST /templates/:id/use: ${String(err)}`);
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
		if (!existing || !canRead(existing, caller(c))) return c.json({ error: "Template not found" }, 404);
		await rateTemplate(id, rating);
		return c.json({ ok: true });
	} catch (err) {
		log.error(`[template-routes] POST /templates/:id/rate: ${String(err)}`);
		return c.json({ error: "Failed to rate template" }, 500);
	}
});

export { router as templateRoutes };
