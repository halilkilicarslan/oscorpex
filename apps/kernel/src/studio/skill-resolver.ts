// ---------------------------------------------------------------------------
// Oscorpex — Skill Resolver (v8.3 Skills Runtime)
//
// Determines which skills to inject into an agent's prompt at task execution
// time. Resolution runs in four priority tiers:
//
//   1. Agent-assigned  — highest priority, always Level 2 (full body)
//   2. Project-assigned — Level 2, scoped to the running project
//   3. Global + role    — global skills filtered to the agent's role
//   4. Trigger-matched  — keyword scan across task title + description
//
// Skills that would exceed `maxTokenBudget` are downgraded to Level 1
// (metadata summary only) rather than dropped outright, so the agent is
// at least aware of their existence.
// ---------------------------------------------------------------------------

import type { Skill } from "./db/skill-repo.js";
import { createLogger } from "./logger.js";
import type { Task } from "./types.js";

const log = createLogger("skill-resolver");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ResolvedSkill {
	skill: Skill;
	/** Human-readable reason the skill was matched for telemetry / debugging. */
	matchReason: string; // e.g. "agent_assigned", "project_assigned", "global:role=frontend-dev", "trigger:react"
	/**
	 * Injection level:
	 *   1 = metadata only (name + description bullet in "Available Skills" block)
	 *   2 = full Markdown body injected as a SKILL section
	 */
	level: 1 | 2;
}

export interface SkillInjectionResult {
	skills: ResolvedSkill[];
	/** Ready-to-append Markdown block; empty string when no skills resolved. */
	promptSection: string;
	/** Rough token estimate for the Level-2 content actually injected. */
	totalTokenEstimate: number;
}

// ---------------------------------------------------------------------------
// Core resolver
// ---------------------------------------------------------------------------

/**
 * Resolve which skills should be injected for a given task + agent.
 *
 * @param task           - The task being executed.
 * @param agentId        - DB ID of the assigned agent (used for agent_skills lookup).
 * @param agentRole      - Canonical role string (e.g. "frontend-dev").
 * @param projectId      - Project the task belongs to (used for project_skills lookup).
 * @param maxTokenBudget - Soft cap for Level-2 token injection (default 10 000).
 *                         Skills that would exceed the cap are kept at Level 1.
 */
export async function resolveSkillsForTask(
	task: Task,
	agentId: string,
	agentRole: string,
	projectId: string,
	maxTokenBudget = 10_000,
): Promise<SkillInjectionResult> {
	// Lazy import avoids circular dependency: skill-resolver ← db ← *
	const { getAgentSkills, getProjectSkills, listSkills } = await import("./db.js");

	const matched: ResolvedSkill[] = [];
	const seenIds = new Set<string>();

	// --- Tier 1: skills explicitly assigned to this agent ---
	const agentSkills = await getAgentSkills(agentId);
	for (const skill of agentSkills) {
		if (!seenIds.has(skill.id)) {
			matched.push({ skill, matchReason: "agent_assigned", level: 2 });
			seenIds.add(skill.id);
		}
	}

	// --- Tier 2: skills assigned to the project ---
	const projectSkills = await getProjectSkills(projectId);
	for (const skill of projectSkills) {
		if (!seenIds.has(skill.id)) {
			matched.push({ skill, matchReason: "project_assigned", level: 2 });
			seenIds.add(skill.id);
		}
	}

	// --- Tier 3: global skills compatible with this agent role ---
	// listSkills with isGlobal=true and role filter returns skills whose
	// applicable_roles contains the role OR is empty (all-roles).
	const globalSkills = await listSkills({ isGlobal: true, role: agentRole });
	for (const skill of globalSkills) {
		if (!seenIds.has(skill.id)) {
			matched.push({ skill, matchReason: `global:role=${agentRole}`, level: 2 });
			seenIds.add(skill.id);
		}
	}

	// --- Tier 4: trigger-based matching (task title + description keyword scan) ---
	// Fetch all non-already-matched skills and scan their trigger keywords.
	const allSkills = await listSkills({});
	const taskText = `${task.title} ${task.description ?? ""}`.toLowerCase();

	for (const skill of allSkills) {
		if (seenIds.has(skill.id)) continue;

		const triggerMatch = skill.triggers.find((t) => taskText.includes(t.toLowerCase()));
		if (!triggerMatch) continue;

		// Respect role restrictions: empty applicableRoles means "all roles"
		const roleCompatible = skill.applicableRoles.length === 0 || skill.applicableRoles.includes(agentRole);
		if (roleCompatible) {
			matched.push({ skill, matchReason: `trigger:${triggerMatch}`, level: 2 });
			seenIds.add(skill.id);
		}
	}

	// --- Token budget enforcement ---
	// Walk matches in priority order; downgrade to Level 1 once the budget is
	// exceeded. Per-skill budget stored in skill.maxTokenBudget takes precedence
	// over the rough char-based estimate when available.
	let totalTokens = 0;
	for (const m of matched) {
		const skillTokens = estimateTokens(m.skill.contentMd, m.skill.maxTokenBudget);
		if (m.level === 2) {
			if (totalTokens + skillTokens > maxTokenBudget) {
				m.level = 1; // Downgrade — metadata only, no token cost
			} else {
				totalTokens += skillTokens;
			}
		}
	}

	const promptSection = buildSkillPromptSection(matched);

	log.info(
		{
			taskId: task.id,
			agentId,
			agentRole,
			skillCount: matched.length,
			level2Count: matched.filter((m) => m.level === 2).length,
			totalTokenEstimate: totalTokens,
		},
		"[skill-resolver] Skills resolved for task",
	);

	return { skills: matched, promptSection, totalTokenEstimate: totalTokens };
}

// ---------------------------------------------------------------------------
// Prompt section builder
// ---------------------------------------------------------------------------

function buildSkillPromptSection(skills: ResolvedSkill[]): string {
	if (skills.length === 0) return "";

	const parts: string[] = [];

	// Level 1 — awareness block (metadata only, grouped at top)
	const level1 = skills.filter((s) => s.level === 1);
	if (level1.length > 0) {
		parts.push("## Available Skills (reference only — full content omitted for token efficiency)");
		for (const { skill } of level1) {
			parts.push(`- **${skill.name}**: ${skill.description}`);
		}
	}

	// Level 2 — full body, one section per skill
	const level2 = skills.filter((s) => s.level === 2);
	for (const { skill } of level2) {
		parts.push(`\n## SKILL: ${skill.name}`);
		if (skill.description) {
			parts.push(`_${skill.description}_\n`);
		}
		parts.push(skill.contentMd);
	}

	return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Estimate token cost for a skill's content.
 * Uses the skill's own `maxTokenBudget` as an upper bound when set (non-zero);
 * falls back to the standard 1-token-per-4-chars heuristic.
 */
function estimateTokens(contentMd: string, maxTokenBudget: number): number {
	const charBased = Math.ceil(contentMd.length / 4);
	// maxTokenBudget on the skill is a ceiling the skill author declared;
	// use it as a reference when the char estimate would exceed it.
	return maxTokenBudget > 0 ? Math.min(charBased, maxTokenBudget) : charBased;
}
