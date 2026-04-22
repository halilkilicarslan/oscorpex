// ---------------------------------------------------------------------------
// Oscorpex — Context Packet Builder (v3.5)
// Assembles optimized, mode-specific context packets for AI prompts.
// Pure utilities imported from @oscorpex/memory-kit; DB & event emission stay here.
// ---------------------------------------------------------------------------

import {
	assemblePlannerPrompt,
	assembleTeamArchitectPrompt,
	buildSection,
	estimateTokens,
	SECTION_BUDGETS,
	summarizeAgent,
	summarizeTask,
} from "@oscorpex/memory-kit";
import type { ContextData } from "@oscorpex/memory-kit";
import { searchContext } from "./context-store.js";
import { getLatestPlan, getProject, listPhases, listProjectAgents, listProjectTasks } from "./db.js";
import { eventBus } from "./event-bus.js";
import type { ContextPacketOptions, ProjectAgent, Task } from "./types.js";
import { createLogger } from "./logger.js";
const log = createLogger("context-packet");

// ---------------------------------------------------------------------------
// Mode assemblers (fetch DB data, then delegate to pure functions)
// ---------------------------------------------------------------------------

async function assemblePlannerContext(
	projectId: string,
	maxTokens: number,
): Promise<{ sections: Record<string, number>; prompt: string }> {
	const project = await getProject(projectId);
	if (!project) throw new Error(`Project not found: ${projectId}`);

	const data: ContextData = {
		project: { name: project.name, description: project.description, techStack: project.techStack },
	};

	const plan = await getLatestPlan(projectId);
	if (plan) {
		const phases = await listPhases(plan.id);
		data.plan = {
			version: plan.version,
			status: plan.status,
			phases: phases.map((ph) => ({
				order: ph.order,
				name: ph.name,
				status: ph.status,
				tasks: ph.tasks.map((t) => ({
					title: t.title,
					status: t.status,
					assignedAgent: t.assignedAgent,
				})),
			})),
		};
	}

	return assemblePlannerPrompt(data, maxTokens);
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

	const systemSection = buildSection(
		"System",
		"You are an expert software engineer. Implement the task described below with precision. Follow project conventions and produce clean, tested code.",
		500,
	);
	parts.push(systemSection.text);
	sections["system"] = systemSection.tokens;

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

	if (task.targetFiles && task.targetFiles.length > 0) {
		const filesSection = buildSection(
			"Target Files",
			task.targetFiles.map((f) => `- \`${f}\``).join("\n"),
			SECTION_BUDGETS.targetFiles,
		);
		parts.push(filesSection.text);
		sections["targetFiles"] = filesSection.tokens;
	}

	const completed = allTasks.filter((t) => t.id !== taskId && t.status === "done").slice(-10);

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

	const criteriaMatch = task.description.match(/acceptance criteria[:\s]+([\s\S]+?)(?:\n##|\n---|\n\n\n|$)/i);
	if (criteriaMatch) {
		const criteriaSection = buildSection("Acceptance Criteria", criteriaMatch[1].trim(), 2_000);
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

	const systemSection = buildSection(
		"System",
		"You are a senior code reviewer. Review the changes against the acceptance criteria and task description. Be concise and objective.",
		400,
	);
	parts.push(systemSection.text);
	sections["system"] = systemSection.tokens;

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

	const criteriaMatch = task.description.match(/acceptance criteria[:\s]+([\s\S]+?)(?:\n##|\n---|\n\n\n|$)/i);
	if (criteriaMatch) {
		const criteriaSection = buildSection("Acceptance Criteria", criteriaMatch[1].trim(), 2_000);
		parts.push(criteriaSection.text);
		sections["acceptanceCriteria"] = criteriaSection.tokens;
	}

	if (task.output) {
		const changedFiles = [
			...task.output.filesCreated.map((f) => `+ ${f} (created)`),
			...task.output.filesModified.map((f) => `~ ${f} (modified)`),
		];
		if (changedFiles.length > 0) {
			const changedSection = buildSection("Changed Files", changedFiles.join("\n"), 2_000);
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
	const project = await getProject(projectId);
	if (!project) throw new Error(`Project not found: ${projectId}`);

	const agents = await listProjectAgents(projectId);

	const data: ContextData = {
		project: { name: project.name, description: project.description, techStack: project.techStack },
		agents: agents.map((a) => ({
			id: a.id,
			name: a.name,
			role: a.role,
			skills: a.skills,
			reportsTo: a.reportsTo,
		})),
	};

	return assembleTeamArchitectPrompt(data, maxTokens);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Assembles an optimized context packet for an AI prompt based on the given mode.
 * Emits a `prompt:size` event with block-level token breakdown via eventBus.
 */
export async function buildContextPacket(options: ContextPacketOptions): Promise<string> {
	const { projectId, taskId, agentId, mode, maxTokens = 40_000 } = options;

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