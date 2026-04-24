// ---------------------------------------------------------------------------
// Oscorpex — Ceremony Routes (v3.6)
// Scrum ceremonies: standup + retrospective aggregation from task/event data.
// ---------------------------------------------------------------------------

import { type Context, Hono } from "hono";
import { getProject, listProjectAgents } from "../db.js";
import { kernel } from "../kernel/index.js";
import { createLogger } from "../logger.js";
const log = createLogger("ceremony-routes");

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
		const [reports, agents] = await Promise.all([kernel.runStandup(projectId), listProjectAgents(projectId)]);
		const reportList = reports as any[];
		const roleMap = new Map(agents.map((a) => [a.id, a.role] as const));
		return c.json({
			runAt: new Date().toISOString(),
			agents: reportList.map((r: any) => ({
				agentId: r.agentId,
				agentName: r.agentName,
				role: roleMap.get(r.agentId) ?? "",
				completed: r.completedTasks,
				inProgress: r.inProgressTasks,
				blockers: r.blockers,
			})),
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("not found")) return c.json({ error: msg }, 404);
		log.error("[ceremony-routes] standup failed:" + " " + String(err));
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
		const report = await kernel.runRetrospective(projectId);
		return c.json({
			runAt: new Date().toISOString(),
			data: {
				wentWell: report.whatWentWell,
				couldImprove: report.whatCouldImprove,
				actionItems: report.actionItems,
			},
			agentStats: report.agentStats,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("not found")) return c.json({ error: msg }, 404);
		log.error("[ceremony-routes] retrospective failed:" + " " + String(err));
		return c.json({ error: msg }, 500);
	}
}

ceremonyRoutes.get("/projects/:id/ceremonies/retrospective", handleRetrospective);
ceremonyRoutes.post("/projects/:id/ceremonies/retrospective", handleRetrospective);
ceremonyRoutes.get("/projects/:id/ceremonies/retro", handleRetrospective);
ceremonyRoutes.post("/projects/:id/ceremonies/retro", handleRetrospective);
