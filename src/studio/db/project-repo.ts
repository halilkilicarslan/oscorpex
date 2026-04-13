// ---------------------------------------------------------------------------
// Oscorpex — Project Repository: Project + Plan + Phase CRUD
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import type { Phase, PhaseStatus, PlanStatus, Project, ProjectPlan } from "../types.js";
import { now, rowToPhase, rowToProject } from "./helpers.js";
import { listTasks } from "./task-repo.js";

// ---------------------------------------------------------------------------
// Projects CRUD
// ---------------------------------------------------------------------------

export async function createProject(
	data: Pick<Project, "name" | "description" | "techStack" | "repoPath">,
): Promise<Project> {
	const id = randomUUID();
	const ts = now();
	await execute(
		`
    INSERT INTO projects (id, name, description, status, tech_stack, repo_path, created_at, updated_at)
    VALUES ($1, $2, $3, 'planning', $4, $5, $6, $7)
  `,
		[id, data.name, data.description, JSON.stringify(data.techStack), data.repoPath, ts, ts],
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
	const rows = await query<any>('SELECT * FROM phases WHERE plan_id = $1 ORDER BY "order"', [planId]);
	return Promise.all(
		rows.map(async (row) => {
			const tasks = await listTasks(row.id);
			return rowToPhase(row, tasks);
		}),
	);
}

export async function updatePhaseStatus(id: string, status: PhaseStatus): Promise<void> {
	await execute("UPDATE phases SET status = $1 WHERE id = $2", [status, id]);
}
