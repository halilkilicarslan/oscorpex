// ---------------------------------------------------------------------------
// Oscorpex — Plugin Routes (M5 Plugin SDK)
// CRUD + enable/disable + execution log endpoints for the plugin platform.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { deletePlugin, getPlugin, getPluginExecutions, listPlugins, updatePlugin } from "../db.js";
import { pluginRegistry } from "../plugin-registry.js";

const router = new Hono();

// GET /plugins — list all registered plugins (DB + in-memory loaded)
router.get("/", async (c) => {
	try {
		const dbPlugins = await listPlugins();
		const loaded = pluginRegistry.listLoaded();
		return c.json({ registered: dbPlugins, loaded });
	} catch (err) {
		console.error("[plugin-routes] listPlugins error:", err);
		return c.json({ error: "Failed to list plugins" }, 500);
	}
});

// GET /plugins/:name — single plugin detail
router.get("/:name", async (c) => {
	try {
		const name = c.req.param("name");
		const dbPlugin = await getPlugin(name);
		const loaded = pluginRegistry.getPlugin(name);
		if (!dbPlugin && !loaded) return c.json({ error: "Plugin not found" }, 404);
		return c.json({
			registered: dbPlugin,
			loaded: loaded ? { hooks: loaded.manifest.hooks, enabled: loaded.enabled } : null,
		});
	} catch (err) {
		console.error("[plugin-routes] getPlugin error:", err);
		return c.json({ error: "Failed to get plugin" }, 500);
	}
});

// PATCH /plugins/:name — enable/disable + config update
router.patch("/:name", async (c) => {
	try {
		const name = c.req.param("name");
		const body = await c.req.json<{ enabled?: boolean; configJson?: Record<string, unknown> }>();
		if (body.enabled !== undefined) {
			if (body.enabled) {
				await pluginRegistry.enable(name);
			} else {
				await pluginRegistry.disable(name);
			}
		}
		if (body.configJson !== undefined) {
			await updatePlugin(name, { configJson: body.configJson });
		}
		return c.json({ ok: true });
	} catch (err) {
		console.error("[plugin-routes] updatePlugin error:", err);
		return c.json({ error: "Failed to update plugin" }, 500);
	}
});

// DELETE /plugins/:name
router.delete("/:name", async (c) => {
	try {
		const name = c.req.param("name");
		pluginRegistry.unregister(name);
		await deletePlugin(name);
		return c.json({ ok: true });
	} catch (err) {
		console.error("[plugin-routes] deletePlugin error:", err);
		return c.json({ error: "Failed to delete plugin" }, 500);
	}
});

// GET /plugins/:name/executions — execution log
router.get("/:name/executions", async (c) => {
	try {
		const name = c.req.param("name");
		const limit = Number(c.req.query("limit") ?? "50");
		const executions = await getPluginExecutions(name, limit);
		return c.json(executions);
	} catch (err) {
		console.error("[plugin-routes] getPluginExecutions error:", err);
		return c.json({ error: "Failed to get plugin executions" }, 500);
	}
});

export default router;
export { router as pluginRoutes };
