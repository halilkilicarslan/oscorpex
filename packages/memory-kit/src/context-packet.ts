// @oscorpex/memory-kit — Context packet builder utilities
// Pure functions for token estimation, section budgeting, and context assembly.
// No DB or event-bus dependencies — those remain in the kernel layer.

import type { ContextPacketMode } from "@oscorpex/core";

// Re-export canonical types from @oscorpex/core
export type { ContextPacketMode, ContextPacket, ContextPacketOptions, ProjectContextSnapshot, MemoryFact } from "@oscorpex/core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CHARS_PER_TOKEN = 4;

export const DEFAULT_MAX_TOKENS = 40_000;

export const SECTION_BUDGETS = {
	projectDescription: 2_000,
	techStack: 500,
	fileSummary: 3_000,
	planSummary: 6_000,
	agentProfile: 1_000,
	taskDescription: 5_000,
	targetFiles: 4_000,
	completedTasks: 4_000,
	teamComposition: 3_000,
	dependencyGraph: 3_000,
} as const;

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/** Rough token estimate: chars / 4. */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Truncate text to fit within a token budget.
 * Appends "[truncated]" marker when clipped.
 */
export function capSection(text: string, maxTokens: number): string {
	const maxChars = maxTokens * CHARS_PER_TOKEN;
	if (text.length <= maxChars) return text;
	const marker = "\n…[truncated]";
	return text.slice(0, maxChars - marker.length) + marker;
}

// ---------------------------------------------------------------------------
// Section builder
// ---------------------------------------------------------------------------

export interface SectionResult {
	text: string;
	tokens: number;
}

/**
 * Build a context section with a markdown header, body, and token budget.
 * Returns the formatted section text and its estimated token count.
 */
export function buildSection(header: string, body: string, maxTokens: number): SectionResult {
	const capped = capSection(body, maxTokens);
	const text = `## ${header}\n\n${capped}`;
	return { text, tokens: estimateTokens(text) };
}

// ---------------------------------------------------------------------------
// One-line summarizers
// ---------------------------------------------------------------------------

/** One-line agent summary: name, role, top-3 skills. */
export function summarizeAgent(agent: { name: string; role: string; skills: string[] }): string {
	const skills = agent.skills.slice(0, 3).join(", ");
	return `${agent.name} (${agent.role})${skills ? ` — ${skills}` : ""}`;
}

/** One-line task summary: title, status, assigned agent. */
export function summarizeTask(task: { title: string; status: string; assignedAgent?: string }): string {
	return `[${task.status}] ${task.title} → ${task.assignedAgent ?? "unassigned"}`;
}

// ---------------------------------------------------------------------------
// Context packet assembler (pure — takes pre-fetched data, returns prompt)
// ---------------------------------------------------------------------------

export interface ContextData {
	project?: { name: string; description: string; techStack: string[] };
	agents?: Array<{ name: string; role: string; skills: string[]; reportsTo?: string; id: string }>;
	tasks?: Array<{
		id: string;
		title: string;
		status: string;
		assignedAgent?: string;
		complexity: string;
		description: string;
		targetFiles?: string[];
		output?: { filesCreated: string[]; filesModified: string[] };
	}>;
	plan?: { version: number; status: string; phases: Array<{ order: number; name: string; status: string; tasks: Array<{ title: string; status: string; assignedAgent: string }> }> };
	ftsResults?: Array<{ title: string; content: string; source: string }>;
}

/**
 * Assemble a planner-mode context packet from pre-fetched data.
 * Pure function — no side effects.
 */
export function assemblePlannerPrompt(data: ContextData, maxTokens: number = DEFAULT_MAX_TOKENS): { sections: Record<string, number>; prompt: string } {
	const sections: Record<string, number> = {};
	const parts: string[] = [];

	const systemSection = buildSection(
		"System",
		"You are a senior technical planner. Your job is to analyze the project and produce a detailed, phased implementation plan.",
		500,
	);
	parts.push(systemSection.text);
	sections["system"] = systemSection.tokens;

	if (data.project) {
		const descSection = buildSection(
			"Project",
			`**Name:** ${data.project.name}\n\n${data.project.description}`,
			SECTION_BUDGETS.projectDescription,
		);
		parts.push(descSection.text);
		sections["project"] = descSection.tokens;

		if (data.project.techStack.length > 0) {
			const techSection = buildSection("Tech Stack", data.project.techStack.join(", "), SECTION_BUDGETS.techStack);
			parts.push(techSection.text);
			sections["techStack"] = techSection.tokens;
		}
	}

	if (data.plan) {
		const planSummary = data.plan.phases
			.map((ph) =>
				`### Phase ${ph.order}: ${ph.name} [${ph.status}]\n` +
				(ph.tasks.length > 0 ? ph.tasks.map((t) => `  - ${summarizeTask(t)}`).join("\n") : "  (no tasks yet)"),
			)
			.join("\n\n");
		const planSection = buildSection(
			"Existing Plan",
			`Plan v${data.plan.version} (${data.plan.status})\n\n${planSummary}`,
			SECTION_BUDGETS.planSummary,
		);
		parts.push(planSection.text);
		sections["existingPlan"] = planSection.tokens;
	}

	return { sections, prompt: parts.join("\n\n---\n\n") };
}

/**
 * Assemble a team-architect-mode context packet from pre-fetched data.
 * Pure function — no side effects.
 */
export function assembleTeamArchitectPrompt(data: ContextData, maxTokens: number = DEFAULT_MAX_TOKENS): { sections: Record<string, number>; prompt: string } {
	const sections: Record<string, number> = {};
	const parts: string[] = [];

	const systemSection = buildSection(
		"System",
		"You are a team architect. Design an optimal agent team structure and dependency graph for the project.",
		400,
	);
	parts.push(systemSection.text);
	sections["system"] = systemSection.tokens;

	if (data.project) {
		const descSection = buildSection(
			"Project",
			`**Name:** ${data.project.name}\n\n${data.project.description}`,
			SECTION_BUDGETS.projectDescription,
		);
		parts.push(descSection.text);
		sections["project"] = descSection.tokens;
	}

	if (data.agents && data.agents.length > 0) {
		const teamBody = data.agents.map((a) => `- ${summarizeAgent(a)}`).join("\n");
		const teamSection = buildSection("Team Composition", teamBody, SECTION_BUDGETS.teamComposition);
		parts.push(teamSection.text);
		sections["teamComposition"] = teamSection.tokens;

		const deps = data.agents
			.filter((a) => a.reportsTo)
			.map((a) => {
				const parent = data.agents!.find((p) => p.id === a.reportsTo);
				return `- ${a.name} → reports to → ${parent?.name ?? a.reportsTo!}`;
			});
		if (deps.length > 0) {
			const depSection = buildSection("Dependency Graph", deps.join("\n"), SECTION_BUDGETS.dependencyGraph);
			parts.push(depSection.text);
			sections["dependencyGraph"] = depSection.tokens;
		}
	}

	return { sections, prompt: parts.join("\n\n---\n\n") };
}