// ---------------------------------------------------------------------------
// Control Plane — Policy Surface Routes (thin host)
// ---------------------------------------------------------------------------

import { getGlobalPolicySummary, getProjectPolicySummary } from "@oscorpex/control-plane";
import { Hono } from "hono";
import { assertProjectInTenant } from "../../auth/project-access.js";
import { createLogger } from "../../logger.js";
import { currentScope } from "../../tenancy/tenant-scope.js";

const log = createLogger("cp-policy-routes");

export const cpPolicyRoutes = new Hono();

cpPolicyRoutes.get("/policy/summary", async (c) => {
	try {
		const scope = currentScope();
		if (scope?.kind !== "tenant") return c.json({ error: "Forbidden — tenant context required" }, 403);
		const summary = await getGlobalPolicySummary(scope.tenantId);
		return c.json(summary);
	} catch (err) {
		log.error({ err }, "[policy] global summary failed");
		return c.json({ error: "Internal error" }, 500);
	}
});

cpPolicyRoutes.get("/policy/projects/:id", async (c) => {
	const denied = await assertProjectInTenant(c, c.req.param("id"));
	if (denied) return denied;
	try {
		const summary = await getProjectPolicySummary(c.req.param("id"));
		return c.json(summary);
	} catch (err) {
		log.error({ err }, "[policy] project summary failed");
		return c.json({ error: "Internal error" }, 500);
	}
});
