// ---------------------------------------------------------------------------
// Control Plane — Dashboard Projection Routes
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { getControlPlaneSummary, getApprovalSummary, getRuntimeHealthSummary } from "./projection-service.js";
import { createLogger } from "../../logger.js";

const log = createLogger("cp-projection-routes");

export const cpProjectionRoutes = new Hono();

// GET /control-plane/summary
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
