import type { Context } from "hono";
import { listProjectAgents } from "../db.js";

export async function ensureProjectTeamInitialized(c: Context, projectId: string): Promise<Response | null> {
	const agents = await listProjectAgents(projectId);
	if (agents.length > 0) return null;
	return c.json({ error: "team not initialized" }, 422);
}
