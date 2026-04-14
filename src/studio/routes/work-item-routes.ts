// ---------------------------------------------------------------------------
// Work Item Routes — Backlog CRUD (v3.2)
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { createWorkItem, deleteWorkItem, getWorkItem, getWorkItems, updateWorkItem } from "../db.js";
import type { WorkItemPriority, WorkItemSource, WorkItemStatus, WorkItemType } from "../types.js";

export const workItemRoutes = new Hono();

// GET /projects/:id/work-items
workItemRoutes.get("/projects/:id/work-items", async (c) => {
	const projectId = c.req.param("id");
	const { type, priority, status, sprint_id, source } = c.req.query();

	const items = await getWorkItems(projectId, {
		type: type as WorkItemType | undefined,
		priority: priority as WorkItemPriority | undefined,
		status: status as WorkItemStatus | undefined,
		sprintId: sprint_id,
		source: source as WorkItemSource | undefined,
	});

	return c.json(items);
});

// POST /projects/:id/work-items
workItemRoutes.post("/projects/:id/work-items", async (c) => {
	const projectId = c.req.param("id");
	const body = await c.req.json<{
		type: WorkItemType;
		title: string;
		description?: string;
		priority?: WorkItemPriority;
		severity?: "blocker" | "major" | "minor" | "trivial";
		labels?: string[];
		source?: WorkItemSource;
		sourceAgentId?: string;
		sourceTaskId?: string;
	}>();

	if (!body.type || !body.title) {
		return c.json({ error: "type and title are required" }, 400);
	}

	const item = await createWorkItem({ projectId, ...body });
	return c.json(item, 201);
});

// GET /projects/:id/work-items/:itemId
workItemRoutes.get("/projects/:id/work-items/:itemId", async (c) => {
	const item = await getWorkItem(c.req.param("itemId"));
	if (!item) return c.json({ error: "Work item not found" }, 404);
	return c.json(item);
});

// PATCH /projects/:id/work-items/:itemId
workItemRoutes.patch("/projects/:id/work-items/:itemId", async (c) => {
	const body = await c.req.json();
	const item = await updateWorkItem(c.req.param("itemId"), body);
	if (!item) return c.json({ error: "Work item not found" }, 404);
	return c.json(item);
});

// DELETE /projects/:id/work-items/:itemId
workItemRoutes.delete("/projects/:id/work-items/:itemId", async (c) => {
	const item = await getWorkItem(c.req.param("itemId"));
	if (!item) return c.json({ error: "Work item not found" }, 404);
	await deleteWorkItem(c.req.param("itemId"));
	return c.json({ success: true });
});

// POST /projects/:id/work-items/:itemId/plan — placeholder for converting to task
workItemRoutes.post("/projects/:id/work-items/:itemId/plan", async (c) => {
	const item = await getWorkItem(c.req.param("itemId"));
	if (!item) return c.json({ error: "Work item not found" }, 404);
	return c.json({ message: "Planning not yet implemented", workItemId: item.id });
});
