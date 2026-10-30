// ---------------------------------------------------------------------------
// Control Plane — Dashboard Projection Routes (thin host)
// ---------------------------------------------------------------------------

import {
	getApprovalSummary,
	getControlPlaneSummary,
	getPlatformControlPlaneSummary,
	getProviderOps,
	getQueueHealth,
	getRuntimeHealthSummary,
} from "@oscorpex/control-plane";
import { Hono } from "hono";
import { createLogger } from "../../logger.js";
import { currentScope } from "../../tenancy/tenant-scope.js";

const log = createLogger("cp-projection-routes");

export const cpProjectionRoutes = new Hono();

cpProjectionRoutes.get("/summary", async (c) => {
	try {
		const scope = currentScope();
		if (scope?.kind !== "tenant") return c.json({ error: "Forbidden — tenant context required" }, 403);
		const [summary, approvals, runtime] = await Promise.all([
			getControlPlaneSummary(scope.tenantId),
			getApprovalSummary(scope.tenantId),
			getRuntimeHealthSummary(),
		]);
		return c.json({ summary, approvals, runtime });
	} catch (err) {
		log.error({ err }, "[projections] summary failed");
		return c.json({ error: "Internal error" }, 500);
	}
});

// platform:admin only (route-permissions); the access guard runs /platform/* handlers in system scope.
cpProjectionRoutes.get("/platform/control-plane-summary", async (c) => {
	try {
		const summary = await getPlatformControlPlaneSummary();
		return c.json({ summary });
	} catch (err) {
		log.error({ err }, "[projections] platform summary failed");
		return c.json({ error: "Internal error" }, 500);
	}
});

cpProjectionRoutes.get("/provider-ops", async (c) => {
	try {
		const providers = await getProviderOps();
		return c.json({ providers });
	} catch (err) {
		log.error({ err }, "[projections] provider-ops failed");
		return c.json({ error: "Internal error" }, 500);
	}
});

cpProjectionRoutes.get("/queue-health", async (c) => {
	try {
		const scope = currentScope();
		if (scope?.kind !== "tenant") return c.json({ error: "Forbidden — tenant context required" }, 403);
		const health = await getQueueHealth(scope.tenantId);
		return c.json({ health });
	} catch (err) {
		log.error({ err }, "[projections] queue-health failed");
		return c.json({ error: "Internal error" }, 500);
	}
});
