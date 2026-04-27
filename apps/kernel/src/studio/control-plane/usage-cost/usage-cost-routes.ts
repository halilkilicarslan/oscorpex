// ---------------------------------------------------------------------------
// Control Plane — Usage/Cost Routes
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { getProjectUsageRollup, getProviderCostRollup, getProjectBudgetStatus } from "./usage-cost-repo.js";
import { createLogger } from "../../logger.js";

const log = createLogger("cp-usage-cost-routes");

export const cpUsageCostRoutes = new Hono();

// GET /control-plane/usage/projects/:id
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

// GET /control-plane/cost/projects/:id
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

// GET /control-plane/cost/providers
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
