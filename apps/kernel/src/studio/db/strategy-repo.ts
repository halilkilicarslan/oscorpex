// ---------------------------------------------------------------------------
// Oscorpex — Strategy Repository: Agent strategy catalog CRUD
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { createLogger } from "../logger.js";
import { execute, query, queryOne } from "../pg.js";
import type { AgentStrategy } from "../types.js";
const log = createLogger("strategy-repo");

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToStrategy(row: any): AgentStrategy {
	return {
		id: row.id,
		agentRole: row.agent_role,
		name: row.name,
		description: row.description,
		promptAddendum: row.prompt_addendum ?? undefined,
		allowedTaskTypes: row.allowed_task_types ?? [],
		isDefault: Boolean(row.is_default),
	};
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createStrategy(data: Omit<AgentStrategy, "id">): Promise<AgentStrategy> {
	const id = randomUUID();
	await execute(
		`INSERT INTO agent_strategies (id, agent_role, name, description, prompt_addendum, allowed_task_types, is_default)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[
			id,
			data.agentRole,
			data.name,
			data.description,
			data.promptAddendum ?? null,
			data.allowedTaskTypes,
			data.isDefault,
		],
	);
	return { ...data, id };
}

export async function getStrategy(id: string): Promise<AgentStrategy | undefined> {
	const row = await queryOne<any>("SELECT * FROM agent_strategies WHERE id = $1", [id]);
	return row ? rowToStrategy(row) : undefined;
}

/** Get strategies available for a role and task type */
export async function getStrategiesForRole(agentRole: string, taskType?: string): Promise<AgentStrategy[]> {
	if (taskType) {
		const rows = await query<any>(
			`SELECT * FROM agent_strategies WHERE agent_role = $1 AND ($2 = ANY(allowed_task_types) OR allowed_task_types = '{}')
			 ORDER BY is_default DESC, name`,
			[agentRole, taskType],
		);
		return rows.map(rowToStrategy);
	}
	const rows = await query<any>(`SELECT * FROM agent_strategies WHERE agent_role = $1 ORDER BY is_default DESC, name`, [
		agentRole,
	]);
	return rows.map(rowToStrategy);
}

/** Get the default strategy for a role */
export async function getDefaultStrategy(agentRole: string): Promise<AgentStrategy | undefined> {
	const row = await queryOne<any>(
		`SELECT * FROM agent_strategies WHERE agent_role = $1 AND is_default = true LIMIT 1`,
		[agentRole],
	);
	return row ? rowToStrategy(row) : undefined;
}

/** List all strategies */
export async function listStrategies(): Promise<AgentStrategy[]> {
	const rows = await query<any>("SELECT * FROM agent_strategies ORDER BY agent_role, name");
	return rows.map(rowToStrategy);
}
