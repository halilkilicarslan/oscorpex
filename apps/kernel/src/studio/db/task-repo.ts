// ---------------------------------------------------------------------------
// Oscorpex — Task Repository: Task CRUD + lifecycle
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { createLogger } from "../logger.js";
import { execute, query, queryOne, withTransaction } from "../pg.js";
import type { Task, TaskOutput } from "../types.js";
import { rowToTask } from "./helpers.js";
const log = createLogger("task-repo");
const CLAIM_STALE_INTERVAL_SECONDS = 120;

// ---------------------------------------------------------------------------
// Tasks CRUD
// ---------------------------------------------------------------------------

export async function createTask(
	data: Pick<Task, "phaseId" | "title" | "description" | "assignedAgent" | "complexity" | "dependsOn" | "branch"> & {
		taskType?: Task["taskType"];
		testExpectation?: Task["testExpectation"];
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
	const testExpectation = data.testExpectation ?? null;
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
    INSERT INTO tasks (id, phase_id, project_id, title, description, assigned_agent, status, complexity, depends_on, branch, retry_count, task_type, test_expectation, requires_approval, parent_task_id, target_files, estimated_lines, assigned_agent_id)
    VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8, $9, 0, $10, $11, $12, $13, $14, $15, $16)
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
			testExpectation,
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
		testExpectation: testExpectation ?? undefined,
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

/** Batch-fetch tasks by IDs — returns a Map for O(1) lookup */
export async function getTasksByIds(ids: string[]): Promise<Map<string, Task>> {
	if (ids.length === 0) return new Map();
	const rows = await query<Record<string, unknown>>(`SELECT * FROM tasks WHERE id = ANY($1)`, [ids]);
	const map = new Map<string, Task>();
	for (const row of rows) {
		const task = rowToTask(row);
		map.set(task.id, task);
	}
	return map;
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
			| "reviewTaskId"
			| "revisionCount"
			| "assignedAgentId"
			| "requiresApproval"
			| "approvalStatus"
			| "approvalRejectionReason"
			| "dependsOn"
			| "riskLevel"
			| "policySnapshot"
			| "testExpectation"
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
	if (data.reviewTaskId !== undefined) {
		fields.push(`review_task_id = $${idx++}`);
		values.push(data.reviewTaskId);
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
	if (data.dependsOn !== undefined) {
		fields.push(`depends_on = $${idx++}`);
		values.push(JSON.stringify(data.dependsOn));
	}
	if (data.riskLevel !== undefined) {
		fields.push(`risk_level = $${idx++}`);
		values.push(data.riskLevel);
	}
	if (data.policySnapshot !== undefined) {
		fields.push(`policy_snapshot = $${idx++}`);
		values.push(data.policySnapshot);
	}
	if (data.testExpectation !== undefined) {
		fields.push(`test_expectation = $${idx++}`);
		values.push(data.testExpectation);
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
 * Atomically claim a queued task for dispatch using SELECT FOR UPDATE SKIP LOCKED.
 * Returns the claimed task, or null if already claimed by another worker.
 * This prevents duplicate dispatch under concurrent workers.
 */
export async function claimTask(taskId: string, claimedBy: string): Promise<Task | null> {
	return withTransaction(async (client) => {
		// Lock the row — SKIP LOCKED means if another worker already holds this row, return nothing
		const lockResult = await client.query(
			`SELECT id
			 FROM tasks
			 WHERE id = $1
			   AND status = 'queued'
			   AND (
			     claimed_by IS NULL
			     OR claimed_at < now() - ($2::int * interval '1 second')
			   )
			 FOR UPDATE SKIP LOCKED`,
			[taskId, CLAIM_STALE_INTERVAL_SECONDS],
		);
		if (lockResult.rows.length === 0) return null;

		// Claim it
		const result = await client.query(
			`UPDATE tasks SET claimed_by = $1, claimed_at = now(), dispatch_attempts = dispatch_attempts + 1 WHERE id = $2 RETURNING *`,
			[claimedBy, taskId],
		);
		return result.rows[0] ? rowToTask(result.rows[0]) : null;
	});
}

/**
 * Release a task claim (e.g. after execution completes or fails).
 * Clears claimed_by/claimed_at so the task can be reclaimed on retry.
 */
export async function releaseTaskClaim(taskId: string): Promise<void> {
	await execute(`UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = $1`, [taskId]);
}

/**
 * Clears stale claims for queued tasks under a specific project.
 * This is used as a safety net at dispatch entry points after pause/resume or restart.
 */
export async function reclaimStaleQueuedClaimsForProject(
	projectId: string,
	staleAfterSeconds = CLAIM_STALE_INTERVAL_SECONDS,
): Promise<number> {
	const row = await queryOne<{ cnt: string }>(
		`WITH stale AS (
			 UPDATE tasks t
			 SET claimed_by = NULL, claimed_at = NULL
			 WHERE t.status = 'queued'
			   AND t.claimed_by IS NOT NULL
			   AND t.claimed_at < now() - ($2::int * interval '1 second')
			   AND t.phase_id IN (
			     SELECT ph.id
			     FROM phases ph
			     JOIN project_plans pp ON pp.id = ph.plan_id
			     WHERE pp.project_id = $1
			   )
			 RETURNING t.id
		 )
		 SELECT COUNT(*)::text AS cnt FROM stale`,
		[projectId, staleAfterSeconds],
	);
	const cleared = Number(row?.cnt ?? 0);
	if (cleared > 0) {
		log.warn(`[task-repo] Cleared ${cleared} stale queued claim(s) for project ${projectId}`);
	}
	return cleared;
}

/**
 * Claim multiple queued tasks at once for batch dispatch.
 * Uses SKIP LOCKED to avoid contention with concurrent workers.
 */
export async function claimReadyTasks(phaseId: string, claimedBy: string, limit: number): Promise<Task[]> {
	return withTransaction(async (client) => {
		const lockResult = await client.query(
			`SELECT id FROM tasks
			 WHERE phase_id = $1
			   AND status = 'queued'
			   AND (
			     claimed_by IS NULL
			     OR claimed_at < now() - ($3::int * interval '1 second')
			   )
			 ORDER BY id
			 LIMIT $2
			 FOR UPDATE SKIP LOCKED`,
			[phaseId, limit, CLAIM_STALE_INTERVAL_SECONDS],
		);
		if (lockResult.rows.length === 0) return [];

		const ids = lockResult.rows.map((r: any) => r.id);
		const placeholders = ids.map((_: string, i: number) => `$${i + 2}`).join(", ");

		const result = await client.query(
			`UPDATE tasks SET claimed_by = $1, claimed_at = now(), dispatch_attempts = dispatch_attempts + 1
			 WHERE id IN (${placeholders}) RETURNING *`,
			[claimedBy, ...ids],
		);
		return result.rows.map((r: any) => rowToTask(r));
	});
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
 * Atomic JSONB append — no read-modify-write, no race condition under concurrent callers.
 */
export async function appendTaskLogs(taskId: string, logs: string[]): Promise<void> {
	if (logs.length === 0) return;
	// jsonb_set atomically splices the new log entries into the existing array.
	// COALESCE ensures a well-formed default when output is NULL.
	// The || operator concatenates jsonb arrays server-side — no JS read required.
	await execute(
		`UPDATE tasks SET output = jsonb_set(
			COALESCE(output::jsonb, '{"filesCreated":[],"filesModified":[],"logs":[]}'::jsonb),
			'{logs}',
			COALESCE(output::jsonb -> 'logs', '[]'::jsonb) || $1::jsonb
		) WHERE id = $2`,
		[JSON.stringify(logs), taskId],
	);
}

// ---------------------------------------------------------------------------
// Aggregate Queries (extracted from consumer modules — repo pattern enforcement)
// ---------------------------------------------------------------------------

/** Count failed tasks in a phase. Used by execution-engine replan trigger. */
export async function getFailedTaskCountInPhase(phaseId: string): Promise<number> {
	const row = await queryOne<{ cnt: number }>(
		`SELECT COUNT(*) AS cnt FROM tasks WHERE phase_id = $1 AND status = 'failed'`,
		[phaseId],
	);
	return Number(row?.cnt ?? 0);
}

/**
 * Resolve the owning project_id for a given task through the phase→plan→project chain.
 * Used by task-engine for project lookup with caching.
 */
export async function getProjectIdForTaskViaJoin(taskId: string): Promise<string | undefined> {
	const row = await queryOne<{ project_id: string }>(
		`SELECT COALESCE(t.project_id, pp.project_id) AS project_id
		 FROM tasks t
		 JOIN phases p ON t.phase_id = p.id
		 JOIN project_plans pp ON p.plan_id = pp.id
		 WHERE t.id = $1`,
		[taskId],
	);
	return row?.project_id;
}

/**
 * Batch-update depends_on JSON for a task.
 * Used by pm-agent when wiring task dependency edges after plan creation.
 */
export async function updateTaskDependencies(taskId: string, dependsOn: string[]): Promise<void> {
	await execute("UPDATE tasks SET depends_on = $1 WHERE id = $2", [JSON.stringify(dependsOn), taskId]);
}
