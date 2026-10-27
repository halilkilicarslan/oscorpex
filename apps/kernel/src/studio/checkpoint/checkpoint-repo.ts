import { randomUUID } from "node:crypto";
import { query, queryOne } from "../db.js";
import type {
	CheckpointRecord,
	CreateCheckpointInput,
	RollbackRequest,
	RollbackResult,
	RollbackStatus,
} from "./types.js";

export async function createCheckpoint(input: CreateCheckpointInput): Promise<CheckpointRecord> {
	const id = randomUUID();
	const ref = `chk-${input.type}-${Date.now()}`;
	await queryOne(
		`INSERT INTO checkpoints (id, tenant_id, project_id, run_id, task_id, type, ref, metadata, created_by, reason, risk_level)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		 RETURNING *`,
		[
			id,
			input.tenantId,
			input.projectId,
			input.runId ?? null,
			input.taskId ?? null,
			input.type,
			ref,
			JSON.stringify(input.metadata ?? {}),
			input.createdBy,
			input.reason,
			input.riskLevel,
		],
	);
	return { ...input, id, ref, createdAt: new Date().toISOString(), status: "active" };
}

export async function getCheckpoint(id: string, tenantId: string): Promise<CheckpointRecord | null> {
	const row = await queryOne<Record<string, unknown>>("SELECT * FROM checkpoints WHERE id = $1 AND tenant_id = $2", [
		id,
		tenantId,
	]);
	return row ? mapRow(row) : null;
}

export async function listProjectCheckpoints(
	projectId: string,
	tenantId: string,
	limit = 50,
): Promise<CheckpointRecord[]> {
	const rows = await query<Record<string, unknown>>(
		"SELECT * FROM checkpoints WHERE project_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT $3",
		[projectId, tenantId, limit],
	);
	return rows.map(mapRow);
}

export async function markCheckpointRolledBack(id: string, tenantId: string): Promise<void> {
	await queryOne("UPDATE checkpoints SET status = 'rolled_back' WHERE id = $1 AND tenant_id = $2", [id, tenantId]);
}

export async function createRollbackRequest(req: RollbackRequest): Promise<string> {
	const id = randomUUID();
	await queryOne(
		`INSERT INTO rollback_requests (id, checkpoint_id, tenant_id, project_id, requested_by, reason, dry_run)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[id, req.checkpointId, req.tenantId, req.projectId, req.requestedBy, req.reason, req.dryRun],
	);
	return id;
}

export async function updateRollbackStatus(id: string, status: RollbackStatus, result?: RollbackResult): Promise<void> {
	await queryOne("UPDATE rollback_requests SET status = $1, result = $2, resolved_at = now() WHERE id = $3", [
		status,
		result ? JSON.stringify(result) : null,
		id,
	]);
}

function mapRow(row: Record<string, unknown>): CheckpointRecord {
	const createdAt = row.created_at;
	const createdAtStr =
		createdAt instanceof Date
			? createdAt.toISOString()
			: createdAt != null
				? String(createdAt)
				: new Date().toISOString();

	return {
		id: String(row.id),
		tenantId: String(row.tenant_id),
		projectId: String(row.project_id),
		runId: row.run_id != null ? String(row.run_id) : undefined,
		taskId: row.task_id != null ? String(row.task_id) : undefined,
		type: row.type as CheckpointRecord["type"],
		ref: String(row.ref),
		metadata: (row.metadata as Record<string, unknown>) ?? {},
		createdAt: createdAtStr,
		createdBy: row.created_by as CheckpointRecord["createdBy"],
		reason: String(row.reason),
		riskLevel: row.risk_level as CheckpointRecord["riskLevel"],
		status: row.status as CheckpointRecord["status"],
	};
}
