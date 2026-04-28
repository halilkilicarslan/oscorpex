// ---------------------------------------------------------------------------
// Control Plane — Presence Routes (thin host)
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
	listPresence,
	computePresenceState,
	getAgentHeartbeats,
	getProviderHeartbeats,
	recordHeartbeat,
	 type PresenceState,
} from "@oscorpex/control-plane";
import { createLogger } from "../../logger.js";

const log = createLogger("cp-presence-routes");

export const cpPresenceRoutes = new Hono();

cpPresenceRoutes.get("/presence", async (c) => {
	try {
		const presence = await listPresence();
		return c.json({ presence });
	} catch (err) {
		log.error("[presence] list failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

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
