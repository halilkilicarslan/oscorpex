// ---------------------------------------------------------------------------
// Oscorpex — Event Repository: Events + Chat Messages
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query } from "../pg.js";
import type { ChatMessage, ChatRole, StudioEvent } from "../types.js";
import { now, rowToEvent } from "./helpers.js";

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export async function insertEvent(data: Omit<StudioEvent, "id" | "timestamp">): Promise<StudioEvent> {
	const id = randomUUID();
	const timestamp = now();
	await execute(
		`
    INSERT INTO events (id, project_id, type, agent_id, task_id, payload, timestamp)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `,
		[id, data.projectId, data.type, data.agentId ?? null, data.taskId ?? null, JSON.stringify(data.payload), timestamp],
	);
	return { id, ...data, timestamp };
}

export async function listEvents(projectId: string, limit = 100): Promise<StudioEvent[]> {
	const rows = await query<any>("SELECT * FROM events WHERE project_id = $1 ORDER BY timestamp DESC LIMIT $2", [
		projectId,
		limit,
	]);
	return rows.map(rowToEvent);
}

// ---------------------------------------------------------------------------
// Chat Messages
// ---------------------------------------------------------------------------

export async function insertChatMessage(
	data: Pick<ChatMessage, "projectId" | "role" | "content">,
): Promise<ChatMessage> {
	const id = randomUUID();
	const ts = now();
	await execute(
		`
    INSERT INTO chat_messages (id, project_id, role, content, created_at)
    VALUES ($1, $2, $3, $4, $5)
  `,
		[id, data.projectId, data.role, data.content, ts],
	);
	return { id, ...data, createdAt: ts };
}

export async function listChatMessages(projectId: string): Promise<ChatMessage[]> {
	const rows = await query<any>("SELECT * FROM chat_messages WHERE project_id = $1 ORDER BY created_at", [projectId]);
	return rows.map((row) => ({
		id: row.id,
		projectId: row.project_id,
		role: row.role as ChatRole,
		content: row.content,
		createdAt: row.created_at,
	}));
}
