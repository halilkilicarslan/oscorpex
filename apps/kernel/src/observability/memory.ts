// ---------------------------------------------------------------------------
// Observability — Memory API (archived)
// Previously exposed VoltAgent memory tables through REST endpoints.
// VoltAgent integration has been removed; all endpoints now return empty
// results to preserve route wiring without breaking the observability mount.
// ---------------------------------------------------------------------------

import { Hono } from "hono";

export const memoryRoutes = new Hono();

// GET /api/observability/memory/stats
memoryRoutes.get("/memory/stats", async (c) => {
	return c.json({
		totalConversations: 0,
		totalMessages: 0,
		totalSteps: 0,
		byAgent: [],
		totalWorkflows: 0,
	});
});

// GET /api/observability/memory/conversations
memoryRoutes.get("/memory/conversations", async (c) => {
	return c.json({ conversations: [], total: 0 });
});

// GET /api/observability/memory/conversations/:id
memoryRoutes.get("/memory/conversations/:id", async (c) => {
	return c.json({ error: "Not found" }, 404);
});

// GET /api/observability/memory/conversations/:id/messages
memoryRoutes.get("/memory/conversations/:id/messages", async (c) => {
	return c.json({ messages: [] });
});

// GET /api/observability/memory/workflows
memoryRoutes.get("/memory/workflows", async (c) => {
	return c.json({ workflows: [], total: 0 });
});

// DELETE /api/observability/memory/conversations/:id
memoryRoutes.delete("/memory/conversations/:id", async (c) => {
	return c.json({ error: "Not found" }, 404);
});
