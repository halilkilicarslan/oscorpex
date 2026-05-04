// ---------------------------------------------------------------------------
// Oscorpex — Project Repository: Project + Plan + Phase CRUD
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { createLogger } from "../logger.js";
import { execute, query, queryOne } from "../pg.js";
import type { Phase, PhaseStatus, PlanStatus, Project, ProjectPlan } from "../types.js";
import { now, rowToPhase, rowToProject, rowToTask } from "./helpers.js";
const log = createLogger("project-repo");

// ---------------------------------------------------------------------------
// Projects CRUD
// ---------------------------------------------------------------------------

export async function createProject(
	data: Pick<Project, "name" | "description" | "techStack" | "repoPath"> & {
		tenantId?: string | null;
		ownerId?: string | null;
	},
): Promise<Project> {
	const id = randomUUID();
	const ts = now();
	await execute(
		`
    INSERT INTO projects (id, name, description, status, tech_stack, repo_path, tenant_id, owner_id, created_at, updated_at)
    VALUES ($1, $2, $3, 'planning', $4, $5, $6, $7, $8, $9)
  `,
		[
			id,
			data.name,
			data.description,
			JSON.stringify(data.techStack),
			data.repoPath,
			data.tenantId ?? null,
			data.ownerId ?? null,
			ts,
			ts,
		],
	);
	return (await getProject(id))!;
}

export async function getProject(id: string): Promise<Project | undefined> {
	const row = await queryOne<any>("SELECT * FROM projects WHERE id = $1", [id]);
	return row ? rowToProject(row) : undefined;
}

export async function listProjects(): Promise<Project[]> {
	const rows = await query<any>("SELECT * FROM projects ORDER BY created_at DESC");
	return rows.map(rowToProject);
}

/** List only projects with a specific status — avoids loading all rows for targeted queries. */
export async function listProjectsByStatus(status: string): Promise<Project[]> {
	const rows = await query<any>("SELECT * FROM projects WHERE status = $1 ORDER BY created_at DESC", [status]);
	return rows.map(rowToProject);
}

export async function listProjectsPaginated(
	limit: number,
	offset: number,
	tenantId?: string | null,
): Promise<[Project[], number]> {
	// Single query with COUNT(*) OVER() window function eliminates the extra COUNT roundtrip
	if (tenantId) {
		const rows = await query<any>(
			"SELECT *, COUNT(*) OVER() AS _total FROM projects WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
			[tenantId, limit, offset],
		);
		const total = Number(rows[0]?._total ?? 0);
		return [rows.map(rowToProject), total];
	}
	const rows = await query<any>(
		"SELECT *, COUNT(*) OVER() AS _total FROM projects ORDER BY created_at DESC LIMIT $1 OFFSET $2",
		[limit, offset],
	);
	const total = Number(rows[0]?._total ?? 0);
	return [rows.map(rowToProject), total];
}

export async function updateProject(
	id: string,
	data: Partial<Pick<Project, "name" | "description" | "status" | "techStack" | "repoPath">>,
): Promise<Project | undefined> {
	const fields: string[] = [];
	const values: any[] = [];
	let idx = 1;

	if (data.name !== undefined) {
		fields.push(`name = $${idx++}`);
		values.push(data.name);
	}
	if (data.description !== undefined) {
		fields.push(`description = $${idx++}`);
		values.push(data.description);
	}
	if (data.status !== undefined) {
		fields.push(`status = $${idx++}`);
		values.push(data.status);
	}
	if (data.techStack !== undefined) {
		fields.push(`tech_stack = $${idx++}`);
		values.push(JSON.stringify(data.techStack));
	}
	if (data.repoPath !== undefined) {
		fields.push(`repo_path = $${idx++}`);
		values.push(data.repoPath);
	}

	if (fields.length === 0) return getProject(id);

	fields.push(`updated_at = $${idx++}`);
	values.push(now());
	values.push(id);

	await execute(`UPDATE projects SET ${fields.join(", ")} WHERE id = $${idx}`, values);
	return getProject(id);
}

