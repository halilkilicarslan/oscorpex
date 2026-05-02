// ---------------------------------------------------------------------------
// Oscorpex — Graph Mutation Repository
// Persists and queries runtime DAG mutations for audit and replay.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { createLogger } from "../logger.js";
import { execute, query, queryOne } from "../pg.js";
const log = createLogger("graph-mutation-repo");

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

export type GraphMutationStatus = "pending" | "applied" | "rejected";

export interface GraphMutation {
	id: string;
	projectId: string;
	pipelineRunId: string;
	causedByAgentId?: string;
	mutationType: GraphMutationType;
	payload: Record<string, unknown>;
	status: GraphMutationStatus;
	approvedBy?: string;
	rejectedReason?: string;
	appliedAt?: string;
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
		status: (row.status as GraphMutationStatus) ?? "applied",
		approvedBy: (row.approved_by as string) ?? undefined,
		rejectedReason: (row.rejected_reason as string) ?? undefined,
		appliedAt: (row.applied_at as string) ?? undefined,
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
	status?: GraphMutationStatus;
	approvedBy?: string;
	rejectedReason?: string;
	appliedAt?: string;
}): Promise<GraphMutation> {
	const id = randomUUID();
	const row = await queryOne(
		`INSERT INTO graph_mutations (id, project_id, pipeline_run_id, caused_by_agent_id, mutation_type, payload, status, approved_by, rejected_reason, applied_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		 RETURNING *`,
		[
			id,
			params.projectId,
			params.pipelineRunId,
			params.causedByAgentId ?? null,
			params.mutationType,
			JSON.stringify(params.payload),
			params.status ?? "applied",
			params.approvedBy ?? null,
			params.rejectedReason ?? null,
			params.appliedAt ?? null,
		],
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
	const rows = await query(`SELECT * FROM graph_mutations WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2`, [
		projectId,
		limit,
	]);
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

export async function updateGraphMutation(
	id: string,
	data: Partial<Pick<GraphMutation, "payload" | "status" | "approvedBy" | "rejectedReason" | "appliedAt">>,
): Promise<GraphMutation | null> {
	const fields: string[] = [];
	const values: unknown[] = [];
	let idx = 1;

	if (data.payload !== undefined) {
		fields.push(`payload = $${idx++}`);
		values.push(JSON.stringify(data.payload));
	}
	if (data.status !== undefined) {
		fields.push(`status = $${idx++}`);
		values.push(data.status);
	}
	if (data.approvedBy !== undefined) {
		fields.push(`approved_by = $${idx++}`);
		values.push(data.approvedBy ?? null);
	}
	if (data.rejectedReason !== undefined) {
		fields.push(`rejected_reason = $${idx++}`);
		values.push(data.rejectedReason ?? null);
	}
	if (data.appliedAt !== undefined) {
		fields.push(`applied_at = $${idx++}`);
		values.push(data.appliedAt ?? null);
	}

	if (fields.length === 0) return getGraphMutation(id);

	values.push(id);
	const row = await queryOne(`UPDATE graph_mutations SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`, values);
	return row ? rowToMutation(row) : null;
}
