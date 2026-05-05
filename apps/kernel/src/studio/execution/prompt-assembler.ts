// ---------------------------------------------------------------------------
// Oscorpex — Prompt Assembler
// Assembles the full execution prompt for a task by combining the base task
// prompt with RAG context, resume snapshot, policy section, agent-runtime
// session data (behavioral + strategy + protocol prompts), and goal injection.
//
// Extracted from task-executor.ts — pure extraction, no behaviour changes.
// ---------------------------------------------------------------------------

import { acknowledgeMessages, initSession, loadProtocolContext } from "../agent-runtime/index.js";
import { updateTask } from "../db.js";
import { eventBus } from "../event-bus.js";
import { formatGoalPrompt, getGoalForTask } from "../goal-engine.js";
import { createLogger } from "../logger.js";
import { buildTaskPrompt } from "../prompt-builder.js";
import { resolveSkillsForTask } from "../skill-resolver.js";
import type { AgentConfig, Project, Task } from "../types.js";

const log = createLogger("prompt-assembler");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptAssemblyResult {
	/** Fully assembled prompt string ready to pass to the provider. */
	prompt: string;
	/** Session ID created by initSession, if successful. */
	sessionId: string | undefined;
	/** Goal ID associated with this task, if any. */
	goalId: string | undefined;
	/**
	 * When true, the caller must return immediately — the task has been set to
	 * "blocked" because unresolved inter-agent protocol messages exist.
	 */
	blocked: boolean;
}

// ---------------------------------------------------------------------------
// assemblePrompt
// ---------------------------------------------------------------------------

/**
 * Builds the complete execution prompt for a task.
 *
 * Steps:
 *  1. Build base task prompt via buildTaskPrompt.
 *  2. Init agent-runtime session → append behavioral + strategy prompts.
 *  3. Load inter-agent protocol context → append or block if blockers exist.
 *  4. Look up associated goal → append goal prompt.
 *
 * Returns the assembled prompt, the sessionId, the goalId, and a `blocked`
 * flag. When `blocked` is true the caller must bail out without executing.
 */
export async function assemblePrompt(
	projectId: string,
	task: Task,
	project: Project,
	agent: AgentConfig,
): Promise<PromptAssemblyResult> {
	let sessionId: string | undefined;
	let goalId: string | undefined;
	let promptSuffix = "";

	// --- Agent Runtime: init session + behavioral memory + protocol ---
	try {
		const sessionCtx = await initSession(projectId, agent.id, agent.role, task);
		sessionId = sessionCtx.session.id;

		// Token optimization: cap behavioral context to prevent prompt bloat
		let behavioralSection = sessionCtx.behavioralPrompt;
		if (behavioralSection.length > 2000) {
			behavioralSection = `${behavioralSection.slice(0, 2000)}\n[...behavioral context truncated for token efficiency]`;
		}
		promptSuffix += behavioralSection;

		// Strategy prompt addendum
		if (sessionCtx.strategySelection.strategy.promptAddendum) {
			promptSuffix += `\n\n## EXECUTION STRATEGY: ${sessionCtx.strategySelection.strategy.name}\n${sessionCtx.strategySelection.strategy.promptAddendum}\n`;
		}

		// Load inter-agent protocol messages
		const protocolCtx = await loadProtocolContext(projectId, agent.id);
		if (protocolCtx.hasBlockers) {
			await updateTask(task.id, { status: "blocked" });
			eventBus.emit({
				projectId,
				type: "agent:requested_help",
				agentId: agent.id,
				taskId: task.id,
				payload: {
					title: task.title,
					taskTitle: task.title,
					agentName: agent.name,
					reason: "Execution blocked by unresolved inter-agent protocol messages",
					protocolBlocked: true,
				},
			});
			return { prompt: "", sessionId, goalId: undefined, blocked: true };
		}
		if (protocolCtx.prompt) {
			// Token optimization: cap cross-agent context
			let crossAgentSection = protocolCtx.prompt;
			if (crossAgentSection.length > 1500) {
				crossAgentSection = `${crossAgentSection.slice(0, 1500)}\n[...cross-agent context truncated]`;
			}
			promptSuffix += crossAgentSection;
			await acknowledgeMessages(protocolCtx.messageIds);
		}
	} catch (err) {
		log.warn(`[prompt-assembler] Agent runtime init failed (non-blocking): ${String(err)}`);
	}

	// --- Skill injection: resolve and inject relevant skills for this task + agent ---
	try {
		const skillResult = await resolveSkillsForTask(
			task,
			agent.id,
			agent.role,
			projectId,
			10_000, // max skill token budget
		);
		if (skillResult.promptSection) {
			promptSuffix += `\n\n${skillResult.promptSection}`;
		}
	} catch (err) {
		log.warn({ err }, "[prompt-assembler] Skill resolution failed (non-blocking)");
	}

	// --- Goal-based execution: inject goal prompt if task has an associated goal ---
	try {
		const goal = await getGoalForTask(task.id);
		if (goal && goal.status !== "achieved") {
			promptSuffix += `\n${formatGoalPrompt(goal)}`;
			goalId = goal.id;
		}
	} catch (err) {
		log.warn(`[prompt-assembler] Goal lookup failed (non-blocking): ${String(err)}`);
	}

	const prompt = (await buildTaskPrompt(task, project, agent.role)) + promptSuffix;

	log.info(
		{
			taskId: task.id,
			promptLength: prompt.length,
			estimatedTokens: Math.ceil(prompt.length / 4),
		},
		"[prompt-assembler] Prompt assembled",
	);

	return { prompt, sessionId, goalId, blocked: false };
}
