// ---------------------------------------------------------------------------
// Provider Routes — AI Providers + Fallback Chain
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { isAnyProviderConfigured } from "../ai-provider-factory.js";
import {
	createProvider,
	deleteProvider,
	getFallbackChain,
	getDefaultProvider,
	getProvider,
	getRawProviderApiKey,
	listProviders,
	setDefaultProvider,
	updateFallbackOrder,
	updateProvider,
} from "../db.js";

export const providerRoutes = new Hono();

// ---- Config status --------------------------------------------------------

providerRoutes.get("/config/status", async (c) => {
	const defaultProvider = await getDefaultProvider();

	return c.json({
		openaiConfigured: !!process.env.OPENAI_API_KEY,
		providerConfigured: isAnyProviderConfigured(),
		providerName: defaultProvider?.name,
	});
});

// ---- AI Providers ---------------------------------------------------------

providerRoutes.get("/providers", async (c) => {
	return c.json(await listProviders());
});

providerRoutes.post("/providers", async (c) => {
	const body = (await c.req.json()) as {
		name: string;
		type?: string;
		apiKey?: string;
		baseUrl?: string;
		model?: string;
		isActive?: boolean;
	};

	if (!body.name?.trim()) {
		return c.json({ error: "name is required" }, 400);
	}

	const provider = await createProvider({
		name: body.name.trim(),
		type: (body.type ?? "openai") as any,
		apiKey: body.apiKey ?? "",
		baseUrl: body.baseUrl ?? "",
		model: body.model ?? "",
		isActive: body.isActive !== false,
	});

	return c.json(provider, 201);
});

// NOTE: fallback-chain must be before /:id to avoid Hono matching "fallback-chain" as an ID

providerRoutes.get("/providers/fallback-chain", async (c) => {
	return c.json(await getFallbackChain());
});

providerRoutes.put("/providers/fallback-chain", async (c) => {
	const body = (await c.req.json()) as { orderedIds?: string[] };

	if (!Array.isArray(body.orderedIds) || body.orderedIds.length === 0) {
		return c.json({ error: "orderedIds array is required" }, 400);
	}

	await updateFallbackOrder(body.orderedIds);
	return c.json(await getFallbackChain());
});

providerRoutes.get("/providers/:id", async (c) => {
	const provider = await getProvider(c.req.param("id"));
	if (!provider) return c.json({ error: "Provider not found" }, 404);
	return c.json(provider);
});

providerRoutes.put("/providers/:id", async (c) => {
	const body = (await c.req.json()) as {
		name?: string;
		type?: string;
		apiKey?: string;
		baseUrl?: string;
		model?: string;
		isActive?: boolean;
	};

	const provider = await updateProvider(c.req.param("id"), {
		name: body.name,
		type: body.type as any,
		apiKey: body.apiKey,
		baseUrl: body.baseUrl,
		model: body.model,
		isActive: body.isActive,
	});

	if (!provider) return c.json({ error: "Provider not found" }, 404);
	return c.json(provider);
});

providerRoutes.delete("/providers/:id", async (c) => {
	const result = await deleteProvider(c.req.param("id"));
	if (!result.success) {
		return c.json({ error: result.error }, result.error === "Provider not found" ? 404 : 400);
	}
	return c.json({ success: true });
});

providerRoutes.post("/providers/:id/default", async (c) => {
	const provider = await setDefaultProvider(c.req.param("id"));
	if (!provider) return c.json({ error: "Provider not found" }, 404);
	return c.json(provider);
});

providerRoutes.post("/providers/:id/test", async (c) => {
	const provider = await getProvider(c.req.param("id"));
	if (!provider) return c.json({ error: "Provider not found" }, 404);

	if (provider.type !== "openai") {
		return c.json({
			valid: true,
			message: "Validation not available for this provider type",
		});
	}

	try {
		const apiKey = await getRawProviderApiKey(provider.id);
		const res = await fetch("https://api.openai.com/v1/models", {
			headers: { Authorization: `Bearer ${apiKey}` },
		});

		if (res.ok) {
			return c.json({ valid: true, message: "Connection successful" });
		}

		const errorBody = await res.json().catch(() => ({}));
		return c.json({
			valid: false,
			message: (errorBody as any)?.error?.message ?? `HTTP ${res.status}`,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Connection failed";
		return c.json({ valid: false, message: msg });
	}
});
