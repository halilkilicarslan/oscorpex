// ---------------------------------------------------------------------------
// Control Plane — Presence Routes
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
	listPresence,
	computePresenceState,
	getAgentHeartbeats,
	getProviderHeartbeats,
	recordHeartbeat,
	 type PresenceState,
} from "./presence-service.js";
import { createLogger } from "../../logger.js";

const log = createLogger("cp-presence-routes");

export const cpPresenceRoutes = new Hono();

// GET /control-plane/presence
cpPresenceRoutes.get("/presence", async (c) => {
	try {
		const presence = await listPresence();
		return c.json({ presence });
	} catch (err) {
		log.error("[presence] list failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

// GET /control-plane/presence/:agentId
cpPresenceRoutes.get("/presence/:agentId", async (c) => {
	try {
		const agentId = c.req.param("agentId");
		const summary = await computePresenceState(agentId);
		const heartbeats = await getAgentHeartbeats(agentId);
		return c.json({ summary, heartbeats });
	} catch (err) {
		log.error("[presence] get failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

// POST /control-plane/presence/heartbeat (internal use)
cpPresenceRoutes.post("/presence/heartbeat", async (c) => {
	try {
		const body = (await c.req.json()) as {
			agentId?: string;
			providerId?: string;
			projectId?: string;
			state: PresenceState;
			payload?: Record<string, unknown>;
		};
		const hb = await recordHeartbeat(body);
		return c.json({ heartbeat: hb });
	} catch (err) {
		log.error("[presence] heartbeat failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});
