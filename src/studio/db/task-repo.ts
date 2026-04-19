// ---------------------------------------------------------------------------
// Oscorpex — Task Repository: Task CRUD + lifecycle
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import type { Task, TaskOutput } from "../types.js";
import { rowToTask } from "./helpers.js";

// ---------------------------------------------------------------------------
// Tasks CRUD
// ---------------------------------------------------------------------------

export async function createTask(
	data: Pick<Task, "phaseId" | "title" | "description" | "assignedAgent" | "complexity" | "dependsOn" | "branch"> & {
		taskType?: Task["taskType"];
		requiresApproval?: boolean;
		parentTaskId?: string;
		targetFiles?: string[];
		estimatedLines?: number;
		assignedAgentId?: string;
		/** Direct project reference. When omitted it is resolved from phaseId. */
		projectId?: string;
	},
): Promise<Task> {
	const id = randomUUID();
	const taskType = data.taskType ?? "ai";
	const requiresApproval = data.requiresApproval ?? false;

	// Resolve projectId: prefer caller-supplied value, fall back to phase lookup.
	let projectId = data.projectId ?? null;
	if (!projectId) {
		const phaseRow = await queryOne<{ project_id: string }>(
			`SELECT pp.project_id FROM phases ph
			 JOIN project_plans pp ON ph.plan_id = pp.id
			 WHERE ph.id = $1`,
			[data.phaseId],
		);
		projectId = phaseRow?.project_id ?? null;
	}

	await execute(
		`
    INSERT INTO tasks (id, phase_id, project_id, title, description, assigned_agent, status, complexity, depends_on, branch, retry_count, task_type, requires_approval, parent_task_id, target_files, estimated_lines, assigned_agent_id)
    VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8, $9, 0, $10, $11, $12, $13, $14, $15)
  `,
		[
			id,
			data.phaseId,
			projectId,
			data.title,
			data.description,
			data.assignedAgent,
			data.complexity,
			JSON.stringify(data.dependsOn),
			data.branch,
			taskType,
			requiresApproval ? 1 : 0,
			data.parentTaskId ?? null,
			JSON.stringify(data.targetFiles ?? []),
			data.estimatedLines ?? null,
			data.assignedAgentId ?? null,
		],
	);

	return {
		id,
		phaseId: data.phaseId,
		projectId: projectId ?? undefined,
		title: data.title,
		description: data.description,
		assignedAgent: data.assignedAgent,
		status: "queued",
		complexity: data.complexity,
		dependsOn: data.dependsOn,
		branch: data.branch,
		taskType: taskType !== "ai" ? (taskType as Task["taskType"]) : undefined,
		retryCount: 0,
		revisionCount: 0,
		requiresApproval,
		parentTaskId: data.parentTaskId,
		targetFiles: data.targetFiles,
		estimatedLines: data.estimatedLines,
		assignedAgentId: data.assignedAgentId,
	};
}

export async function getTask(id: string): Promise<Task | undefined> {
	const row = await queryOne<any>("SELECT * FROM tasks WHERE id = $1", [id]);
	return row ? rowToTask(row) : undefined;
}

export async function listTasks(phaseId: string): Promise<Task[]> {
	const rows = await query<any>("SELECT * FROM tasks WHERE phase_id = $1", [phaseId]);
	return rows.map(rowToTask);
}

export async function listProjectTasks(projectId: string, limit?: number, offset?: number): Promise<Task[]> {
	if (limit !== undefined && offset !== undefined) {
		const rows = await query<any>(
			`
      SELECT t.* FROM tasks t
      JOIN phases p ON t.phase_id = p.id
      JOIN project_plans pp ON p.plan_id = pp.id
      WHERE pp.project_id = $1
      ORDER BY p."order", t.id
      LIMIT $2 OFFSET $3
    `,
			[projectId, limit, offset],
		);
		return rows.map(rowToTask);
	}
	const rows = await query<any>(
		`
    SELECT t.* FROM tasks t
    JOIN phases p ON t.phase_id = p.id
    JOIN project_plans pp ON p.plan_id = pp.id
    WHERE pp.project_id = $1
    ORDER BY p."order", t.id
  `,
		[projectId],
	);
	return rows.map(rowToTask);
}

export async function countProjectTasks(projectId: string): Promise<number> {
	const row = await queryOne<{ cnt: string }>(
		`SELECT COUNT(*) AS cnt FROM tasks t
		 JOIN phases p ON t.phase_id = p.id
		 JOIN project_plans pp ON p.plan_id = pp.id
		 WHERE pp.project_id = $1`,
		[projectId],
	);
	return Number(row?.cnt ?? 0);
}

/** Paginated variant returning [tasks, total] — used by task-routes. */
export async function listProjectTasksPaginated(
	projectId: string,
	limit: number,
	offset: number,
): Promise<[Task[], number]> {
	const [tasks, total] = await Promise.all([listProjectTasks(projectId, limit, offset), countProjectTasks(projectId)]);
	return [tasks, total];
}

