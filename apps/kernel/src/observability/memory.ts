// ---------------------------------------------------------------------------
// Observability — Memory API (ARCHIVED)
// Previously exposed VoltAgent memory tables through REST endpoints.
// VoltAgent integration has been removed. All endpoints return archived
// responses so callers understand the surface is no longer active.
// ---------------------------------------------------------------------------

import { Hono } from "hono";

export const memoryRoutes = new Hono();

memoryRoutes.get("/memory/stats", async (c) => {
	return c.json({ archived: true, totalConversations: 0, totalMessages: 0, totalSteps: 0, byAgent: [], totalWorkflows: 0 });
});

memoryRoutes.get("/memory/conversations", async (c) => {
	return c.json({ archived: true, conversations: [], total: 0 });
});

memoryRoutes.get("/memory/conversations/:id", async (c) => {
	return c.json({ archived: true, error: "Archived surface — VoltAgent integration removed" }, 410);
});

memoryRoutes.get("/memory/conversations/:id/messages", async (c) => {
	return c.json({ archived: true, messages: [] });
});

memoryRoutes.get("/memory/workflows", async (c) => {
	return c.json({ archived: true, workflows: [], total: 0 });
});

memoryRoutes.delete("/memory/conversations/:id", async (c) => {
	return c.json({ archived: true, error: "Archived surface — VoltAgent integration removed" }, 410);
});
