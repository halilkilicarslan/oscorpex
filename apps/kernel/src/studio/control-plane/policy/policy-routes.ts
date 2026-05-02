// ---------------------------------------------------------------------------
// Control Plane — Policy Surface Routes (thin host)
// ---------------------------------------------------------------------------

import { getGlobalPolicySummary, getProjectPolicySummary } from "@oscorpex/control-plane";
import { Hono } from "hono";
import { createLogger } from "../../logger.js";

const log = createLogger("cp-policy-routes");

export const cpPolicyRoutes = new Hono();

cpPolicyRoutes.get("/policy/summary", async (c) => {
	try {
		const summary = await getGlobalPolicySummary();
		return c.json(summary);
	} catch (err) {
		log.error("[policy] global summary failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

cpPolicyRoutes.get("/policy/projects/:id", async (c) => {
	try {
		const summary = await getProjectPolicySummary(c.req.param("id"));
		return c.json(summary);
	} catch (err) {
		log.error("[policy] project summary failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});
