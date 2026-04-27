// ---------------------------------------------------------------------------
// Control Plane — Incident Routes
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { listIncidents, getIncident, ackIncident, resolveIncident, openIncident } from "./incident-repo.js";
import { createLogger } from "../../logger.js";

const log = createLogger("cp-incident-routes");

export const cpIncidentRoutes = new Hono();

// GET /control-plane/incidents
cpIncidentRoutes.get("/incidents", async (c) => {
	try {
		const status = c.req.query("status") ?? undefined;
		const incidents = await listIncidents(status);
		return c.json({ incidents });
	} catch (err) {
		log.error("[incidents] list failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

// POST /control-plane/incidents/:id/ack
cpIncidentRoutes.post("/incidents/:id/ack", async (c) => {
	try {
		const body = (await c.req.json().catch(() => ({}))) as { actor?: string };
		const incident = await ackIncident(c.req.param("id"), body.actor ?? "human");
		if (!incident) return c.json({ error: "Incident not found" }, 404);
		return c.json({ incident });
	} catch (err) {
		log.error("[incidents] ack failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

// POST /control-plane/incidents/:id/resolve
cpIncidentRoutes.post("/incidents/:id/resolve", async (c) => {
	try {
		const body = (await c.req.json().catch(() => ({}))) as { actor?: string };
		const incident = await resolveIncident(c.req.param("id"), body.actor ?? "human");
		if (!incident) return c.json({ error: "Incident not found" }, 404);
		return c.json({ incident });
	} catch (err) {
		log.error("[incidents] resolve failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

// POST /control-plane/incidents (internal — services emit via this)
cpIncidentRoutes.post("/incidents", async (c) => {
	try {
		const body = (await c.req.json()) as {
			id?: string;
			projectId?: string;
			type: string;
			title: string;
			description?: string;
			severity?: string;
		};
		const incident = await openIncident(body);
		return c.json({ incident }, 201);
	} catch (err) {
		log.error("[incidents] open failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});
