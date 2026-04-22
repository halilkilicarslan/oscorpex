// ---------------------------------------------------------------------------
// Oscorpex — Plugin Routes (M5 Plugin SDK)
// CRUD + enable/disable + execution log endpoints for the plugin platform.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { requirePermission } from "../auth/rbac.js";
import { deletePlugin, getPlugin, getPluginExecutions, listPlugins, updatePlugin } from "../db.js";
import { pluginRegistry } from "../plugin-registry.js";
import { createLogger } from "../logger.js";
const log = createLogger("plugin-routes");

const router = new Hono();

// GET /plugins — list all registered plugins (DB + in-memory loaded)
router.get("/", async (c) => {
	try {
		const dbPlugins = await listPlugins();
		const loaded = pluginRegistry.listLoaded();
		return c.json({ registered: dbPlugins, loaded });
	} catch (err) {
		log.error("[plugin-routes] listPlugins error:" + " " + String(err));
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
		log.error("[plugin-routes] getPlugin error:" + " " + String(err));
		return c.json({ error: "Failed to get plugin" }, 500);
	}
});

// PATCH /plugins/:name — enable/disable + config update
router.patch("/:name", requirePermission("plugins:write"), async (c) => {
	try {
		const name = c.req.param("name") ?? "";
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
		log.error("[plugin-routes] updatePlugin error:" + " " + String(err));
		return c.json({ error: "Failed to update plugin" }, 500);
	}
});

// DELETE /plugins/:name
router.delete("/:name", requirePermission("plugins:write"), async (c) => {
	try {
		const name = c.req.param("name") ?? "";
		pluginRegistry.unregister(name);
		await deletePlugin(name);
		return c.json({ ok: true });
	} catch (err) {
		log.error("[plugin-routes] deletePlugin error:" + " " + String(err));
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
		log.error("[plugin-routes] getPluginExecutions error:" + " " + String(err));
		return c.json({ error: "Failed to get plugin executions" }, 500);
	}
});

export default router;
export { router as pluginRoutes };
