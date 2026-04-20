// ---------------------------------------------------------------------------
// Oscorpex — Graph Mutation Repository
// Persists and queries runtime DAG mutations for audit and replay.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { query, queryOne, execute } from "../pg.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GraphMutationType =
	| "insert_node"
	| "split_task"
	| "add_edge"
	| "remove_edge"
	| "defer_branch"
	| "open_review_branch"
	| "open_fix_branch"
	| "merge_into_phase";

export interface GraphMutation {
	id: string;
	projectId: string;
	pipelineRunId: string;
	causedByAgentId?: string;
	mutationType: GraphMutationType;
	payload: Record<string, unknown>;
	approvedBy?: string;
	createdAt: string;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToMutation(row: Record<string, unknown>): GraphMutation {
	return {
		id: row.id as string,
		projectId: row.project_id as string,
		pipelineRunId: row.pipeline_run_id as string,
		causedByAgentId: (row.caused_by_agent_id as string) ?? undefined,
		mutationType: row.mutation_type as GraphMutationType,
		payload: (row.payload as Record<string, unknown>) ?? {},
		approvedBy: (row.approved_by as string) ?? undefined,
		createdAt: row.created_at as string,
	};
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function recordGraphMutation(params: {
	projectId: string;
	pipelineRunId: string;
	causedByAgentId?: string;
	mutationType: GraphMutationType;
	payload: Record<string, unknown>;
	approvedBy?: string;
}): Promise<GraphMutation> {
	const id = randomUUID();
	const row = await queryOne(
		`INSERT INTO graph_mutations (id, project_id, pipeline_run_id, caused_by_agent_id, mutation_type, payload, approved_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING *`,
		[id, params.projectId, params.pipelineRunId, params.causedByAgentId ?? null, params.mutationType, JSON.stringify(params.payload), params.approvedBy ?? null],
	);
	return rowToMutation(row!);
}

export async function getGraphMutation(id: string): Promise<GraphMutation | null> {
	const row = await queryOne(`SELECT * FROM graph_mutations WHERE id = $1`, [id]);
	return row ? rowToMutation(row) : null;
}

export async function listGraphMutations(
	projectId: string,
	pipelineRunId?: string,
	limit = 50,
): Promise<GraphMutation[]> {
	if (pipelineRunId) {
		const rows = await query(
			`SELECT * FROM graph_mutations WHERE project_id = $1 AND pipeline_run_id = $2 ORDER BY created_at ASC LIMIT $3`,
			[projectId, pipelineRunId, limit],
		);
		return rows.map(rowToMutation);
	}
	const rows = await query(
		`SELECT * FROM graph_mutations WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2`,
		[projectId, limit],
	);
	return rows.map(rowToMutation);
}

export async function listMutationsByType(
	projectId: string,
	mutationType: GraphMutationType,
	limit = 50,
): Promise<GraphMutation[]> {
	const rows = await query(
		`SELECT * FROM graph_mutations WHERE project_id = $1 AND mutation_type = $2 ORDER BY created_at DESC LIMIT $3`,
		[projectId, mutationType, limit],
	);
	return rows.map(rowToMutation);
}
