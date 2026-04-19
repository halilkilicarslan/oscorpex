// ---------------------------------------------------------------------------
// Oscorpex — Cluster Routes: Admin endpoints for horizontal scaling status
// Mounted at /api/studio/cluster
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { wsCluster } from "../ws-cluster.js";

const router = new Hono();

// ---------------------------------------------------------------------------
// GET /cluster/instances — List active server instances
// ---------------------------------------------------------------------------

router.get("/instances", async (c) => {
	try {
		const instances = await wsCluster.getActiveInstances();
		return c.json({
			instances,
			count: instances.length,
			currentInstanceId: wsCluster.currentInstanceId,
		});
	} catch (err) {
		console.error("[cluster-routes] getActiveInstances error:", err);
		return c.json({ error: "Failed to retrieve cluster instances" }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /cluster/status — Cluster health summary
// ---------------------------------------------------------------------------

router.get("/status", async (c) => {
	try {
		const instances = await wsCluster.getActiveInstances();
		const providerType = process.env.OSCORPEX_STATE_PROVIDER ?? "memory";

		return c.json({
			healthy: true,
			providerType,
			instanceCount: instances.length,
			currentInstanceId: wsCluster.currentInstanceId,
			isRegistered: wsCluster.isRegistered,
			thresholds: {
				heartbeatIntervalMs: wsCluster.heartbeatIntervalMs,
				staleThresholdMs: wsCluster.staleThresholdMs,
			},
		});
	} catch (err) {
		console.error("[cluster-routes] status error:", err);
		return c.json({ error: "Failed to retrieve cluster status" }, 500);
	}
});

export { router as clusterRoutes };
