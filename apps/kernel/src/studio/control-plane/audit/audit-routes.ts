// ---------------------------------------------------------------------------
// Control Plane — Audit Routes
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { listAuditEvents, listSecurityEvents, appendAuditEvent, appendSecurityEvent } from "./audit-repo.js";
import { createLogger } from "../../logger.js";

const log = createLogger("cp-audit-routes");

export const cpAuditRoutes = new Hono();

// GET /control-plane/audit
cpAuditRoutes.get("/audit", async (c) => {
	try {
		const events = await listAuditEvents({
			category: c.req.query("category") ?? undefined,
			severity: c.req.query("severity") ?? undefined,
			actor: c.req.query("actor") ?? undefined,
			projectId: c.req.query("projectId") ?? undefined,
			limit: Number(c.req.query("limit") ?? "100"),
		});
		return c.json({ events });
	} catch (err) {
		log.error("[audit] list failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

// GET /control-plane/security-events
cpAuditRoutes.get("/security-events", async (c) => {
	try {
		const events = await listSecurityEvents({
			severity: c.req.query("severity") ?? undefined,
			eventType: c.req.query("eventType") ?? undefined,
			projectId: c.req.query("projectId") ?? undefined,
			limit: Number(c.req.query("limit") ?? "100"),
		});
		return c.json({ events });
	} catch (err) {
		log.error("[audit] security list failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

// POST /control-plane/audit (internal — services emit via this)
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
		const event = await appendAuditEvent(body);
		return c.json({ event }, 201);
	} catch (err) {
		log.error("[audit] append failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});
