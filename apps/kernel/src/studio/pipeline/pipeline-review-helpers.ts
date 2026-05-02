// ---------------------------------------------------------------------------
// Oscorpex — Pipeline Review Helpers
// Resolves review dependency relationships between dev and reviewer agents.
// ---------------------------------------------------------------------------

import { listAgentDependencies, listProjectAgents } from "../db.js";
import type { ProjectAgent } from "../types.js";

export class PipelineReviewHelpers {
	async findReviewerForAgent(projectId: string, agentId: string): Promise<ProjectAgent | null> {
		const deps = await listAgentDependencies(projectId, "review");
		const reviewDep = deps.find((d) => d.fromAgentId === agentId);
		if (!reviewDep) return null;

		const agents = await listProjectAgents(projectId);
		return agents.find((a) => a.id === reviewDep.toAgentId) ?? null;
	}

	async findDevForReviewer(projectId: string, reviewerAgentId: string): Promise<ProjectAgent | null> {
		const deps = await listAgentDependencies(projectId, "review");
		const reviewDep = deps.find((d) => d.toAgentId === reviewerAgentId);
		if (!reviewDep) return null;

		const agents = await listProjectAgents(projectId);
		return agents.find((a) => a.id === reviewDep.fromAgentId) ?? null;
	}
}