export async function deleteProject(id: string): Promise<boolean> {
	const result = await execute("DELETE FROM projects WHERE id = $1", [id]);
	return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Plans CRUD
// ---------------------------------------------------------------------------

export async function createPlan(projectId: string): Promise<ProjectPlan> {
	const id = randomUUID();
	const maxRow = await queryOne<any>("SELECT MAX(version) as v FROM project_plans WHERE project_id = $1", [projectId]);
	const version = (maxRow?.v ?? 0) + 1;
	const ts = now();

	await execute(
		`
    INSERT INTO project_plans (id, project_id, version, status, created_at)
    VALUES ($1, $2, $3, 'draft', $4)
  `,
		[id, projectId, version, ts],
	);

	return { id, projectId, version, status: "draft", phases: [], createdAt: ts };
}

export async function getPlan(id: string): Promise<ProjectPlan | undefined> {
	const row = await queryOne<any>("SELECT * FROM project_plans WHERE id = $1", [id]);
	if (!row) return undefined;
	const phases = await listPhases(id);
	return {
		id: row.id,
		projectId: row.project_id,
		version: row.version,
		status: row.status as PlanStatus,
		phases,
		createdAt: row.created_at,
	};
}

export async function getLatestPlan(projectId: string): Promise<ProjectPlan | undefined> {
	const row = await queryOne<any>("SELECT * FROM project_plans WHERE project_id = $1 ORDER BY version DESC LIMIT 1", [
		projectId,
	]);
	if (!row) return undefined;
	return getPlan(row.id);
}

export async function updatePlanStatus(id: string, status: PlanStatus): Promise<void> {
	await execute("UPDATE project_plans SET status = $1 WHERE id = $2", [status, id]);
}

// ---------------------------------------------------------------------------
// Phases CRUD
// ---------------------------------------------------------------------------

export async function createPhase(data: Pick<Phase, "planId" | "name" | "order" | "dependsOn">): Promise<Phase> {
	const id = randomUUID();
	await execute(
		`
    INSERT INTO phases (id, plan_id, name, "order", status, depends_on)
    VALUES ($1, $2, $3, $4, 'pending', $5)
  `,
		[id, data.planId, data.name, data.order, JSON.stringify(data.dependsOn)],
	);
	return {
		id,
		planId: data.planId,
		name: data.name,
		order: data.order,
		status: "pending",
		tasks: [],
		dependsOn: data.dependsOn,
	};
}

export async function listPhases(planId: string): Promise<Phase[]> {
	const rows = await query<any>(
		`SELECT
			p.id          AS p_id,
			p.plan_id     AS p_plan_id,
			p.name        AS p_name,
			p."order"     AS p_order,
			p.status      AS p_status,
			p.depends_on  AS p_depends_on,
			t.id                       AS id,
			t.phase_id                 AS phase_id,
			t.title                    AS title,
			t.description              AS description,
			t.assigned_agent           AS assigned_agent,
			t.status                   AS status,
			t.complexity               AS complexity,
			t.depends_on               AS depends_on,
			t.branch                   AS branch,
			t.task_type                AS task_type,
			t.output                   AS output,
			t.retry_count              AS retry_count,
			t.error                    AS error,
			t.started_at               AS started_at,
			t.completed_at             AS completed_at,
			t.review_status            AS review_status,
			t.reviewer_agent_id        AS reviewer_agent_id,
			t.review_task_id           AS review_task_id,
			t.revision_count           AS revision_count,
			t.assigned_agent_id        AS assigned_agent_id,
			t.requires_approval        AS requires_approval,
			t.approval_status          AS approval_status,
			t.approval_rejection_reason AS approval_rejection_reason,
			t.parent_task_id           AS parent_task_id,
			t.target_files             AS target_files,
			t.estimated_lines          AS estimated_lines
		FROM phases p
		LEFT JOIN tasks t ON t.phase_id = p.id
		WHERE p.plan_id = $1
		ORDER BY p."order", t.id`,
		[planId],
	);

	const phaseMap = new Map<string, { phaseRow: any; taskRows: any[] }>();

	for (const row of rows) {
		const phaseId: string = row.p_id;
		if (!phaseMap.has(phaseId)) {
			phaseMap.set(phaseId, {
				phaseRow: {
					id: row.p_id,
					plan_id: row.p_plan_id,
					name: row.p_name,
					order: row.p_order,
					status: row.p_status,
					depends_on: row.p_depends_on,
				},
				taskRows: [],
			});
		}
		// LEFT JOIN produces a NULL task row when the phase has no tasks
		if (row.id !== null) {
			phaseMap.get(phaseId)!.taskRows.push(row);
		}
	}

	return Array.from(phaseMap.values()).map(({ phaseRow, taskRows }) => rowToPhase(phaseRow, taskRows.map(rowToTask)));
}

export async function updatePhaseStatus(id: string, status: PhaseStatus): Promise<void> {
	await execute("UPDATE phases SET status = $1 WHERE id = $2", [status, id]);
}

// ---------------------------------------------------------------------------
// Batch loader — eliminates N+1 queries in startup recovery
// ---------------------------------------------------------------------------

/**
 * Returns all running projects together with their latest approved plan and its
 * phases (including tasks) in a single SQL query.  Used by execution-recovery
 * to avoid issuing 2 × N queries on startup when there are N running projects.
 *
 * Grouping strategy:
 *  1. Collect the latest `approved` plan per project (window rank = 1).
 *  2. LEFT JOIN phases and tasks so projects without an approved plan still
 *     appear in the result (with plan = null, phases = []).
 *  3. Group rows back into the nested { project, plan, phases } shape in TS.
 */
export async function getRunningProjectsWithPlans(): Promise<
	Array<{
		project: Project;
		plan: ProjectPlan | null;
		phases: Phase[];
	}>
> {
	const rows = await query<any>(
		`
		WITH latest_plans AS (
			SELECT *,
				ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY version DESC) AS rn
			FROM project_plans
			WHERE status = 'approved'
		)
		SELECT
			proj.id             AS proj_id,
			proj.name           AS proj_name,
			proj.description    AS proj_description,
			proj.status         AS proj_status,
			proj.tech_stack     AS proj_tech_stack,
			proj.repo_path      AS proj_repo_path,
			proj.tenant_id      AS proj_tenant_id,
			proj.owner_id       AS proj_owner_id,
			proj.created_at     AS proj_created_at,
			proj.updated_at     AS proj_updated_at,

			pp.id               AS plan_id,
			pp.project_id       AS plan_project_id,
			pp.version          AS plan_version,
			pp.status           AS plan_status,
			pp.created_at       AS plan_created_at,

			ph.id               AS ph_id,
			ph.plan_id          AS ph_plan_id,
			ph.name             AS ph_name,
			ph."order"          AS ph_order,
			ph.status           AS ph_status,
			ph.depends_on       AS ph_depends_on,

			t.id                       AS t_id,
			t.phase_id                 AS t_phase_id,
			t.title                    AS t_title,
			t.description              AS t_description,
			t.assigned_agent           AS t_assigned_agent,
			t.status                   AS t_status,
			t.complexity               AS t_complexity,
			t.depends_on               AS t_depends_on,
			t.branch                   AS t_branch,
			t.task_type                AS t_task_type,
			t.output                   AS t_output,
			t.retry_count              AS t_retry_count,
			t.error                    AS t_error,
			t.started_at               AS t_started_at,
			t.completed_at             AS t_completed_at,
			t.review_status            AS t_review_status,
			t.reviewer_agent_id        AS t_reviewer_agent_id,
			t.review_task_id           AS t_review_task_id,
			t.revision_count           AS t_revision_count,
			t.assigned_agent_id        AS t_assigned_agent_id,
			t.requires_approval        AS t_requires_approval,
			t.approval_status          AS t_approval_status,
			t.approval_rejection_reason AS t_approval_rejection_reason,
			t.parent_task_id           AS t_parent_task_id,
			t.target_files             AS t_target_files,
			t.estimated_lines          AS t_estimated_lines,
			t.project_id               AS t_project_id,
			t.risk_level               AS t_risk_level,
			t.policy_snapshot          AS t_policy_snapshot,
			t.created_at               AS t_created_at
		FROM projects proj
		LEFT JOIN latest_plans pp ON pp.project_id = proj.id AND pp.rn = 1
		LEFT JOIN phases ph ON ph.plan_id = pp.id
		LEFT JOIN tasks t ON t.phase_id = ph.id
		WHERE proj.status = 'running'
		ORDER BY proj.id, pp.version DESC, ph."order", t.id
		`,
	);

	// ---- Group flat rows into nested { project, plan, phases } buckets -----

	// Outer map: projectId → { project row, plan row | null, phaseId → { phase row, task rows[] } }
	const projectMap = new Map<
		string,
		{
			projectRow: any;
			planRow: any | null;
			phaseMap: Map<string, { phaseRow: any; taskRows: any[] }>;
		}
	>();

	for (const row of rows) {
		const projectId: string = row.proj_id;

		if (!projectMap.has(projectId)) {
			projectMap.set(projectId, {
				projectRow: {
					id: row.proj_id,
					name: row.proj_name,
					description: row.proj_description,
					status: row.proj_status,
					tech_stack: row.proj_tech_stack,
					repo_path: row.proj_repo_path,
					tenant_id: row.proj_tenant_id,
					owner_id: row.proj_owner_id,
					created_at: row.proj_created_at,
					updated_at: row.proj_updated_at,
				},
				planRow: row.plan_id
					? {
							id: row.plan_id,
							project_id: row.plan_project_id,
							version: row.plan_version,
							status: row.plan_status,
							created_at: row.plan_created_at,
					  }
					: null,
				phaseMap: new Map(),
			});
		}

		const bucket = projectMap.get(projectId)!;

		// No approved plan → no phases
		if (row.ph_id === null) continue;

		const phaseId: string = row.ph_id;
		if (!bucket.phaseMap.has(phaseId)) {
			bucket.phaseMap.set(phaseId, {
				phaseRow: {
					id: row.ph_id,
					plan_id: row.ph_plan_id,
					name: row.ph_name,
					order: row.ph_order,
					status: row.ph_status,
					depends_on: row.ph_depends_on,
				},
				taskRows: [],
			});
		}

		// LEFT JOIN produces a NULL task row when the phase has no tasks
		if (row.t_id !== null) {
			bucket.phaseMap.get(phaseId)!.taskRows.push({
				id: row.t_id,
				phase_id: row.t_phase_id,
				title: row.t_title,
				description: row.t_description,
				assigned_agent: row.t_assigned_agent,
				status: row.t_status,
				complexity: row.t_complexity,
				depends_on: row.t_depends_on,
				branch: row.t_branch,
				task_type: row.t_task_type,
				output: row.t_output,
				retry_count: row.t_retry_count,
				error: row.t_error,
				started_at: row.t_started_at,
				completed_at: row.t_completed_at,
				review_status: row.t_review_status,
				reviewer_agent_id: row.t_reviewer_agent_id,
				review_task_id: row.t_review_task_id,
				revision_count: row.t_revision_count,
				assigned_agent_id: row.t_assigned_agent_id,
				requires_approval: row.t_requires_approval,
				approval_status: row.t_approval_status,
				approval_rejection_reason: row.t_approval_rejection_reason,
				parent_task_id: row.t_parent_task_id,
				target_files: row.t_target_files,
				estimated_lines: row.t_estimated_lines,
				project_id: row.t_project_id,
				risk_level: row.t_risk_level,
				policy_snapshot: row.t_policy_snapshot,
				created_at: row.t_created_at,
			});
		}
	}

	// ---- Map buckets to the typed return shape ----------------------------

	return Array.from(projectMap.values()).map(({ projectRow, planRow, phaseMap }) => {
		const phases = Array.from(phaseMap.values()).map(({ phaseRow, taskRows }) =>
			rowToPhase(phaseRow, taskRows.map(rowToTask)),
		);

		const plan: ProjectPlan | null = planRow
			? {
					id: planRow.id,
					projectId: planRow.project_id,
					version: planRow.version,
					status: planRow.status as PlanStatus,
					phases,
					createdAt: planRow.created_at,
			  }
			: null;

		return {
			project: rowToProject(projectRow),
			plan,
			phases,
		};
	});
}
