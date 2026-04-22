// ---------------------------------------------------------------------------
// Oscorpex — Diff Repo (v4.1)
// Task file diffs CRUD for DiffViewer feature.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query } from "../pg.js";
import { now } from "./helpers.js";
import { createLogger } from "../logger.js";
const log = createLogger("diff-repo");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskDiff {
	id: string;
	taskId: string;
	filePath: string;
	diffContent: string;
	diffType: "created" | "modified" | "deleted";
	linesAdded: number;
	linesRemoved: number;
	createdAt: string;
}

// ---------------------------------------------------------------------------
// Row Mapper
// ---------------------------------------------------------------------------

function rowToTaskDiff(row: any): TaskDiff {
	return {
		id: row.id,
		taskId: row.task_id,
		filePath: row.file_path,
		diffContent: row.diff_content,
		diffType: row.diff_type,
		linesAdded: Number(row.lines_added),
		linesRemoved: Number(row.lines_removed),
		createdAt: row.created_at,
	};
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function insertTaskDiff(
	taskId: string,
	filePath: string,
	diffContent: string,
	diffType: "created" | "modified" | "deleted",
	linesAdded: number,
	linesRemoved: number,
): Promise<TaskDiff> {
	const id = randomUUID();
	const createdAt = now();
	await execute(
		`INSERT INTO task_diffs (id, task_id, file_path, diff_content, diff_type, lines_added, lines_removed, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		[id, taskId, filePath, diffContent, diffType, linesAdded, linesRemoved, createdAt],
	);
	return { id, taskId, filePath, diffContent, diffType, linesAdded, linesRemoved, createdAt };
}

export async function insertTaskDiffs(
	taskId: string,
	diffs: Array<{
		filePath: string;
		diffContent: string;
		diffType: "created" | "modified" | "deleted";
		linesAdded: number;
		linesRemoved: number;
	}>,
): Promise<number> {
	if (diffs.length === 0) return 0;

	const createdAt = now();
	const values: string[] = [];
	const params: any[] = [];
	let idx = 1;

	for (const d of diffs) {
		const id = randomUUID();
		values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7})`);
		params.push(id, taskId, d.filePath, d.diffContent, d.diffType, d.linesAdded, d.linesRemoved, createdAt);
		idx += 8;
	}

	await execute(
		`INSERT INTO task_diffs (id, task_id, file_path, diff_content, diff_type, lines_added, lines_removed, created_at)
		 VALUES ${values.join(", ")}`,
		params,
	);
	return diffs.length;
}

export async function getTaskDiffs(taskId: string): Promise<TaskDiff[]> {
	const rows = await query<any>("SELECT * FROM task_diffs WHERE task_id = $1 ORDER BY file_path", [taskId]);
	return rows.map(rowToTaskDiff);
}

export async function getTaskDiffSummary(
	taskId: string,
): Promise<{ totalFiles: number; linesAdded: number; linesRemoved: number }> {
	const row = await query<any>(
		`SELECT COUNT(*) AS total_files,
		        COALESCE(SUM(lines_added), 0) AS lines_added,
		        COALESCE(SUM(lines_removed), 0) AS lines_removed
		 FROM task_diffs WHERE task_id = $1`,
		[taskId],
	);
	const r = row[0];
	return {
		totalFiles: Number(r?.total_files ?? 0),
		linesAdded: Number(r?.lines_added ?? 0),
		linesRemoved: Number(r?.lines_removed ?? 0),
	};
}

export async function deleteTaskDiffs(taskId: string): Promise<void> {
	await execute("DELETE FROM task_diffs WHERE task_id = $1", [taskId]);
}
