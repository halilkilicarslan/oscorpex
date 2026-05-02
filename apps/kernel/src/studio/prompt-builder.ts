// ---------------------------------------------------------------------------
// Oscorpex — Prompt Builder
// Constructs execution prompts for AI agents. Includes project context,
// RAG retrieval, resume snapshots, error context, and policy sections.
// Extracted from execution-engine.ts for single-responsibility.
// ---------------------------------------------------------------------------

import { composeSystemPrompt } from "./behavioral-prompt.js";
import { buildPolicyPromptSection, getDefaultPolicy } from "./command-policy.js";
import { buildRAGContext, formatRAGContext } from "./context-builder.js";
import { compactCrossAgentContext } from "./context-sandbox.js";
import { buildResumeSnapshot, formatResumeSnapshot } from "./context-session.js";
import { createLogger } from "./logger.js";
import { PROMPT_LIMITS, capText, enforcePromptBudget } from "./prompt-budget.js";
import type { Project, Task } from "./types.js";
const log = createLogger("prompt-builder");

// ---------------------------------------------------------------------------
// Task execution prompt
// ---------------------------------------------------------------------------

export async function buildTaskPrompt(task: Task, project: Project, agentRole?: string): Promise<string> {
	const techStack = project.techStack.length > 0 ? project.techStack.join(", ") : "Not specified";
	const safeDescription = capText(task.description ?? "", PROMPT_LIMITS.taskDescription);

	const lines: string[] = [
		`# Task: ${task.title}`,
		"",
		`## Project`,
		`- Name: ${project.name}`,
		`- Tech Stack: ${techStack}`,
		`- Description: ${project.description || "No description provided"}`,
		"",
	];

	// FTS-backed compact cross-agent context
	try {
		const compact = await compactCrossAgentContext({
			projectId: project.id,
			taskTitle: task.title,
			taskDescription: safeDescription,
			maxTokens: 3000,
			maxFiles: 10,
		});
		if (compact.prompt) {
			lines.push(compact.prompt, "");
		}
	} catch (err) {
		log.warn("[prompt-builder] compactCrossAgentContext failed (non-blocking):" + " " + String(err));
	}

	// RAG Context
	try {
		const ragContext = await buildRAGContext(project.id, task.title, safeDescription);
		if (ragContext && ragContext.relevantChunks.length > 0) {
			lines.push(formatRAGContext(ragContext));
		}
	} catch (err) {
		log.warn("[prompt-builder] RAG context fetch failed (non-blocking):" + " " + String(err));
	}

	// Resume snapshot for retried/revised tasks
	if (task.retryCount > 0 || task.revisionCount > 0) {
		try {
			const sessionKey = `${project.id}:${task.id}`;
			const snapshot = await buildResumeSnapshot(sessionKey);
			if (snapshot.eventCount > 0) {
				lines.push(formatResumeSnapshot(snapshot), "");
			}
		} catch (err) {
			log.warn("[prompt-builder] Resume snapshot failed (non-blocking):" + " " + String(err));
		}
	}

	// Self-healing: inject previous error
	if (task.error) {
		lines.push(
			`## Previous Attempt Failed`,
			"",
			"This task was attempted before but failed with the following error. Please fix the issue and try again:",
			"",
			"```",
			task.error.slice(0, 1000),
			"```",
			"",
			"Common fixes: check import paths, install missing dependencies, fix syntax errors, ensure files exist before reading.",
			"",
		);
	}

	lines.push(
		`## Task Details`,
		`- ID: ${task.id}`,
		`- Complexity: ${task.complexity}`,
		`- Branch: ${task.branch || "main"}`,
		`- Retry: ${task.retryCount > 0 ? `#${task.retryCount}` : "first attempt"}`,
		"",
		`## Instructions`,
		safeDescription,
		"",
		`## Available Tools`,
		"You have the following tools to complete this task:",
		"- **listFiles**: List files in a directory",
		"- **readFile**: Read file contents",
		"- **writeFile**: Create or update files",
		"- **runCommand**: Run shell commands (npm/pnpm install, tests, builds, etc.)",
		"- **commitChanges**: Git commit your changes",
		"",
		`## Workflow`,
		"1. First, use listFiles to understand the current project structure",
		"2. Read any relevant existing files to understand the codebase",
		"3. Create or modify the necessary files using writeFile",
		"4. Run any relevant commands (install deps, run tests, etc.)",
		"5. Commit your changes with a descriptive message",
		"",
		`## Important`,
		"- Read existing files before modifying them to maintain consistency",
		"- Follow the same patterns and conventions used in existing code",
		"- Do not overwrite files created by other agents unless necessary for your task",
		"",
		`## Output`,
		"After completing all tool calls, provide a brief summary of what you did.",
	);

	if (agentRole) {
		const policy = getDefaultPolicy(agentRole);
		lines.push("", buildPolicyPromptSection(policy));
	}

	const { prompt } = enforcePromptBudget(lines.join("\n"), {
		projectId: project.id,
		taskId: task.id,
	});
	return prompt;
}

// ---------------------------------------------------------------------------
// Default system prompt for agents
// ---------------------------------------------------------------------------

export function defaultSystemPrompt(agent: { name: string; role: string; skills: string[] }): string {
	const rolePrompt = `You are ${agent.name}, a ${agent.role} agent in Oscorpex.
Your skills include: ${agent.skills.join(", ") || "general software development"}.
Complete the task described in the user message. Be precise and produce working code.`;
	return composeSystemPrompt(rolePrompt);
}
