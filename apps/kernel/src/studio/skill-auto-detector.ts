// ---------------------------------------------------------------------------
// Oscorpex — Skill Auto-Detector
// Analyzes a project and its agents, suggests and assigns skills automatically.
// ---------------------------------------------------------------------------

import type { Skill } from "./db/skill-repo.js";
import { createLogger } from "./logger.js";
import type { Project, ProjectAgent } from "./types.js";

const log = createLogger("skill-auto-detector");

export interface SkillSuggestion {
	skill: Skill;
	agent: ProjectAgent;
	confidence: number; // 0-1
	reason: string;
}

/**
 * Analyzes a project and its agents, returns skill suggestions.
 * Matches skills based on:
 * 1. Project techStack → skill triggers
 * 2. Project description keywords → skill triggers
 * 3. Agent role → skill applicableRoles
 */
export async function detectSkillsForProject(project: Project, agents: ProjectAgent[]): Promise<SkillSuggestion[]> {
	const { listSkills } = await import("./db.js");
	const allSkills = await listSkills({});

	if (allSkills.length === 0 || agents.length === 0) return [];

	const suggestions: SkillSuggestion[] = [];
	const projectText =
		`${project.name} ${project.description ?? ""} ${(project.techStack ?? []).join(" ")}`.toLowerCase();
	const techStackSet = new Set((project.techStack ?? []).map((t) => t.toLowerCase()));

	for (const skill of allSkills) {
		// Score each skill against the project
		let projectScore = 0;
		const matchReasons: string[] = [];

		// Check triggers against techStack (high confidence)
		for (const trigger of skill.triggers) {
			const lowerTrigger = trigger.toLowerCase();
			if (techStackSet.has(lowerTrigger)) {
				projectScore += 0.5;
				matchReasons.push(`techStack:${trigger}`);
			}
			// Check triggers against project description (medium confidence)
			if (projectText.includes(lowerTrigger)) {
				projectScore += 0.3;
				matchReasons.push(`description:${trigger}`);
			}
		}

		if (projectScore === 0) continue; // No project-level match

		// Find matching agents by role
		for (const agent of agents) {
			const roleMatch =
				skill.applicableRoles.length === 0 ||
				skill.applicableRoles.some((r) => r.toLowerCase() === agent.role.toLowerCase());

			if (!roleMatch) continue;

			const confidence = Math.min(1, projectScore + (skill.applicableRoles.length > 0 ? 0.2 : 0));

			suggestions.push({
				skill,
				agent,
				confidence,
				reason: matchReasons.join(", "),
			});
		}
	}

	// Sort by confidence descending, deduplicate by skill+agent
	const seen = new Set<string>();
	return suggestions
		.sort((a, b) => b.confidence - a.confidence)
		.filter((s) => {
			const key = `${s.skill.id}:${s.agent.id}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
}

/**
 * Auto-assign detected skills to agents (only if not already assigned).
 * Returns count of new assignments.
 */
export async function autoAssignDetectedSkills(
	project: Project,
	agents: ProjectAgent[],
	minConfidence = 0.5,
): Promise<{ assigned: number; suggestions: SkillSuggestion[] }> {
	const { assignSkillToAgent, getAgentSkills } = await import("./db.js");

	const suggestions = await detectSkillsForProject(project, agents);
	const qualified = suggestions.filter((s) => s.confidence >= minConfidence);

	let assigned = 0;
	for (const s of qualified) {
		try {
			// Check if already assigned
			const existing = await getAgentSkills(s.agent.id);
			if (existing.some((e) => e.id === s.skill.id)) continue;

			await assignSkillToAgent(s.agent.id, s.skill.id, Math.round(s.confidence * 10));
			assigned++;
			log.info(
				{
					agentId: s.agent.id,
					agentRole: s.agent.role,
					skillName: s.skill.name,
					confidence: s.confidence,
					reason: s.reason,
				},
				"[skill-auto-detector] Auto-assigned skill",
			);
		} catch (err) {
			log.warn({ err, skillId: s.skill.id, agentId: s.agent.id }, "[skill-auto-detector] Assignment failed");
		}
	}

	return { assigned, suggestions: qualified };
}
