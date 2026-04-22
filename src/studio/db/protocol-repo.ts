// ---------------------------------------------------------------------------
// Oscorpex — Protocol Repository: Structured inter-agent messages CRUD
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import type { AgentProtocolMessage, ProtocolMessageStatus, ProtocolMessageType } from "../types.js";
import { createLogger } from "../logger.js";
const log = createLogger("protocol-repo");

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToMessage(row: any): AgentProtocolMessage {
	return {
		id: row.id,
		projectId: row.project_id,
		fromAgentId: row.from_agent_id,
		toAgentId: row.to_agent_id ?? undefined,
		relatedTaskId: row.related_task_id ?? undefined,
		messageType: row.message_type as ProtocolMessageType,
		payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload ?? {},
		status: row.status as ProtocolMessageStatus,
		createdAt: row.created_at?.toISOString?.() ?? row.created_at,
	};
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function sendProtocolMessage(
	data: Omit<AgentProtocolMessage, "id" | "status" | "createdAt">,
): Promise<AgentProtocolMessage> {
	const id = randomUUID();
	await execute(
		`INSERT INTO agent_protocol_messages (id, project_id, from_agent_id, to_agent_id, related_task_id, message_type, payload)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[
			id,
			data.projectId,
			data.fromAgentId,
			data.toAgentId ?? null,
			data.relatedTaskId ?? null,
			data.messageType,
			JSON.stringify(data.payload),
		],
	);
	return (await getProtocolMessage(id))!;
}

export async function getProtocolMessage(id: string): Promise<AgentProtocolMessage | undefined> {
	const row = await queryOne<any>("SELECT * FROM agent_protocol_messages WHERE id = $1", [id]);
	return row ? rowToMessage(row) : undefined;
}

/** Get unread messages for an agent (for prompt injection) */
export async function getUnreadMessages(
	projectId: string,
	toAgentId: string,
	limit = 10,
): Promise<AgentProtocolMessage[]> {
	const rows = await query<any>(
		`SELECT * FROM agent_protocol_messages
		 WHERE project_id = $1 AND to_agent_id = $2 AND status = 'unread'
		 ORDER BY created_at ASC LIMIT $3`,
		[projectId, toAgentId, limit],
	);
	return rows.map(rowToMessage);
}

/** Get messages related to a specific task */
export async function getTaskMessages(
	projectId: string,
	taskId: string,
): Promise<AgentProtocolMessage[]> {
	const rows = await query<any>(
		`SELECT * FROM agent_protocol_messages
		 WHERE project_id = $1 AND related_task_id = $2
		 ORDER BY created_at ASC`,
		[projectId, taskId],
	);
	return rows.map(rowToMessage);
}

/** Mark messages as read */
export async function markMessagesRead(messageIds: string[]): Promise<void> {
	if (messageIds.length === 0) return;
	const placeholders = messageIds.map((_, i) => `$${i + 1}`).join(", ");
	await execute(
		`UPDATE agent_protocol_messages SET status = 'read' WHERE id IN (${placeholders})`,
		messageIds,
	);
}

/** Mark a message as actioned */
export async function markMessageActioned(id: string): Promise<void> {
	await execute(`UPDATE agent_protocol_messages SET status = 'actioned' WHERE id = $1`, [id]);
}

/** List all protocol messages for a project */
export async function listProtocolMessages(
	projectId: string,
	limit = 50,
): Promise<AgentProtocolMessage[]> {
	const rows = await query<any>(
		`SELECT * FROM agent_protocol_messages WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2`,
		[projectId, limit],
	);
	return rows.map(rowToMessage);
}
