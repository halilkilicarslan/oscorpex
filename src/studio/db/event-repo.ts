// ---------------------------------------------------------------------------
// Oscorpex — Event Repository: Events + Chat Messages
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
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

export async function getEvent(eventId: string): Promise<StudioEvent | null> {
	const row = await queryOne<any>("SELECT * FROM events WHERE id = $1", [eventId]);
	if (!row) return null;
	return rowToEvent(row);
}

export async function listEvents(projectId: string, limit = 100, offset = 0): Promise<StudioEvent[]> {
	const rows = await query<any>(
		"SELECT * FROM events WHERE project_id = $1 ORDER BY timestamp DESC LIMIT $2 OFFSET $3",
		[projectId, limit, offset],
	);
	return rows.map(rowToEvent);
}

export async function countEvents(projectId: string): Promise<number> {
	const rows = await query<any>("SELECT COUNT(*) AS cnt FROM events WHERE project_id = $1", [projectId]);
	return Number(rows[0]?.cnt ?? 0);
}

// ---------------------------------------------------------------------------
// Chat Messages
// ---------------------------------------------------------------------------

export async function insertChatMessage(
	data: Pick<ChatMessage, "projectId" | "role" | "content"> & { agentId?: string },
): Promise<ChatMessage> {
	const id = randomUUID();
	const ts = now();
	await execute(
		`
    INSERT INTO chat_messages (id, project_id, role, content, agent_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)
  `,
		[id, data.projectId, data.role, data.content, data.agentId ?? null, ts],
	);
	return {
		id,
		projectId: data.projectId,
		role: data.role,
		content: data.content,
		agentId: data.agentId,
		createdAt: ts,
	};
}

export async function listChatMessages(projectId: string, agentId?: string): Promise<ChatMessage[]> {
	const conditions = ["project_id = $1"];
	const values: unknown[] = [projectId];
	if (agentId) {
		conditions.push("agent_id = $2");
		values.push(agentId);
	}
	const rows = await query<any>(
		`SELECT * FROM chat_messages WHERE ${conditions.join(" AND ")} ORDER BY created_at`,
		values,
	);
	return rows.map((row) => ({
		id: row.id,
		projectId: row.project_id,
		role: row.role as ChatRole,
		content: row.content,
		agentId: row.agent_id ?? undefined,
		createdAt: row.created_at,
	}));
}
