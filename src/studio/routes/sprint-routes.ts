// ---------------------------------------------------------------------------
// Oscorpex — Sprint Routes (v3.9)
// CRUD + lifecycle + burndown/velocity endpoints for Scrum sprints.
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { getProject, getWorkItems } from "../db.js";
import {
	calculateBurndown,
	calculateVelocity,
	cancelSprint,
	completeSprint,
	createSprint,
	getSprint,
	getSprintsByProject,
	startSprint,
} from "../sprint-manager.js";

export const sprintRoutes = new Hono();

function defaultSprintDates(): { startDate: string; endDate: string } {
	const start = new Date();
	const end = new Date(start);
	end.setDate(end.getDate() + 14);
	return {
		startDate: start.toISOString().slice(0, 10),
		endDate: end.toISOString().slice(0, 10),
	};
}

// ---------------------------------------------------------------------------
// GET /projects/:id/sprints — list sprints with attached work items
// ---------------------------------------------------------------------------

sprintRoutes.get("/projects/:id/sprints", async (c) => {
	const projectId = c.req.param("id") ?? "";
	try {
		const sprints = await getSprintsByProject(projectId);
		const enriched = await Promise.all(
			sprints.map(async (sprint) => {
				const workItems = await getWorkItems(projectId, { sprintId: sprint.id });
				return { ...sprint, workItems };
			}),
		);
		return c.json(enriched);
	} catch (err) {
		console.error("[sprint-routes] list failed:", err);
		const msg = err instanceof Error ? err.message : String(err);
		return c.json({ error: msg }, 500);
	}
});

// ---------------------------------------------------------------------------
// POST /projects/:id/sprints — create sprint
// ---------------------------------------------------------------------------

sprintRoutes.post("/projects/:id/sprints", async (c) => {
	const projectId = c.req.param("id") ?? "";
	const body = (await c.req.json().catch(() => ({}))) as {
		name?: string;
		goal?: string;
		startDate?: string;
		endDate?: string;
	};

	const name = typeof body?.name === "string" ? body.name.trim() : "";
	if (!name) return c.json({ error: "name is required" }, 400);

	const project = await getProject(projectId);
	if (!project) return c.json({ error: `Project ${projectId} not found` }, 404);

	const defaults = defaultSprintDates();
	try {
		const sprint = await createSprint(projectId, {
			name,
			goal: body.goal,
			startDate: body.startDate ?? defaults.startDate,
			endDate: body.endDate ?? defaults.endDate,
		});
		return c.json(sprint, 201);
	} catch (err) {
		console.error("[sprint-routes] create failed:", err);
		const msg = err instanceof Error ? err.message : String(err);
		return c.json({ error: msg }, 500);
	}
});

// ---------------------------------------------------------------------------
// GET /sprints/:id — single sprint detail
// ---------------------------------------------------------------------------

sprintRoutes.get("/sprints/:id", async (c) => {
	const id = c.req.param("id") ?? "";
	const sprint = await getSprint(id);
	if (!sprint) return c.json({ error: `Sprint ${id} not found` }, 404);
	return c.json(sprint);
});

// ---------------------------------------------------------------------------
// POST /sprints/:id/{start|complete|cancel} — lifecycle transitions
// ---------------------------------------------------------------------------

function mapSprintError(msg: string) {
	if (msg.includes("not found")) return 404;
	if (msg.includes("already has an active") || msg.includes("not in 'planned'")) return 409;
	return 500;
}

sprintRoutes.post("/sprints/:id/start", async (c) => {
	try {
		const sprint = await startSprint(c.req.param("id") ?? "");
		return c.json(sprint);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return c.json({ error: msg }, mapSprintError(msg));
	}
});

sprintRoutes.post("/sprints/:id/complete", async (c) => {
	try {
		const sprint = await completeSprint(c.req.param("id") ?? "");
		return c.json(sprint);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return c.json({ error: msg }, mapSprintError(msg));
	}
});

sprintRoutes.post("/sprints/:id/cancel", async (c) => {
	try {
		const sprint = await cancelSprint(c.req.param("id") ?? "");
		return c.json(sprint);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return c.json({ error: msg }, mapSprintError(msg));
	}
});

// ---------------------------------------------------------------------------
// GET /sprints/:id/burndown — per-day remaining work items
// ---------------------------------------------------------------------------

sprintRoutes.get("/sprints/:id/burndown", async (c) => {
	const id = c.req.param("id") ?? "";
	const sprint = await getSprint(id);
	if (!sprint) return c.json({ error: `Sprint ${id} not found` }, 404);
	const data = await calculateBurndown(id);
	return c.json({ sprintId: id, data });
});

// ---------------------------------------------------------------------------
// GET /projects/:id/velocity?lastN=3 — average work items completed per sprint
// ---------------------------------------------------------------------------

sprintRoutes.get("/projects/:id/velocity", async (c) => {
	const projectId = c.req.param("id") ?? "";
	const lastNRaw = c.req.query("lastN");
	const lastN = lastNRaw ? Number.parseInt(lastNRaw, 10) : undefined;
	const velocity = await calculateVelocity(projectId, Number.isNaN(lastN) ? undefined : lastN);
	return c.json({ projectId, velocity });
});
