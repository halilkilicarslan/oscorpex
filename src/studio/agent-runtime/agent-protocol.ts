// ---------------------------------------------------------------------------
// Oscorpex — Agent Protocol: Structured inter-agent communication
// Allows agents to request info, hand off artifacts, and signal blockers.
// Protocol messages are injected into agent prompts and can block execution.
// ---------------------------------------------------------------------------

import { getUnreadMessages, markMessagesRead, sendProtocolMessage } from "../db.js";
import { eventBus } from "../event-bus.js";
import type { AgentProtocolMessage, ProtocolMessageType } from "../types.js";

// ---------------------------------------------------------------------------
// Message types that block execution until resolved
// ---------------------------------------------------------------------------

const BLOCKING_TYPES = new Set<ProtocolMessageType>(["blocker_alert", "request_info", "dependency_warning"]);

// ---------------------------------------------------------------------------
// Send protocol messages
// ---------------------------------------------------------------------------

export async function requestInfo(
	projectId: string,
	fromAgentId: string,
	toAgentId: string,
	topic: string,
	question: string,
	relatedTaskId?: string,
): Promise<AgentProtocolMessage> {
	const msg = await sendProtocolMessage({
		projectId,
		fromAgentId,
		toAgentId,
		relatedTaskId,
		messageType: "request_info",
		payload: { topic, question },
	});
	eventBus.emitTransient({
		projectId,
		type: "agent:output",
		agentId: fromAgentId,
		payload: { output: `[protocol] Info request to ${toAgentId}: ${question}` },
	});
	return msg;
}

export async function signalBlocker(
	projectId: string,
	fromAgentId: string,
	description: string,
	relatedTaskId?: string,
	toAgentId?: string,
): Promise<AgentProtocolMessage> {
	const msg = await sendProtocolMessage({
		projectId,
		fromAgentId,
		toAgentId: toAgentId ?? fromAgentId,
		relatedTaskId,
		messageType: "blocker_alert",
		payload: { description },
	});
	eventBus.emit({
		projectId,
		type: "agent:requested_help",
		agentId: fromAgentId,
		taskId: relatedTaskId,
		payload: { description, messageType: "blocker_alert", toAgentId: toAgentId ?? fromAgentId },
	});
	return msg;
}

export async function handoffArtifact(
	projectId: string,
	fromAgentId: string,
	toAgentId: string,
	artifactType: string,
	content: string,
	relatedTaskId?: string,
): Promise<AgentProtocolMessage> {
	return sendProtocolMessage({
		projectId,
		fromAgentId,
		toAgentId,
		relatedTaskId,
		messageType: "handoff_artifact",
		payload: { artifactType, content },
	});
}

export async function recordDesignDecision(
	projectId: string,
	fromAgentId: string,
	decision: string,
	rationale: string,
	relatedTaskId?: string,
): Promise<AgentProtocolMessage> {
	return sendProtocolMessage({
		projectId,
		fromAgentId,
		relatedTaskId,
		messageType: "design_decision",
		payload: { decision, rationale },
	});
}

// ---------------------------------------------------------------------------
// Prompt injection — format unread messages for agent context
// ---------------------------------------------------------------------------

/**
 * Load unread protocol messages for an agent and format them for prompt injection.
 * Returns the formatted prompt section and the message IDs (to mark as read after use).
 */
export async function loadProtocolContext(
	projectId: string,
	agentId: string,
): Promise<{ prompt: string; messageIds: string[]; hasBlockers: boolean }> {
	const messages = await getUnreadMessages(projectId, agentId, 10);
	if (messages.length === 0) {
		return { prompt: "", messageIds: [], hasBlockers: false };
	}

	const hasBlockers = messages.some((m) => BLOCKING_TYPES.has(m.messageType));
	const messageIds = messages.map((m) => m.id);

	const formatted = messages
		.map((m) => {
			const from = m.fromAgentId;
			const payload = m.payload as Record<string, string>;
			switch (m.messageType) {
				case "request_info":
					return `[REQUEST from ${from}] Topic: ${payload.topic} — ${payload.question}`;
				case "blocker_alert":
					return `[BLOCKER from ${from}] ${payload.description}`;
				case "handoff_artifact":
					return `[HANDOFF from ${from}] ${payload.artifactType}: ${(payload.content ?? "").slice(0, 200)}`;
				case "design_decision":
					return `[DECISION by ${from}] ${payload.decision} — Rationale: ${payload.rationale}`;
				case "dependency_warning":
					return `[WARNING from ${from}] ${payload.description ?? JSON.stringify(payload)}`;
				default:
					return `[${m.messageType.toUpperCase()} from ${from}] ${JSON.stringify(payload).slice(0, 200)}`;
			}
		})
		.join("\n");

	const prompt = `\n--- INTER-AGENT MESSAGES (${messages.length} unread) ---\n${formatted}\n--- END MESSAGES ---\n`;

	return { prompt, messageIds, hasBlockers };
}

/** Mark protocol messages as read after they've been injected into a prompt */
export async function acknowledgeMessages(messageIds: string[]): Promise<void> {
	await markMessagesRead(messageIds);
}
