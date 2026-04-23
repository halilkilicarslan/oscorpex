// @oscorpex/kernel — Run repository
// DB layer for the canonical Run entity.

import { query, queryOne, execute } from "../pg.js";
import type { Run, RunStatus, RunMode } from "@oscorpex/core";

function rowToRun(row: Record<string, unknown>): Run {
	return {
		id: row.id as string,
		projectId: row.project_id as string,
		goal: row.goal as string,
		mode: row.mode as RunMode,
		status: row.status as RunStatus,
		currentStageId: (row.current_stage_id as string) ?? undefined,
		startedAt: (row.started_at as string) ?? undefined,
		completedAt: (row.completed_at as string) ?? undefined,
		metadata: JSON.parse((row.metadata as string) || "{}"),
	};
}

export async function createRun(run: Run): Promise<Run> {
	await execute(
		`INSERT INTO runs (id, project_id, goal, mode, status, current_stage_id, started_at, completed_at, metadata, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		[
			run.id,
			run.projectId,
			run.goal,
			run.mode,
			run.status,
			run.currentStageId ?? null,
			run.startedAt ?? null,
			run.completedAt ?? null,
			JSON.stringify(run.metadata ?? {}),
			run.createdAt ?? new Date().toISOString(),
		],
	);
	return run;
}

export async function getRun(id: string): Promise<Run | null> {
	const row = await queryOne<Record<string, unknown>>(
		`SELECT * FROM runs WHERE id = $1`,
		[id],
	);
	return row ? rowToRun(row) : null;
}

export async function updateRun(id: string, partial: Partial<Run>): Promise<Run> {
	const sets: string[] = [];
	const values: unknown[] = [];
	let idx = 1;

	if (partial.projectId !== undefined) { sets.push(`project_id = $${idx++}`); values.push(partial.projectId); }
	if (partial.goal !== undefined) { sets.push(`goal = $${idx++}`); values.push(partial.goal); }
	if (partial.mode !== undefined) { sets.push(`mode = $${idx++}`); values.push(partial.mode); }
	if (partial.status !== undefined) { sets.push(`status = $${idx++}`); values.push(partial.status); }
	if (partial.currentStageId !== undefined) { sets.push(`current_stage_id = $${idx++}`); values.push(partial.currentStageId); }
	if (partial.startedAt !== undefined) { sets.push(`started_at = $${idx++}`); values.push(partial.startedAt); }
	if (partial.completedAt !== undefined) { sets.push(`completed_at = $${idx++}`); values.push(partial.completedAt); }
	if (partial.metadata !== undefined) { sets.push(`metadata = $${idx++}`); values.push(JSON.stringify(partial.metadata)); }

	if (sets.length === 0) {
		const existing = await getRun(id);
		if (!existing) throw new Error(`Run ${id} not found`);
		return existing;
	}

	values.push(id);
	await execute(`UPDATE runs SET ${sets.join(", ")} WHERE id = $${idx}`, values);

	const updated = await getRun(id);
	if (!updated) throw new Error(`Run ${id} not found after update`);
	return updated;
}

export async function listRuns(filter: { projectId?: string; status?: string; limit?: number; offset?: number } = {}): Promise<Run[]> {
	const conditions: string[] = [];
	const values: unknown[] = [];
	let idx = 1;

	if (filter.projectId) { conditions.push(`project_id = $${idx++}`); values.push(filter.projectId); }
	if (filter.status) { conditions.push(`status = $${idx++}`); values.push(filter.status); }

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const limit = filter.limit ? `LIMIT ${filter.limit}` : "";
	const offset = filter.offset ? `OFFSET ${filter.offset}` : "";

	const rows = await query<Record<string, unknown>>(
		`SELECT * FROM runs ${where} ORDER BY created_at DESC ${limit} ${offset}`,
		values,
	);
	return rows.map(rowToRun);
}