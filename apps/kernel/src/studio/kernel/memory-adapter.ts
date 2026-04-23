// @oscorpex/kernel — MemoryProvider adapter
// Implements the MemoryProvider contract from @oscorpex/core.
// Delegates context packet building to @oscorpex/memory-kit; DB fetch stays here.

import type { MemoryProvider, ContextPacket, ContextPacketOptions } from "@oscorpex/core";
import { estimateTokens, assemblePlannerPrompt, assembleTeamArchitectPrompt } from "@oscorpex/memory-kit";
import { randomUUID } from "node:crypto";

class KernelMemoryProvider implements MemoryProvider {
	async buildContextPacket(options: ContextPacketOptions): Promise<ContextPacket> {
		const { projectId, mode, maxTokens = 40_000 } = options;

		const { getProject, listProjectAgents, getLatestPlan, listPhases } = await import("../db.js");
		const project = await getProject(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);

		const agents = await listProjectAgents(projectId);
		const plan = await getLatestPlan(projectId);
		const phases = plan ? await listPhases(plan.id) : [];

		let prompt = "";
		const sections: Record<string, number> = {};

		switch (mode) {
			case "planner": {
				const data = {
					project: { name: project.name, description: project.description, techStack: project.techStack },
					plan: plan ? {
						version: plan.version,
						status: plan.status,
						phases: phases.map((ph: any) => ({
							order: ph.order,
							name: ph.name,
							status: ph.status,
							tasks: (ph.tasks ?? []).map((t: any) => ({ title: t.title, status: t.status, assignedAgent: t.assignedAgent })),
						})),
					} : undefined,
				};
				const result = assemblePlannerPrompt(data, maxTokens);
				prompt = result.prompt;
				Object.assign(sections, result.sections);
				break;
			}
			case "team_architect": {
				const data = {
					project: { name: project.name, description: project.description, techStack: project.techStack },
					agents: agents.map((a: any) => ({ id: a.id, name: a.name, role: a.role, skills: a.skills, reportsTo: a.reportsTo })),
				};
				const result = assembleTeamArchitectPrompt(data, maxTokens);
				prompt = result.prompt;
				Object.assign(sections, result.sections);
				break;
			}
			default:
				throw new Error(`MemoryProvider mode "${mode}" not yet implemented — use context-packet.ts directly`);
		}

		return {
			id: randomUUID(),
			taskId: options.taskId ?? "",
			mode,
			text: prompt,
			tokenEstimate: estimateTokens(prompt),
			sections,
			refs: [],
		};
	}
}

export const memoryProvider = new KernelMemoryProvider();