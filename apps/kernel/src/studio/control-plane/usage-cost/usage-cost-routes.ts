// ---------------------------------------------------------------------------
// Control Plane — Usage/Cost Routes (thin host)
// ---------------------------------------------------------------------------

import { getProjectBudgetStatus, getProjectUsageRollup, getProviderCostRollup } from "@oscorpex/control-plane";
import { Hono } from "hono";
import { createLogger } from "../../logger.js";

const log = createLogger("cp-usage-cost-routes");

export const cpUsageCostRoutes = new Hono();

cpUsageCostRoutes.get("/usage/projects/:id", async (c) => {
	try {
		const days = Math.min(Number.parseInt(c.req.query("days") ?? "30", 10), 365);
		const rollup = await getProjectUsageRollup(c.req.param("id"), days);
		return c.json({ rollup });
	} catch (err) {
		log.error("[usage-cost] project usage failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

cpUsageCostRoutes.get("/cost/projects/:id", async (c) => {
	try {
		const days = Math.min(Number.parseInt(c.req.query("days") ?? "30", 10), 365);
		const [rollup, budget] = await Promise.all([
			getProjectUsageRollup(c.req.param("id"), days),
			getProjectBudgetStatus(c.req.param("id")),
		]);
		return c.json({ rollup, budget });
	} catch (err) {
		log.error("[usage-cost] project cost failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

cpUsageCostRoutes.get("/cost/providers", async (c) => {
	try {
		const days = Math.min(Number.parseInt(c.req.query("days") ?? "30", 10), 365);
		const rollup = await getProviderCostRollup(days);
		return c.json({ rollup });
	} catch (err) {
		log.error("[usage-cost] provider cost failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});
