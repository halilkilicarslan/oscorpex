// ---------------------------------------------------------------------------
// Oscorpex — Agent Resolver
// Resolves the agent to use for a task (role/ID lookup), the allowed tools
// for that agent, and the optimal model to route the task to.
//
// Extracted from task-executor.ts — pure extraction, no behaviour changes.
// ---------------------------------------------------------------------------

import { resolveAllowedTools } from "../capability-resolver.js";
import { createLogger } from "../logger.js";
import { resolveModel, type ResolvedModel } from "../model-router.js";
import { resolveAgent } from "../review-dispatcher.js";
import type { AgentCliTool, AgentConfig, Task } from "../types.js";

const log = createLogger("agent-resolver");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentResolution {
	/** Resolved agent configuration, or undefined if no agent matched. */
	agent: AgentConfig | undefined;
}

export interface ToolResolution {
	/** List of allowed CLI tool names for the resolved agent. */
	allowedTools: string[];
}

export interface ModelResolution {
	/** Routed model identifier (e.g. "claude-3-5-sonnet"). */
	routedModel: string;
	/** Full resolution result from model-router. */
	resolved: ResolvedModel;
}

// ---------------------------------------------------------------------------
// resolveTaskAgent
// ---------------------------------------------------------------------------

/**
 * Looks up the agent responsible for executing a task.
 *
 * Tries assignment by agent ID first, then by role name (canonicalized).
 * Returns undefined when no match is found so the caller can handle the
 * missing-agent case (fail the task and dispatch ready tasks).
 */
export async function resolveTaskAgent(
	projectId: string,
	assignment: string,
): Promise<AgentConfig | undefined> {
	return resolveAgent(projectId, assignment);
}

// ---------------------------------------------------------------------------
// resolveTaskTools
// ---------------------------------------------------------------------------

/**
 * Returns the list of allowed CLI tools for the given agent in the given
 * project, derived from capability records and role-based defaults.
 */
export async function resolveTaskTools(
	projectId: string,
	agentId: string,
	agentRole: string,
): Promise<string[]> {
	return resolveAllowedTools(projectId, agentId, agentRole);
}

// ---------------------------------------------------------------------------
// resolveTaskModel
// ---------------------------------------------------------------------------

/**
 * Selects the optimal model for a task using the cost-aware model router.
 *
 * Falls back to the agent's configured model (or "sonnet") on routing errors
 * so that task execution is never blocked by a routing failure.
 */
export async function resolveTaskModel(
	task: Task,
	context: {
		projectId: string;
		primaryCliTool: AgentCliTool;
		agentModel: string | undefined;
	},
): Promise<ModelResolution> {
	const fallbackModel = context.agentModel ?? "sonnet";

	try {
		const resolved = await resolveModel(task, {
			projectId: context.projectId,
			priorFailures: task.retryCount ?? 0,
			reviewRejections: task.revisionCount ?? 0,
			cliTool: context.primaryCliTool,
		});
		return { routedModel: resolved.model, resolved };
	} catch (err) {
		log.warn("[agent-resolver] resolveModel failed, using fallback:" + " " + String(err));
		return {
			routedModel: fallbackModel,
			resolved: {
				provider: "anthropic",
				model: fallbackModel,
				effort: "medium",
				decisionReason: "fallback — resolveModel threw",
			},
		};
	}
}
