// ---------------------------------------------------------------------------
// Oscorpex — Agent Chat (v3.8)
// Conversational interface for interacting with individual project agents
// ---------------------------------------------------------------------------

import { generateText } from "ai";
import { getAIModelWithFallback } from "./ai-provider-factory.js";
import { getProject, getProjectAgent, insertChatMessage } from "./db.js";
import { createLogger } from "./logger.js";
import type { ProjectAgent } from "./types.js";
const log = createLogger("agent-chat");

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Builds a system prompt for a direct agent chat session.
 * Combines the agent's configured system prompt with project context.
 */
export function buildAgentChatPrompt(agent: ProjectAgent, projectSummary: string, userMessage: string): string {
	return [
		`You are ${agent.name}, a ${agent.role} on this software project.`,
		"",
		"## Your Character",
		agent.personality || "Professional, helpful, and focused on delivering quality work.",
		"",
		"## Project Context",
		projectSummary,
		"",
		"## Your System Instructions",
		agent.systemPrompt || "Help with tasks related to your role.",
		"",
		"## User Message",
		userMessage,
		"",
		"Respond as yourself, staying in character. Be concise and practical.",
	].join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sends a message to a project agent and returns a response.
 *
 * For now, returns a placeholder response — the actual AI call integration
 * will be connected once the provider routing layer (v3.4) is complete.
 *
 * Both the user message and the agent response are persisted to chat_messages.
 */
export async function chatWithAgent(projectId: string, agentId: string, message: string): Promise<string> {
	const [agent, project] = await Promise.all([getProjectAgent(agentId), getProject(projectId)]);

	if (!agent) {
		throw new Error(`Agent ${agentId} not found`);
	}
	if (!project) {
		throw new Error(`Project ${projectId} not found`);
	}
	if (agent.projectId !== projectId) {
		throw new Error(`Agent ${agentId} does not belong to project ${projectId}`);
	}

	const projectSummary = [
		`Project: ${project.name}`,
		`Description: ${project.description}`,
		`Status: ${project.status}`,
		`Tech Stack: ${(project.techStack ?? []).join(", ") || "N/A"}`,
	].join("\n");

	const prompt = buildAgentChatPrompt(agent, projectSummary, message);

	// Persist user message
	await insertChatMessage({
		projectId,
		role: "user",
		content: message,
		agentId,
	});

	let response: string;
	try {
		response = await getAIModelWithFallback(async (model, info) => {
			const result = await generateText({
				model,
				prompt,
				maxOutputTokens: 600,
			});
			log.info(`[agent-chat] AI reply via ${info.modelName} (${info.providerType}) — ${result.text.length} chars`);
			return result.text.trim();
		});
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		log.warn(`[agent-chat] AI call failed, falling back to placeholder: ${errMsg}`);
		response = buildPlaceholderResponse(agent, message);
	}

	// Persist agent response (no name prefix — UI shows agent identity via avatar)
	await insertChatMessage({
		projectId,
		role: "assistant",
		content: response,
		agentId,
	});

	log.info(`[agent-chat] Chat with ${agent.name} (${agentId}) — message length: ${message.length}`);

	return response;
}

// ---------------------------------------------------------------------------
// Placeholder response (until AI call integration is complete)
// ---------------------------------------------------------------------------

function buildPlaceholderResponse(agent: ProjectAgent, userMessage: string): string {
	const lowerMsg = userMessage.toLowerCase();

	if (lowerMsg.includes("status") || lowerMsg.includes("progress")) {
		return `As ${agent.name} (${agent.role}), I'm currently tracking the project status. I'll provide a detailed update once I review the latest task states.`;
	}
	if (lowerMsg.includes("help") || lowerMsg.includes("assist")) {
		return `I'm ${agent.name} and I specialize in ${agent.role}. Happy to help — could you be more specific about what you need?`;
	}
	if (lowerMsg.includes("review") || lowerMsg.includes("feedback")) {
		return `I'll review this carefully from a ${agent.role} perspective and get back to you with detailed feedback.`;
	}

	return `Acknowledged. As ${agent.name} (${agent.role}), I'll look into this: "${userMessage.slice(0, 80)}${userMessage.length > 80 ? "..." : ""}". AI response integration coming soon.`;
}
