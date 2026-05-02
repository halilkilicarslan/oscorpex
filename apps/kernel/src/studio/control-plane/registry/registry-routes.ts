// ---------------------------------------------------------------------------
// Control Plane — Registry Routes (thin host)
// ---------------------------------------------------------------------------

import {
	getRegistryProvider,
	getRegistryState,
	listProviderCapabilities,
	listRegistryAgents,
	listRegistryProviders,
} from "@oscorpex/control-plane";
import { Hono } from "hono";
import { createLogger } from "../../logger.js";

const log = createLogger("cp-registry-routes");

export const cpRegistryRoutes = new Hono();

cpRegistryRoutes.get("/registry/agents", async (c) => {
	try {
		const projectId = c.req.query("projectId") ?? undefined;
		const agents = await listRegistryAgents(projectId);
		return c.json({ agents });
	} catch (err) {
		log.error("[registry] list agents failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

cpRegistryRoutes.get("/registry/providers", async (c) => {
	try {
		const providers = await listRegistryProviders();
		return c.json({
			providers: providers.map((p) => ({
				...p,
				capabilities: (() => {
					try {
						return JSON.parse(p.capabilities) as string[];
					} catch {
						return [];
					}
				})(),
			})),
		});
	} catch (err) {
		log.error("[registry] list providers failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

cpRegistryRoutes.get("/registry/providers/:id", async (c) => {
	try {
		const provider = await getRegistryProvider(c.req.param("id"));
		if (!provider) return c.json({ error: "Provider not found" }, 404);
		const capabilities = await listProviderCapabilities(provider.id);
		return c.json({ provider: { ...provider, capabilities } });
	} catch (err) {
		log.error("[registry] get provider failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});

cpRegistryRoutes.get("/registry/state", async (c) => {
	try {
		const state = await getRegistryState();
		return c.json(state);
	} catch (err) {
		log.error("[registry] get state failed: " + String(err));
		return c.json({ error: String(err) }, 500);
	}
});
