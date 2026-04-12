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
	},
): Promise<Task> {
	const id = randomUUID();
	const taskType = data.taskType ?? "ai";
	const requiresApproval = data.requiresApproval ?? false;
	await execute(
		`
    INSERT INTO tasks (id, phase_id, title, description, assigned_agent, status, complexity, depends_on, branch, retry_count, task_type, requires_approval)
    VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7, $8, 0, $9, $10)
  `,
		[
			id,
			data.phaseId,
			data.title,
			data.description,
			data.assignedAgent,
			data.complexity,
			JSON.stringify(data.dependsOn),
			data.branch,
			taskType,
			requiresApproval ? 1 : 0,
		],
	);

	return {
		id,
		phaseId: data.phaseId,
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

export async function listProjectTasks(projectId: string): Promise<Task[]> {
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
	await execute(`UPDATE tasks SET ${fields.join(", ")} WHERE id = $${idx}`, values as any[]);
	return getTask(id);
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