export async function updateTask(
	id: string,
	data: Partial<
		Pick<
			Task,
			| "status"
			| "assignedAgent"
			| "output"
			| "retryCount"
			| "error"
			| "startedAt"
			| "completedAt"
			| "reviewStatus"
			| "reviewerAgentId"
			| "revisionCount"
			| "assignedAgentId"
			| "requiresApproval"
			| "approvalStatus"
			| "approvalRejectionReason"
		>
	>,
): Promise<Task | undefined> {
	const fields: string[] = [];
	const values: unknown[] = [];
	let idx = 1;

	if (data.status !== undefined) {
		fields.push(`status = $${idx++}`);
		values.push(data.status);
	}
	if (data.assignedAgent !== undefined) {
		fields.push(`assigned_agent = $${idx++}`);
		values.push(data.assignedAgent);
	}
	if (data.output !== undefined) {
		fields.push(`output = $${idx++}`);
		values.push(JSON.stringify(data.output));
	}
	if (data.retryCount !== undefined) {
		fields.push(`retry_count = $${idx++}`);
		values.push(data.retryCount);
	}
	if (data.startedAt !== undefined) {
		fields.push(`started_at = $${idx++}`);
		values.push(data.startedAt);
	}
	if (data.completedAt !== undefined) {
		fields.push(`completed_at = $${idx++}`);
		values.push(data.completedAt);
	}
	if (data.error !== undefined) {
		fields.push(`error = $${idx++}`);
		values.push(data.error);
	}
	if (data.reviewStatus !== undefined) {
		fields.push(`review_status = $${idx++}`);
		values.push(data.reviewStatus);
	}
	if (data.reviewerAgentId !== undefined) {
		fields.push(`reviewer_agent_id = $${idx++}`);
		values.push(data.reviewerAgentId);
	}
	if (data.revisionCount !== undefined) {
		fields.push(`revision_count = $${idx++}`);
		values.push(data.revisionCount);
	}
	if (data.assignedAgentId !== undefined) {
		fields.push(`assigned_agent_id = $${idx++}`);
		values.push(data.assignedAgentId);
	}
	// Human-in-the-Loop onay alanları
	if (data.requiresApproval !== undefined) {
		fields.push(`requires_approval = $${idx++}`);
		values.push(data.requiresApproval ? 1 : 0);
	}
	if (data.approvalStatus !== undefined) {
		fields.push(`approval_status = $${idx++}`);
		values.push(data.approvalStatus);
	}
	if (data.approvalRejectionReason !== undefined) {
		fields.push(`approval_rejection_reason = $${idx++}`);
		values.push(data.approvalRejectionReason);
	}

	if (fields.length === 0) return getTask(id);

	values.push(id);
	const row = await queryOne<any>(
		`UPDATE tasks SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
		values as any[],
	);
	return row ? rowToTask(row) : undefined;
}

/**
 * Bekleyen onay gerektiren task'ları listeler.
 * approval_status = 'pending' olan tüm waiting_approval task'ları döner.
 */
export async function listPendingApprovals(projectId: string): Promise<Task[]> {
	const rows = await query<any>(
		`
    SELECT t.* FROM tasks t
    JOIN phases p ON t.phase_id = p.id
    JOIN project_plans pp ON p.plan_id = pp.id
    WHERE pp.project_id = $1
      AND t.status = 'waiting_approval'
      AND (t.approval_status = 'pending' OR t.approval_status IS NULL)
    ORDER BY p."order", t.id
  `,
		[projectId],
	);
	return rows.map(rowToTask);
}

// ---------------------------------------------------------------------------
// v3.0: Sub-task queries
// ---------------------------------------------------------------------------

export async function getSubTasks(parentTaskId: string): Promise<Task[]> {
	const rows = await query<any>("SELECT * FROM tasks WHERE parent_task_id = $1 ORDER BY id", [parentTaskId]);
	return rows.map(rowToTask);
}

export async function areAllSubTasksDone(parentTaskId: string): Promise<boolean> {
	const row = await queryOne<{ total: string; done: string }>(
		`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'done') as done
		 FROM tasks WHERE parent_task_id = $1`,
		[parentTaskId],
	);
	if (!row || Number(row.total) === 0) return false;
	return Number(row.total) === Number(row.done);
}

// ---------------------------------------------------------------------------
// v3.3: Incremental planning queries
// ---------------------------------------------------------------------------

export async function getUnfinishedTasks(projectId: string): Promise<Task[]> {
	const rows = await query<any>(
		`SELECT t.* FROM tasks t
		 JOIN phases p ON t.phase_id = p.id
		 JOIN project_plans pp ON p.plan_id = pp.id
		 WHERE pp.project_id = $1 AND t.status NOT IN ('done', 'failed')
		 ORDER BY p."order", t.id`,
		[projectId],
	);
	return rows.map(rowToTask);
}

export async function moveTaskToPhase(taskId: string, newPhaseId: string): Promise<void> {
	await execute("UPDATE tasks SET phase_id = $1 WHERE id = $2", [newPhaseId, taskId]);
}

/**
 * Append log lines to a task's output.logs without replacing other output fields.
 * Safe to call from streaming contexts — reads current state then writes atomically.
 */
export async function appendTaskLogs(taskId: string, logs: string[]): Promise<void> {
	if (logs.length === 0) return;
	const task = await getTask(taskId);
	if (!task) return;

	const currentOutput: TaskOutput = task.output ?? {
		filesCreated: [],
		filesModified: [],
		logs: [],
	};
	currentOutput.logs.push(...logs);

	await execute("UPDATE tasks SET output = $1 WHERE id = $2", [JSON.stringify(currentOutput), taskId]);
}
