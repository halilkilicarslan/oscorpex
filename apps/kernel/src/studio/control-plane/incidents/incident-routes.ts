// ---------------------------------------------------------------------------
// Control Plane — Incident Routes (thin host)
// ---------------------------------------------------------------------------

import {
	ackIncident,
	addIncidentNote,
	assignIncident,
	getIncident,
	listIncidents,
	openIncident,
	reopenIncident,
	resolveIncident,
	updateIncidentSeverity,
} from "@oscorpex/control-plane";
import { Hono } from "hono";
import { createLogger } from "../../logger.js";

const log = createLogger("cp-incident-routes");

export const cpIncidentRoutes = new Hono();

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

cpIncidentRoutes.post("/incidents/:id/assign", async (c) => {
	try {
		const body = (await c.req.json().catch(() => ({}))) as { assignee?: string; actor?: string };
		if (!body.assignee) return c.json({ error: "assignee is required" }, 400);
		const incident = await assignIncident(c.req.param("id"), body.assignee, body.actor ?? "human");
		if (!incident) return c.json({ error: "Incident not found" }, 404);
		return c.json({ incident });
	} catch (err) {
		log.error("[incidents] assign failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

cpIncidentRoutes.post("/incidents/:id/note", async (c) => {
	try {
		const body = (await c.req.json().catch(() => ({}))) as { note?: string; actor?: string };
		if (!body.note) return c.json({ error: "note is required" }, 400);
		const incident = await addIncidentNote(c.req.param("id"), body.note, body.actor ?? "human");
		if (!incident) return c.json({ error: "Incident not found" }, 404);
		return c.json({ incident });
	} catch (err) {
		log.error("[incidents] note failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

cpIncidentRoutes.post("/incidents/:id/reopen", async (c) => {
	try {
		const body = (await c.req.json().catch(() => ({}))) as { actor?: string; reason?: string };
		const incident = await reopenIncident(c.req.param("id"), body.actor ?? "human", body.reason);
		if (!incident) return c.json({ error: "Incident not found" }, 404);
		return c.json({ incident });
	} catch (err) {
		log.error("[incidents] reopen failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

cpIncidentRoutes.post("/incidents/:id/severity", async (c) => {
	try {
		const body = (await c.req.json().catch(() => ({}))) as { severity?: string; actor?: string };
		if (!body.severity) return c.json({ error: "severity is required" }, 400);
		const incident = await updateIncidentSeverity(c.req.param("id"), body.severity, body.actor ?? "human");
		if (!incident) return c.json({ error: "Incident not found" }, 404);
		return c.json({ incident });
	} catch (err) {
		log.error("[incidents] severity update failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});
