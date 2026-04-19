// ---------------------------------------------------------------------------
// Oscorpex — Marketplace Routes (V6 M6 F6: Agent Marketplace)
// Community sharing of agent configs and team templates.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
	countMarketplaceItems,
	createMarketplaceItem,
	deleteMarketplaceItem,
	getMarketplaceItem,
	incrementDownloads,
	listMarketplaceItems,
	rateMarketplaceItem,
	updateMarketplaceItem,
} from "../db.js";

const router = new Hono();

// GET /marketplace — list items with filters and sorting
router.get("/", async (c) => {
	try {
		const type = c.req.query("type") as "agent" | "template" | undefined;
		const category = c.req.query("category");
		const search = c.req.query("search");
		const tagsRaw = c.req.query("tags");
		const sort = (c.req.query("sort") as "downloads" | "rating" | "newest") ?? "downloads";
		const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);
		const offset = Number(c.req.query("offset") ?? 0);

		const tags = tagsRaw
			? tagsRaw
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean)
			: undefined;

		const opts = { type, category, search, tags, sort, limit, offset };
		const [items, total] = await Promise.all([
			listMarketplaceItems(opts),
			countMarketplaceItems({ type, category, search, tags }),
		]);

		c.header("X-Total-Count", String(total));
		return c.json(items);
	} catch (err) {
		console.error("[marketplace-routes] list error:", err);
		return c.json({ error: "Failed to list marketplace items" }, 500);
	}
});

// GET /marketplace/:id — single item
router.get("/:id", async (c) => {
	try {
		const id = c.req.param("id");
		const item = await getMarketplaceItem(id);
		if (!item) return c.json({ error: "Marketplace item not found" }, 404);
		return c.json(item);
	} catch (err) {
		console.error("[marketplace-routes] get error:", err);
		return c.json({ error: "Failed to get marketplace item" }, 500);
	}
});

// POST /marketplace — publish new item
router.post("/", async (c) => {
	try {
		const body = await c.req.json<{
			type: "agent" | "template";
			name: string;
			description?: string;
			author?: string;
			authorId?: string;
			category?: string;
			tags?: string[];
			config?: Record<string, unknown>;
		}>();

		if (!body.type || !body.name) {
			return c.json({ error: "type and name are required" }, 400);
		}
		if (body.type !== "agent" && body.type !== "template") {
			return c.json({ error: "type must be 'agent' or 'template'" }, 400);
		}

		const item = await createMarketplaceItem({
			type: body.type,
			name: body.name,
			description: body.description ?? "",
			author: body.author ?? "Anonymous",
			authorId: body.authorId ?? null,
			category: body.category ?? "general",
			tags: body.tags ?? [],
			config: body.config ?? {},
		});
		return c.json(item, 201);
	} catch (err) {
		console.error("[marketplace-routes] create error:", err);
		return c.json({ error: "Failed to publish marketplace item" }, 500);
	}
});

// PATCH /marketplace/:id — update item
router.patch("/:id", async (c) => {
	try {
		const id = c.req.param("id");
		const body = await c.req.json<{
			name?: string;
			description?: string;
			category?: string;
			tags?: string[];
			config?: Record<string, unknown>;
			isVerified?: boolean;
			author?: string;
		}>();

		const item = await updateMarketplaceItem(id, body);
		if (!item) return c.json({ error: "Marketplace item not found" }, 404);
		return c.json(item);
	} catch (err) {
		console.error("[marketplace-routes] update error:", err);
		return c.json({ error: "Failed to update marketplace item" }, 500);
	}
});

// DELETE /marketplace/:id — delete item
router.delete("/:id", async (c) => {
	try {
		const id = c.req.param("id");
		const deleted = await deleteMarketplaceItem(id);
		if (!deleted) return c.json({ error: "Marketplace item not found" }, 404);
		return c.json({ ok: true });
	} catch (err) {
		console.error("[marketplace-routes] delete error:", err);
		return c.json({ error: "Failed to delete marketplace item" }, 500);
	}
});

// POST /marketplace/:id/download — install item (increment count, return config)
router.post("/:id/download", async (c) => {
	try {
		const id = c.req.param("id");
		const item = await incrementDownloads(id);
		if (!item) return c.json({ error: "Marketplace item not found" }, 404);
		return c.json({ ok: true, config: item.config, item });
	} catch (err) {
		console.error("[marketplace-routes] download error:", err);
		return c.json({ error: "Failed to download marketplace item" }, 500);
	}
});

// POST /marketplace/:id/rate — rate item (1-5)
router.post("/:id/rate", async (c) => {
	try {
		const id = c.req.param("id");
		const body = await c.req.json<{ rating: number }>();
		const rating = Number(body.rating);

		if (!rating || rating < 1 || rating > 5) {
			return c.json({ error: "rating must be between 1 and 5" }, 400);
		}

		const item = await rateMarketplaceItem(id, rating);
		if (!item) return c.json({ error: "Marketplace item not found" }, 404);
		return c.json({ ok: true, rating: item.rating, ratingCount: item.ratingCount });
	} catch (err) {
		console.error("[marketplace-routes] rate error:", err);
		return c.json({ error: "Failed to rate marketplace item" }, 500);
	}
});

export { router as marketplaceRoutes };
