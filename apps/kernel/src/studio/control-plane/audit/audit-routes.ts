// ---------------------------------------------------------------------------
// Control Plane — Audit Routes (thin host)
// ---------------------------------------------------------------------------

import { appendAuditEvent, appendSecurityEvent, listAuditEvents, listSecurityEvents } from "@oscorpex/control-plane";
import { Hono } from "hono";
import { assertProjectInTenant } from "../../auth/project-access.js";
import { createLogger } from "../../logger.js";

const log = createLogger("cp-audit-routes");

export const cpAuditRoutes = new Hono();

cpAuditRoutes.get("/audit", async (c) => {
	const projectId = c.req.query("projectId") ?? undefined;
	if (projectId) {
		const denied = await assertProjectInTenant(c, projectId);
		if (denied) return denied;
	}
	try {
		const events = await listAuditEvents({
			category: c.req.query("category") ?? undefined,
			severity: c.req.query("severity") ?? undefined,
			actor: c.req.query("actor") ?? undefined,
			projectId,
			limit: Number(c.req.query("limit") ?? "100"),
		});
		return c.json({ events });
	} catch (err) {
		log.error(`[audit] list failed: ${String(err)}`);
		return c.json({ error: String(err) }, 500);
	}
});

cpAuditRoutes.get("/security-events", async (c) => {
	const projectId = c.req.query("projectId") ?? undefined;
	if (projectId) {
		const denied = await assertProjectInTenant(c, projectId);
		if (denied) return denied;
	}
	try {
		const events = await listSecurityEvents({
			severity: c.req.query("severity") ?? undefined,
			eventType: c.req.query("eventType") ?? undefined,
			projectId,
			limit: Number(c.req.query("limit") ?? "100"),
		});
		return c.json({ events });
	} catch (err) {
		log.error(`[audit] security list failed: ${String(err)}`);
		return c.json({ error: String(err) }, 500);
	}
});

cpAuditRoutes.post("/audit", async (c) => {
	try {
		const body = (await c.req.json()) as {
			projectId?: string;
			category: string;
			severity?: string;
			actor?: string;
			action: string;
			details?: Record<string, unknown>;
		};
		if (body.projectId) {
			const denied = await assertProjectInTenant(c, body.projectId);
			if (denied) return denied;
		}
		const event = await appendAuditEvent(body);
		return c.json({ event }, 201);
	} catch (err) {
		log.error(`[audit] append failed: ${String(err)}`);
		return c.json({ error: String(err) }, 500);
	}
});
