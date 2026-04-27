// ---------------------------------------------------------------------------
// Control Plane — Approval Routes
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
	requestApproval,
	approve,
	reject,
	expireStaleApprovals,
	getApprovalWithEvents,
	listPendingApprovals,
	listApprovals,
	 type ApprovalKind,
} from "./approval-service.js";
import { createLogger } from "../../logger.js";

const log = createLogger("cp-approval-routes");

export const cpApprovalRoutes = new Hono();

// GET /control-plane/approvals
cpApprovalRoutes.get("/approvals", async (c) => {
	try {
		const status = c.req.query("status") ?? undefined;
		const approvals = await listApprovals(status);
		return c.json({ approvals });
	} catch (err) {
		log.error("[approvals] list failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

// GET /control-plane/approvals/:id
cpApprovalRoutes.get("/approvals/:id", async (c) => {
	try {
		const result = await getApprovalWithEvents(c.req.param("id"));
		if (!result) return c.json({ error: "Approval not found" }, 404);
		return c.json(result);
	} catch (err) {
		log.error("[approvals] get failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

// POST /control-plane/approvals/:id/approve
cpApprovalRoutes.post("/approvals/:id/approve", async (c) => {
	try {
		const body = (await c.req.json().catch(() => ({}))) as { actor?: string };
		const approval = await approve(c.req.param("id"), body.actor ?? "human");
		if (!approval) return c.json({ error: "Approval not found" }, 404);
		return c.json({ approval });
	} catch (err) {
		log.error("[approvals] approve failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

// POST /control-plane/approvals/:id/reject
cpApprovalRoutes.post("/approvals/:id/reject", async (c) => {
	try {
		const body = (await c.req.json().catch(() => ({}))) as { actor?: string };
		const approval = await reject(c.req.param("id"), body.actor ?? "human");
		if (!approval) return c.json({ error: "Approval not found" }, 404);
		return c.json({ approval });
	} catch (err) {
		log.error("[approvals] reject failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

// POST /control-plane/approvals (create)
cpApprovalRoutes.post("/approvals", async (c) => {
	try {
		const body = (await c.req.json()) as {
			projectId?: string;
			kind: ApprovalKind;
			title: string;
			description?: string;
			requestedBy?: string;
		};
		const approval = await requestApproval(body);
		return c.json({ approval }, 201);
	} catch (err) {
		log.error("[approvals] create failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

// POST /control-plane/approvals/expire-stale (internal / cron helper)
cpApprovalRoutes.post("/approvals/expire-stale", async (c) => {
	try {
		const count = await expireStaleApprovals();
		return c.json({ expired: count });
	} catch (err) {
		log.error("[approvals] expire-stale failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});
