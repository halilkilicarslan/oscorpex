// ---------------------------------------------------------------------------
// CLI Usage Routes — global CLI quota + Oscorpex usage observability
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
	getCLIProbeSettings,
	getCLIProbeEvents,
	getCLIUsageHistory,
	getCLIUsageSnapshot,
	getOscorpexCLIUsage,
	isCLIProviderId,
	latestCLIUsageSnapshots,
	listCLIUsageSnapshots,
	setCLIProbeSettings,
	type ProviderProbePermission,
} from "../cli-usage.js";

export const cliUsageRoutes = new Hono();

cliUsageRoutes.get("/cli-usage/providers", async (c) => {
	return c.json(await listCLIUsageSnapshots(false));
});

cliUsageRoutes.post("/cli-usage/refresh", async (c) => {
	return c.json(await listCLIUsageSnapshots(true));
});

cliUsageRoutes.get("/cli-usage/snapshots", async (c) => {
	return c.json(await latestCLIUsageSnapshots());
});

cliUsageRoutes.get("/cli-usage/history", async (c) => {
	const providerId = c.req.query("providerId");
	const limit = Number.parseInt(c.req.query("limit") ?? "100", 10);
	if (providerId && !isCLIProviderId(providerId)) return c.json({ error: "Unknown CLI provider" }, 404);
	return c.json(await getCLIUsageHistory(providerId && isCLIProviderId(providerId) ? providerId : undefined, limit));
});

cliUsageRoutes.get("/cli-usage/events", async (c) => {
	const providerId = c.req.query("providerId");
	const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
	if (providerId && !isCLIProviderId(providerId)) return c.json({ error: "Unknown CLI provider" }, 404);
	return c.json(await getCLIProbeEvents(providerId && isCLIProviderId(providerId) ? providerId : undefined, limit));
});

cliUsageRoutes.get("/cli-usage/oscorpex", async (c) => {
	return c.json(await getOscorpexCLIUsage());
});

cliUsageRoutes.get("/cli-usage/providers/:providerId", async (c) => {
	const providerId = c.req.param("providerId");
	if (!isCLIProviderId(providerId)) return c.json({ error: "Unknown CLI provider" }, 404);
	return c.json(await getCLIUsageSnapshot(providerId, false));
});

cliUsageRoutes.post("/cli-usage/providers/:providerId/refresh", async (c) => {
	const providerId = c.req.param("providerId");
	if (!isCLIProviderId(providerId)) return c.json({ error: "Unknown CLI provider" }, 404);
	return c.json(await getCLIUsageSnapshot(providerId, true));
});

cliUsageRoutes.put("/cli-usage/providers/:providerId/settings", async (c) => {
	const providerId = c.req.param("providerId");
	if (!isCLIProviderId(providerId)) return c.json({ error: "Unknown CLI provider" }, 404);
	const body = await c.req.json<Partial<ProviderProbePermission>>();
	await setCLIProbeSettings(providerId, body);
	return c.json(await getCLIProbeSettings(providerId));
});
