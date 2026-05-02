// ---------------------------------------------------------------------------
// Oscorpex — Memory Bridge
// Writes PM chat messages and agent execution outputs to VoltAgent memory
// tables so the Memory page displays project activity.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "./pg.js";
import { createLogger } from "./logger.js";
const log = createLogger("memory-bridge");

function now(): string {
	return new Date().toISOString();
}

/**
 * Ensure a memory conversation exists for a project.
 * One conversation per project — reuses existing or creates new.
 */
export async function ensureConversation(projectId: string, projectName: string): Promise<string> {
	const existing = await queryOne<{ id: string }>(
		"SELECT id FROM voltagent_memory_conversations WHERE resource_id = $1",
		[projectId],
	);
	if (existing) return existing.id;

	const id = randomUUID();
	const ts = now();
	await execute(
		`INSERT INTO voltagent_memory_conversations
       (id, resource_id, user_id, title, metadata, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[id, projectId, "system", projectName, "{}", ts, ts],
	);
	return id;
}

/**
 * Record a chat message (user or assistant) in the memory tables.
 */
export async function recordChatToMemory(
	projectId: string,
	projectName: string,
	role: "user" | "assistant",
	content: string,
): Promise<void> {
	const conversationId = await ensureConversation(projectId, projectName);
	const messageId = randomUUID();
	const ts = now();

	await execute(
		`INSERT INTO voltagent_memory_messages
       (conversation_id, message_id, user_id, role, parts, metadata, format_version, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		[
			conversationId,
			messageId,
			role === "user" ? "user" : "pm-agent",
			role,
			JSON.stringify([{ type: "text", text: content }]),
			null,
			1,
			ts,
		],
	);

	// Update conversation timestamp
	await execute("UPDATE voltagent_memory_conversations SET updated_at = $1 WHERE id = $2", [ts, conversationId]);
}

/**
 * Record an agent execution step in the memory tables.
 */
export async function recordAgentStep(
	projectId: string,
	projectName: string,
	agentId: string,
	agentName: string,
	taskTitle: string,
	output: string | null,
): Promise<void> {
	const conversationId = await ensureConversation(projectId, projectName);
	const ts = now();

	// Get next step index
	const countRow = await queryOne<{ n: string }>(
		"SELECT COUNT(*) as n FROM voltagent_memory_steps WHERE conversation_id = $1",
		[conversationId],
	);
	const stepIndex = Number(countRow?.n ?? 0);

	await execute(
		`INSERT INTO voltagent_memory_steps
       (id, conversation_id, user_id, agent_id, agent_name, operation_id, step_index, type, role, content, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		[
			randomUUID(),
			conversationId,
			agentId,
			agentId,
			agentName,
			null,
			stepIndex,
			"task-execution",
			"assistant",
			output || `Completed: ${taskTitle}`,
			ts,
		],
	);

	await execute("UPDATE voltagent_memory_conversations SET updated_at = $1 WHERE id = $2", [ts, conversationId]);
}
