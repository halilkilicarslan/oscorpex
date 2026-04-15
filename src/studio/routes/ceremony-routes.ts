// ---------------------------------------------------------------------------
// Oscorpex — Ceremony Routes (v3.6)
// Scrum ceremonies: standup + retrospective aggregation from task/event data.
// ---------------------------------------------------------------------------

import { type Context, Hono } from "hono";
import { runRetrospective, runStandup } from "../ceremony-engine.js";
import { getProject } from "../db.js";

export const ceremonyRoutes = new Hono();

async function ensureProjectExists(projectId: string) {
	const project = await getProject(projectId);
	if (!project) {
		throw new Error(`Project ${projectId} not found`);
	}
}

// ---------------------------------------------------------------------------
// Standup — GET (initial load) and POST (manual refresh) share the same logic
// ---------------------------------------------------------------------------

async function handleStandup(c: Context) {
	const projectId = c.req.param("id") ?? "";
	try {
		await ensureProjectExists(projectId);
		const reports = await runStandup(projectId);
		return c.json(reports);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("not found")) return c.json({ error: msg }, 404);
		console.error("[ceremony-routes] standup failed:", err);
		return c.json({ error: msg }, 500);
	}
}

ceremonyRoutes.get("/projects/:id/ceremonies/standup", handleStandup);
ceremonyRoutes.post("/projects/:id/ceremonies/standup", handleStandup);

// ---------------------------------------------------------------------------
// Retrospective — support both /retrospective (CeremonyPanel) and /retro (studio-api)
// ---------------------------------------------------------------------------

async function handleRetrospective(c: Context) {
	const projectId = c.req.param("id") ?? "";
	try {
		await ensureProjectExists(projectId);
		const report = await runRetrospective(projectId);
		return c.json(report);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("not found")) return c.json({ error: msg }, 404);
		console.error("[ceremony-routes] retrospective failed:", err);
		return c.json({ error: msg }, 500);
	}
}

ceremonyRoutes.get("/projects/:id/ceremonies/retrospective", handleRetrospective);
ceremonyRoutes.post("/projects/:id/ceremonies/retrospective", handleRetrospective);
ceremonyRoutes.get("/projects/:id/ceremonies/retro", handleRetrospective);
ceremonyRoutes.post("/projects/:id/ceremonies/retro", handleRetrospective);
