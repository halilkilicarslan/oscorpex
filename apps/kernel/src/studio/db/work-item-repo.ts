// ---------------------------------------------------------------------------
// Oscorpex — Work Item Repository: Backlog CRUD (v3.2)
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import type { WorkItem, WorkItemPriority, WorkItemSource, WorkItemStatus, WorkItemType } from "../types.js";
import { now, rowToWorkItem } from "./helpers.js";
import { createLogger } from "../logger.js";
const log = createLogger("work-item-repo");

// ---------------------------------------------------------------------------
// Work Items CRUD
// ---------------------------------------------------------------------------

export async function createWorkItem(data: {
	projectId: string;
	type: WorkItemType;
	title: string;
	description?: string;
	priority?: WorkItemPriority;
	severity?: WorkItem["severity"];
	labels?: string[];
	source?: WorkItemSource;
	sourceAgentId?: string;
	sourceTaskId?: string;
	sprintId?: string;
}): Promise<WorkItem> {
	const id = randomUUID();
	const ts = now();
	const priority = data.priority ?? "medium";
	const source = data.source ?? "user";
	const labels = data.labels ?? [];

	await execute(
		`
    INSERT INTO work_items (
      id, project_id, type, title, description, priority, severity,
      labels, status, source, source_agent_id, source_task_id, sprint_id,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10, $11, $12, $13, $13)
  `,
		[
			id,
			data.projectId,
			data.type,
			data.title,
			data.description ?? "",
			priority,
			data.severity ?? null,
			JSON.stringify(labels),
			source,
			data.sourceAgentId ?? null,
			data.sourceTaskId ?? null,
			data.sprintId ?? null,
			ts,
		],
	);

	return {
		id,
		projectId: data.projectId,
		type: data.type,
		title: data.title,
		description: data.description ?? "",
		priority,
		severity: data.severity,
		labels,
		status: "open",
		source,
		sourceAgentId: data.sourceAgentId,
		sourceTaskId: data.sourceTaskId,
		sprintId: data.sprintId,
		createdAt: ts,
		updatedAt: ts,
	};
}

export async function getWorkItem(id: string): Promise<WorkItem | null> {
	const row = await queryOne<any>("SELECT * FROM work_items WHERE id = $1", [id]);
	return row ? rowToWorkItem(row) : null;
}

export async function getWorkItems(
	projectId: string,
	filters?: {
		type?: WorkItemType;
		priority?: WorkItemPriority;
		status?: WorkItemStatus;
		sprintId?: string;
		source?: WorkItemSource;
	},
): Promise<WorkItem[]> {
	const conditions: string[] = ["project_id = $1"];
	const values: unknown[] = [projectId];
	let idx = 2;

	if (filters?.type !== undefined) {
		conditions.push(`type = $${idx++}`);
		values.push(filters.type);
	}
	if (filters?.priority !== undefined) {
		conditions.push(`priority = $${idx++}`);
		values.push(filters.priority);
	}
	if (filters?.status !== undefined) {
		conditions.push(`status = $${idx++}`);
		values.push(filters.status);
	}
	if (filters?.sprintId !== undefined) {
		conditions.push(`sprint_id = $${idx++}`);
		values.push(filters.sprintId);
	}
	if (filters?.source !== undefined) {
		conditions.push(`source = $${idx++}`);
		values.push(filters.source);
	}

	const rows = await query<any>(
		`SELECT * FROM work_items WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
		values as any[],
	);
	return rows.map(rowToWorkItem);
}

export async function getWorkItemsPaginated(
	projectId: string,
	filters: {
		type?: WorkItemType;
		priority?: WorkItemPriority;
		status?: WorkItemStatus;
		sprintId?: string;
		source?: WorkItemSource;
	},
	limit: number,
	offset: number,
): Promise<[WorkItem[], number]> {
	const conditions: string[] = ["project_id = $1"];
	const values: unknown[] = [projectId];
	let idx = 2;

	if (filters.type !== undefined) {
		conditions.push(`type = $${idx++}`);
		values.push(filters.type);
	}
	if (filters.priority !== undefined) {
		conditions.push(`priority = $${idx++}`);
		values.push(filters.priority);
	}
	if (filters.status !== undefined) {
		conditions.push(`status = $${idx++}`);
		values.push(filters.status);
	}
	if (filters.sprintId !== undefined) {
		conditions.push(`sprint_id = $${idx++}`);
		values.push(filters.sprintId);
	}
	if (filters.source !== undefined) {
		conditions.push(`source = $${idx++}`);
		values.push(filters.source);
	}

	const where = conditions.join(" AND ");

	const countRows = await query<any>(`SELECT COUNT(*) AS cnt FROM work_items WHERE ${where}`, values as any[]);
	const total = Number(countRows[0]?.cnt ?? 0);

	const rows = await query<any>(
		`SELECT * FROM work_items WHERE ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
		[...values, limit, offset] as any[],
	);
	return [rows.map(rowToWorkItem), total];
}

export async function updateWorkItem(
	id: string,
	data: Partial<
		Pick<
			WorkItem,
			"type" | "title" | "description" | "priority" | "severity" | "labels" | "status" | "plannedTaskId" | "sprintId"
		>
	>,
): Promise<WorkItem | null> {
	const fields: string[] = [];
	const values: unknown[] = [];
	let idx = 1;

	if (data.type !== undefined) {
		fields.push(`type = $${idx++}`);
		values.push(data.type);
	}
	if (data.title !== undefined) {
		fields.push(`title = $${idx++}`);
		values.push(data.title);
	}
	if (data.description !== undefined) {
		fields.push(`description = $${idx++}`);
		values.push(data.description);
	}
	if (data.priority !== undefined) {
		fields.push(`priority = $${idx++}`);
		values.push(data.priority);
	}
	if (data.severity !== undefined) {
		fields.push(`severity = $${idx++}`);
		values.push(data.severity);
	}
	if (data.labels !== undefined) {
		fields.push(`labels = $${idx++}`);
		values.push(JSON.stringify(data.labels));
	}
	if (data.status !== undefined) {
		fields.push(`status = $${idx++}`);
		values.push(data.status);
	}
	if (data.plannedTaskId !== undefined) {
		fields.push(`planned_task_id = $${idx++}`);
		values.push(data.plannedTaskId);
	}
	if (data.sprintId !== undefined) {
		fields.push(`sprint_id = $${idx++}`);
		values.push(data.sprintId);
	}

	if (fields.length === 0) return getWorkItem(id);

	fields.push(`updated_at = $${idx++}`);
	values.push(now());
	values.push(id);

	await execute(`UPDATE work_items SET ${fields.join(", ")} WHERE id = $${idx}`, values as any[]);
	return getWorkItem(id);
}

export async function deleteWorkItem(id: string): Promise<void> {
	await execute("DELETE FROM work_items WHERE id = $1", [id]);
}

export async function getWorkItemsBySprint(sprintId: string): Promise<WorkItem[]> {
	const rows = await query<any>("SELECT * FROM work_items WHERE sprint_id = $1 ORDER BY created_at DESC", [sprintId]);
	return rows.map(rowToWorkItem);
}

export async function countWorkItems(projectId: string, status?: WorkItemStatus): Promise<number> {
	let row: any;
	if (status !== undefined) {
		row = await queryOne<any>("SELECT COUNT(*) AS cnt FROM work_items WHERE project_id = $1 AND status = $2", [
			projectId,
			status,
		]);
	} else {
		row = await queryOne<any>("SELECT COUNT(*) AS cnt FROM work_items WHERE project_id = $1", [projectId]);
	}
	return Number.parseInt(row?.cnt ?? "0", 10);
}
