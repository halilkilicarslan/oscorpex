// ---------------------------------------------------------------------------
// Work Item Routes — Backlog CRUD (v3.2)
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
	createWorkItem,
	deleteWorkItem,
	getWorkItem,
	getWorkItems,
	getWorkItemsPaginated,
	updateWorkItem,
} from "../db.js";
import type { WorkItemPriority, WorkItemSource, WorkItemStatus, WorkItemType } from "../types.js";
import { planWorkItem } from "../work-item-planner.js";
import { kernel } from "../kernel/index.js";
import { createLogger } from "../logger.js";
const log = createLogger("work-item-routes");

export const workItemRoutes = new Hono();

// GET /projects/:id/work-items
workItemRoutes.get("/projects/:id/work-items", async (c) => {
	try {
		const projectId = c.req.param("id");
		const { type, priority, status, sprint_id, source } = c.req.query();
		const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
		const offset = Number(c.req.query("offset") ?? 0);

		const [items, total] = await getWorkItemsPaginated(
			projectId,
			{
				type: type as WorkItemType | undefined,
				priority: priority as WorkItemPriority | undefined,
				status: status as WorkItemStatus | undefined,
				sprintId: sprint_id,
				source: source as WorkItemSource | undefined,
			},
			limit,
			offset,
		);

		c.header("X-Total-Count", String(total));
		return c.json(items);
	} catch (err) {
		log.error("[work-item-routes] list items failed:" + " " + String(err));
		return c.json({ error: "Failed to list work items" }, 500);
	}
});

// POST /projects/:id/work-items
workItemRoutes.post("/projects/:id/work-items", async (c) => {
	try {
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
	} catch (err) {
		log.error("[work-item-routes] create item failed:" + " " + String(err));
		return c.json({ error: "Failed to create work item" }, 500);
	}
});

// GET /projects/:id/work-items/:itemId
workItemRoutes.get("/projects/:id/work-items/:itemId", async (c) => {
	try {
		const item = await getWorkItem(c.req.param("itemId"));
		if (!item) return c.json({ error: "Work item not found" }, 404);
		return c.json(item);
	} catch (err) {
		log.error("[work-item-routes] get item failed:" + " " + String(err));
		return c.json({ error: "Failed to get work item" }, 500);
	}
});

// PATCH /projects/:id/work-items/:itemId
workItemRoutes.patch("/projects/:id/work-items/:itemId", async (c) => {
	try {
		const body = await c.req.json();
		const item = await updateWorkItem(c.req.param("itemId"), body);
		if (!item) return c.json({ error: "Work item not found" }, 404);
		return c.json(item);
	} catch (err) {
		log.error("[work-item-routes] update item failed:" + " " + String(err));
		return c.json({ error: "Failed to update work item" }, 500);
	}
});

// DELETE /projects/:id/work-items/:itemId
workItemRoutes.delete("/projects/:id/work-items/:itemId", async (c) => {
	const item = await getWorkItem(c.req.param("itemId"));
	if (!item) return c.json({ error: "Work item not found" }, 404);
	await deleteWorkItem(c.req.param("itemId"));
	return c.json({ success: true });
});

// POST /projects/:id/work-items/:itemId/plan — convert work item into a planned task
workItemRoutes.post("/projects/:id/work-items/:itemId/plan", async (c) => {
	const itemId = c.req.param("itemId");
	try {
		const result = await planWorkItem(itemId);
		// If the project was previously completed/idle, kick execution so newly
		// planned backlog tasks do not remain queued indefinitely.
		kernel.startProjectExecution(result.workItem.projectId).catch((err) => {
			log.error("[kernel] startProjectExecution failed after work-item planning:" + " " + String(err));
		});
		return c.json(result, 201);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes("not found")) return c.json({ error: message }, 404);
		if (message.includes("not open") || message.includes("No plan")) {
			return c.json({ error: message }, 409);
		}
		log.error("[work-item-routes] planWorkItem failed:" + " " + String(err));
		return c.json({ error: message }, 500);
	}
});
