// ---------------------------------------------------------------------------
// Control Plane — Approval Routes (thin host)
// ---------------------------------------------------------------------------

import {
	type ApprovalKind,
	type ApprovalScope,
	approve,
	escalateApproval,
	expireStaleApprovals,
	getApprovalWithEvents,
	listApprovalsWithSla,
	reject,
	requestApproval,
} from "@oscorpex/control-plane";
import { type Context, Hono } from "hono";
import { isPlatformAdminRequest } from "../../auth/request-identity.js";
import { isProjectInTenant } from "../../db.js";
import { createLogger } from "../../logger.js";

const log = createLogger("cp-approval-routes");

export const cpApprovalRoutes = new Hono();

/** Tenant of the authenticated request; every approval operation is restricted to it. */
function tenantOf(c: Context): ApprovalScope {
	// Fail closed: without a tenant nothing matches. Project-less approvals are platform-admin only.
	return {
		tenantId: (c.get("tenantId") as string | undefined) ?? "",
		includeProjectless: isPlatformAdminRequest(c),
	};
}

/** Actor always comes from the authenticated principal — never from the request body. */
function actorOf(c: Context): string {
	return (c.get("userId") as string | undefined) ?? (c.get("email") as string | undefined) ?? "operator";
}

cpApprovalRoutes.get("/control-plane/approvals", async (c) => {
	try {
		const status = c.req.query("status") ?? undefined;
		const approvals = await listApprovalsWithSla(status, tenantOf(c));
		return c.json({ approvals });
	} catch (err) {
		log.error(`[approvals] list failed: ${String(err)}`);
		return c.json({ error: String(err) }, 500);
	}
});

cpApprovalRoutes.get("/control-plane/approvals/:id", async (c) => {
	try {
		const result = await getApprovalWithEvents(c.req.param("id"), tenantOf(c));
		if (!result) return c.json({ error: "Approval not found" }, 404);
		return c.json(result);
	} catch (err) {
		log.error(`[approvals] get failed: ${String(err)}`);
		return c.json({ error: String(err) }, 500);
	}
});

cpApprovalRoutes.post("/control-plane/approvals/:id/approve", async (c) => {
	try {
		const approval = await approve(c.req.param("id"), actorOf(c), tenantOf(c));
		if (!approval) return c.json({ error: "Approval not found" }, 404);
		return c.json({ approval });
	} catch (err) {
		log.error(`[approvals] approve failed: ${String(err)}`);
		return c.json({ error: String(err) }, 500);
	}
});

cpApprovalRoutes.post("/control-plane/approvals/:id/reject", async (c) => {
	try {
		const approval = await reject(c.req.param("id"), actorOf(c), tenantOf(c));
		if (!approval) return c.json({ error: "Approval not found" }, 404);
		return c.json({ approval });
	} catch (err) {
		log.error(`[approvals] reject failed: ${String(err)}`);
		return c.json({ error: String(err) }, 500);
	}
});

cpApprovalRoutes.post("/control-plane/approvals", async (c) => {
	try {
		const body = (await c.req.json()) as {
			projectId?: string;
			kind: ApprovalKind;
			title: string;
			description?: string;
			requestedBy?: string;
		};
		// An approval may only be attached to a project of the caller's tenant
		const { tenantId } = tenantOf(c);
		if (!body.projectId) {
			// Project-less approvals belong to no tenant: only platform admins may create them
			if (!isPlatformAdminRequest(c)) return c.json({ error: "projectId is required" }, 400);
		} else if (!(tenantId && (await isProjectInTenant(body.projectId, tenantId)))) {
			return c.json({ error: "Project not found" }, 404);
		}
		const approval = await requestApproval({ ...body, requestedBy: actorOf(c) });
		return c.json({ approval }, 201);
	} catch (err) {
		log.error(`[approvals] create failed: ${String(err)}`);
		return c.json({ error: String(err) }, 500);
	}
});

cpApprovalRoutes.post("/control-plane/approvals/expire-stale", async (c) => {
	try {
		const count = await expireStaleApprovals(tenantOf(c));
		return c.json({ expired: count });
	} catch (err) {
		log.error(`[approvals] expire-stale failed: ${String(err)}`);
		return c.json({ error: String(err) }, 500);
	}
});

cpApprovalRoutes.post("/control-plane/approvals/:id/escalate", async (c) => {
	try {
		const body = (await c.req.json().catch(() => ({}))) as { target?: string };
		if (!body.target) return c.json({ error: "target is required" }, 400);
		const approval = await escalateApproval(c.req.param("id"), body.target, actorOf(c), tenantOf(c));
		if (!approval) return c.json({ error: "Approval not found" }, 404);
		return c.json({ approval });
	} catch (err) {
		log.error(`[approvals] escalate failed: ${String(err)}`);
		return c.json({ error: String(err) }, 500);
	}
});
