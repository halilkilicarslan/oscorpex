// ---------------------------------------------------------------------------
// Oscorpex — Session Repository: Agent runtime session CRUD
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import type { AgentObservation, AgentSession, AgentSessionStatus } from "../types.js";

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToSession(row: any): AgentSession {
	return {
		id: row.id,
		projectId: row.project_id,
		agentId: row.agent_id,
		taskId: row.task_id ?? undefined,
		strategy: row.strategy ?? undefined,
		status: row.status as AgentSessionStatus,
		stepsCompleted: Number(row.steps_completed),
		maxSteps: Number(row.max_steps),
		observations: (typeof row.observations === "string" ? JSON.parse(row.observations) : row.observations) ?? [],
		startedAt: row.started_at?.toISOString?.() ?? row.started_at ?? undefined,
		completedAt: row.completed_at?.toISOString?.() ?? row.completed_at ?? undefined,
		createdAt: row.created_at?.toISOString?.() ?? row.created_at,
	};
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createAgentSession(
	data: Pick<AgentSession, "projectId" | "agentId" | "taskId"> & { maxSteps?: number },
): Promise<AgentSession> {
	const id = randomUUID();
	const maxSteps = data.maxSteps ?? 10;
	await execute(
		`INSERT INTO agent_sessions (id, project_id, agent_id, task_id, status, max_steps, observations, started_at)
		 VALUES ($1, $2, $3, $4, 'active', $5, '[]', now())`,
		[id, data.projectId, data.agentId, data.taskId ?? null, maxSteps],
	);
	return (await getAgentSession(id))!;
}

export async function getAgentSession(id: string): Promise<AgentSession | undefined> {
	const row = await queryOne<any>("SELECT * FROM agent_sessions WHERE id = $1", [id]);
	return row ? rowToSession(row) : undefined;
}

export async function getActiveSession(projectId: string, taskId: string): Promise<AgentSession | undefined> {
	const row = await queryOne<any>(
		`SELECT * FROM agent_sessions WHERE project_id = $1 AND task_id = $2 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
		[projectId, taskId],
	);
	return row ? rowToSession(row) : undefined;
}

export async function updateAgentSession(
	id: string,
	data: Partial<Pick<AgentSession, "status" | "strategy" | "stepsCompleted" | "completedAt">>,
): Promise<AgentSession | undefined> {
	const fields: string[] = [];
	const values: unknown[] = [];
	let idx = 1;

	if (data.status !== undefined) {
		fields.push(`status = $${idx++}`);
		values.push(data.status);
	}
	if (data.strategy !== undefined) {
		fields.push(`strategy = $${idx++}`);
		values.push(data.strategy);
	}
	if (data.stepsCompleted !== undefined) {
		fields.push(`steps_completed = $${idx++}`);
		values.push(data.stepsCompleted);
	}
	if (data.completedAt !== undefined) {
		fields.push(`completed_at = $${idx++}`);
		values.push(data.completedAt);
	}

	if (fields.length === 0) return getAgentSession(id);

	values.push(id);
	const row = await queryOne<any>(
		`UPDATE agent_sessions SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
		values as any[],
	);
	return row ? rowToSession(row) : undefined;
}

/** Append an observation to the session's observations JSONB array */
export async function addObservation(sessionId: string, observation: AgentObservation): Promise<void> {
	await execute(
		`UPDATE agent_sessions
		 SET observations = observations || $1::jsonb,
		     steps_completed = steps_completed + 1
		 WHERE id = $2`,
		[JSON.stringify(observation), sessionId],
	);
}

/** List recent sessions for a project/agent */
export async function listAgentSessions(
	projectId: string,
	agentId?: string,
	limit = 20,
): Promise<AgentSession[]> {
	if (agentId) {
		const rows = await query<any>(
			`SELECT * FROM agent_sessions WHERE project_id = $1 AND agent_id = $2 ORDER BY created_at DESC LIMIT $3`,
			[projectId, agentId, limit],
		);
		return rows.map(rowToSession);
	}
	const rows = await query<any>(
		`SELECT * FROM agent_sessions WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2`,
		[projectId, limit],
	);
	return rows.map(rowToSession);
}
