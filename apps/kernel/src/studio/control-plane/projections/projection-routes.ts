// ---------------------------------------------------------------------------
// Control Plane — Dashboard Projection Routes (thin host)
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { getControlPlaneSummary, getApprovalSummary, getRuntimeHealthSummary, getProviderOps, getQueueHealth } from "@oscorpex/control-plane";
import { createLogger } from "../../logger.js";

const log = createLogger("cp-projection-routes");

export const cpProjectionRoutes = new Hono();

cpProjectionRoutes.get("/summary", async (c) => {
	try {
		const [summary, approvals, runtime] = await Promise.all([
			getControlPlaneSummary(),
			getApprovalSummary(),
			getRuntimeHealthSummary(),
		]);
		return c.json({ summary, approvals, runtime });
	} catch (err) {
		log.error("[projections] summary failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

cpProjectionRoutes.get("/provider-ops", async (c) => {
	try {
		const providers = await getProviderOps();
		return c.json({ providers });
	} catch (err) {
		log.error("[projections] provider-ops failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

cpProjectionRoutes.get("/queue-health", async (c) => {
	try {
		const health = await getQueueHealth();
		return c.json({ health });
	} catch (err) {
		log.error("[projections] queue-health failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});
