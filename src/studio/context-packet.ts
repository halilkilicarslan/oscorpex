// ---------------------------------------------------------------------------
// Oscorpex — Context Packet Builder (v3.4)
// Assembles optimized, mode-specific context packets for AI prompts.
// Replaces ad-hoc prompt assembly scattered across execution-engine.ts.
// ---------------------------------------------------------------------------

import {
	getLatestPlan,
	getProject,
	listPhases,
	listProjectAgents,
	listProjectTasks,
} from "./db.js";
import { searchContext } from "./context-store.js";
import { eventBus } from "./event-bus.js";
import type { ContextPacketOptions, ProjectAgent, Task } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHARS_PER_TOKEN = 4;

const DEFAULT_MAX_TOKENS = 40_000;

// Per-section token budgets (applied when assembling each mode)
const SECTION_BUDGETS = {
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
// Public helpers
// ---------------------------------------------------------------------------

/** One-line agent summary: name, role, top-3 skills. */
export function summarizeAgent(agent: ProjectAgent): string {
	const skills = agent.skills.slice(0, 3).join(", ");
	return `${agent.name} (${agent.role})${skills ? ` — ${skills}` : ""}`;
}

/** One-line task summary: title, status, assigned agent. */
export function summarizeTask(task: Task): string {
	return `[${task.status}] ${task.title} → ${task.assignedAgent}`;
}

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
// Internal section builders
// ---------------------------------------------------------------------------

function buildSection(header: string, body: string, maxTokens: number): { text: string; tokens: number } {
	const capped = capSection(body, maxTokens);
	const text = `## ${header}\n\n${capped}`;
	return { text, tokens: estimateTokens(text) };
}

// ---------------------------------------------------------------------------
// Mode assemblers
// ---------------------------------------------------------------------------

async function assemblePlannerContext(
	projectId: string,
	maxTokens: number,
): Promise<{ sections: Record<string, number>; prompt: string }> {
	const sections: Record<string, number> = {};
	const parts: string[] = [];

	const project = await getProject(projectId);
	if (!project) throw new Error(`Project not found: ${projectId}`);

	// System intro
	const systemSection = buildSection(
		"System",
		"You are a senior technical planner. Your job is to analyze the project and produce a detailed, phased implementation plan.",
		500,
	);
	parts.push(systemSection.text);
	sections["system"] = systemSection.tokens;

	// Project description
	const descSection = buildSection(
		"Project",
		`**Name:** ${project.name}\n\n${project.description}`,
		SECTION_BUDGETS.projectDescription,
	);
	parts.push(descSection.text);
	sections["project"] = descSection.tokens;

	// Tech stack
	if (project.techStack.length > 0) {
		const techSection = buildSection(
			"Tech Stack",
			project.techStack.join(", "),
			SECTION_BUDGETS.techStack,
		);
		parts.push(techSection.text);
		sections["techStack"] = techSection.tokens;
	}

	// Existing plan (if any)
	const plan = await getLatestPlan(projectId);
	if (plan) {
		const phases = await listPhases(plan.id);
		const planSummary = phases
			.map(
				(ph) =>
					`### Phase ${ph.order}: ${ph.name} [${ph.status}]\n` +
					(ph.tasks.length > 0
						? ph.tasks.map((t) => `  - ${summarizeTask(t)}`).join("\n")
						: "  (no tasks yet)"),
			)
			.join("\n\n");
		const planSection = buildSection(
			"Existing Plan",
			`Plan v${plan.version} (${plan.status})\n\n${planSummary}`,
			SECTION_BUDGETS.planSummary,
		);
		parts.push(planSection.text);
		sections["existingPlan"] = planSection.tokens;
	}

	return { sections, prompt: parts.join("\n\n---\n\n") };
}

async function assembleExecutionContext(
	projectId: string,
	taskId: string,
	agentId: string | undefined,
	maxTokens: number,
): Promise<{ sections: Record<string, number>; prompt: string }> {
	const sections: Record<string, number> = {};
	const parts: string[] = [];

	const project = await getProject(projectId);
	if (!project) throw new Error(`Project not found: ${projectId}`);

	// System intro
	const systemSection = buildSection(
		"System",
		"You are an expert software engineer. Implement the task described below with precision. Follow project conventions and produce clean, tested code.",
		500,
	);
	parts.push(systemSection.text);
	sections["system"] = systemSection.tokens;

	// Agent profile (if agentId provided)
	if (agentId) {
		const agents = await listProjectAgents(projectId);
		const agent = agents.find((a) => a.id === agentId);
		if (agent) {
			const profileLines = [
				`**Name:** ${agent.name}`,
				`**Role:** ${agent.role}`,
				`**Skills:** ${agent.skills.join(", ") || "general"}`,
				agent.personality ? `**Personality:** ${agent.personality}` : "",
			]
				.filter(Boolean)
				.join("\n");
			const profileSection = buildSection("Agent Profile", profileLines, SECTION_BUDGETS.agentProfile);
			parts.push(profileSection.text);
			sections["agentProfile"] = profileSection.tokens;
		}
	}

	// Task details — fetch from task list
	const allTasks = await listProjectTasks(projectId);
	const task = allTasks.find((t) => t.id === taskId);
	if (!task) throw new Error(`Task not found: ${taskId}`);

	const taskLines = [
		`**Title:** ${task.title}`,
		`**Complexity:** ${task.complexity}`,
		`**Status:** ${task.status}`,
		"",
		"**Description:**",
		task.description,
	];
	const taskSection = buildSection("Task", taskLines.join("\n"), SECTION_BUDGETS.taskDescription);
	parts.push(taskSection.text);
	sections["task"] = taskSection.tokens;

	// Target files
	if (task.targetFiles && task.targetFiles.length > 0) {
		const filesSection = buildSection(
			"Target Files",
			task.targetFiles.map((f) => `- \`${f}\``).join("\n"),
			SECTION_BUDGETS.targetFiles,
		);
		parts.push(filesSection.text);
		sections["targetFiles"] = filesSection.tokens;
	}

	// Completed task context — FTS search augmented with task summaries
	const completed = allTasks
		.filter((t) => t.id !== taskId && t.status === "done")
		.slice(-10);

	// Try FTS search for relevant completed task context
	let ftsCompletedBody = "";
	try {
		const descSnippet = (task.description ?? "").slice(0, 200);
		const ftsResults = await searchContext({
			projectId,
			queries: [task.title, descSnippet].filter(Boolean),
			limit: 5,
			maxTokens: Math.floor(SECTION_BUDGETS.completedTasks * 0.7),
		});
		if (ftsResults.length > 0) {
			const ftsLines: string[] = [];
			for (const r of ftsResults) {
				ftsLines.push(`**${r.title}** (${r.source})`);
				ftsLines.push(r.content);
				ftsLines.push("");
			}
			ftsCompletedBody = ftsLines.join("\n");
		}
	} catch {
		// FTS unavailable — fall through to simple summaries
	}

	if (ftsCompletedBody || completed.length > 0) {
		const bodyParts: string[] = [];
		if (ftsCompletedBody) {
			bodyParts.push("### Relevant Context (FTS)", "", ftsCompletedBody);
		}
		if (completed.length > 0) {
			bodyParts.push("### Task Summaries", "", completed.map((t) => `- ${summarizeTask(t)}`).join("\n"));
		}
		const completedSection = buildSection(
			"Recently Completed Tasks",
			bodyParts.join("\n"),
			SECTION_BUDGETS.completedTasks,
		);
		parts.push(completedSection.text);
		sections["completedTasks"] = completedSection.tokens;
	}

	// Acceptance criteria — extracted from description if present
	const criteriaMatch = task.description.match(/acceptance criteria[:\s]+([\s\S]+?)(?:\n##|\n---|\n\n\n|$)/i);
	if (criteriaMatch) {
		const criteriaSection = buildSection(
			"Acceptance Criteria",
			criteriaMatch[1].trim(),
			2_000,
		);
		parts.push(criteriaSection.text);
		sections["acceptanceCriteria"] = criteriaSection.tokens;
	}

	return { sections, prompt: parts.join("\n\n---\n\n") };
}

async function assembleReviewContext(
	projectId: string,
	taskId: string,
	maxTokens: number,
): Promise<{ sections: Record<string, number>; prompt: string }> {
	const sections: Record<string, number> = {};
	const parts: string[] = [];

	// System intro (minimal for review — keep token budget for code)
	const systemSection = buildSection(
		"System",
		"You are a senior code reviewer. Review the changes against the acceptance criteria and task description. Be concise and objective.",
		400,
	);
	parts.push(systemSection.text);
	sections["system"] = systemSection.tokens;

	// Task description (minimal)
	const allTasks = await listProjectTasks(projectId);
	const task = allTasks.find((t) => t.id === taskId);
	if (!task) throw new Error(`Task not found: ${taskId}`);

	const taskSection = buildSection(
		"Original Task",
		`**${task.title}**\n\n${task.description}`,
		SECTION_BUDGETS.taskDescription,
	);
	parts.push(taskSection.text);
	sections["originalTask"] = taskSection.tokens;

	// Acceptance criteria
	const criteriaMatch = task.description.match(/acceptance criteria[:\s]+([\s\S]+?)(?:\n##|\n---|\n\n\n|$)/i);
	if (criteriaMatch) {
		const criteriaSection = buildSection(
			"Acceptance Criteria",
			criteriaMatch[1].trim(),
			2_000,
		);
		parts.push(criteriaSection.text);
		sections["acceptanceCriteria"] = criteriaSection.tokens;
	}

	// Changed files from task output
	if (task.output) {
		const changedFiles = [
			...task.output.filesCreated.map((f) => `+ ${f} (created)`),
			...task.output.filesModified.map((f) => `~ ${f} (modified)`),
		];
		if (changedFiles.length > 0) {
			const changedSection = buildSection(
				"Changed Files",
				changedFiles.join("\n"),
				2_000,
			);
			parts.push(changedSection.text);
			sections["changedFiles"] = changedSection.tokens;
		}
	}

	return { sections, prompt: parts.join("\n\n---\n\n") };
}

async function assembleTeamArchitectContext(
	projectId: string,
	maxTokens: number,
): Promise<{ sections: Record<string, number>; prompt: string }> {
	const sections: Record<string, number> = {};
	const parts: string[] = [];

	const project = await getProject(projectId);
	if (!project) throw new Error(`Project not found: ${projectId}`);

	// System intro
	const systemSection = buildSection(
		"System",
		"You are a team architect. Design an optimal agent team structure and dependency graph for the project.",
		400,
	);
	parts.push(systemSection.text);
	sections["system"] = systemSection.tokens;

	// Project description
	const descSection = buildSection(
		"Project",
		`**Name:** ${project.name}\n\n${project.description}`,
		SECTION_BUDGETS.projectDescription,
	);
	parts.push(descSection.text);
	sections["project"] = descSection.tokens;

	// Team composition
	const agents = await listProjectAgents(projectId);
	if (agents.length > 0) {
		const teamBody = agents.map((a) => `- ${summarizeAgent(a)}`).join("\n");
		const teamSection = buildSection(
			"Team Composition",
			teamBody,
			SECTION_BUDGETS.teamComposition,
		);
		parts.push(teamSection.text);
		sections["teamComposition"] = teamSection.tokens;
	}

	// Dependency graph (reportsTo relationships)
	const deps = agents
		.filter((a) => a.reportsTo)
		.map((a) => {
			const parent = agents.find((p) => p.id === a.reportsTo);
			return `- ${a.name} → reports to → ${parent?.name ?? a.reportsTo}`;
		});
	if (deps.length > 0) {
		const depSection = buildSection(
			"Dependency Graph",
			deps.join("\n"),
			SECTION_BUDGETS.dependencyGraph,
		);
		parts.push(depSection.text);
		sections["dependencyGraph"] = depSection.tokens;
	}

	return { sections, prompt: parts.join("\n\n---\n\n") };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Assembles an optimized context packet for an AI prompt based on the given mode.
 * Emits a `prompt:size` event with block-level token breakdown via eventBus.
 */
export async function buildContextPacket(options: ContextPacketOptions): Promise<string> {
	const { projectId, taskId, agentId, mode, maxTokens = DEFAULT_MAX_TOKENS } = options;

	let result: { sections: Record<string, number>; prompt: string };

	switch (mode) {
		case "planner":
			result = await assemblePlannerContext(projectId, maxTokens);
			break;
		case "execution":
			if (!taskId) throw new Error("taskId is required for execution mode");
			result = await assembleExecutionContext(projectId, taskId, agentId, maxTokens);
			break;
		case "review":
			if (!taskId) throw new Error("taskId is required for review mode");
			result = await assembleReviewContext(projectId, taskId, maxTokens);
			break;
		case "team_architect":
			result = await assembleTeamArchitectContext(projectId, maxTokens);
			break;
		default: {
			const _exhaustive: never = mode;
			throw new Error(`Unknown context packet mode: ${_exhaustive}`);
		}
	}

	const totalTokens = estimateTokens(result.prompt);

	// Emit telemetry with per-section breakdown
	eventBus.emitTransient({
		projectId,
		type: "prompt:size",
		agentId,
		taskId,
		payload: {
			mode,
			totalTokens,
			totalChars: result.prompt.length,
			sections: result.sections,
			maxTokens,
			overBudget: totalTokens > maxTokens,
		},
	});

	return result.prompt;
}
