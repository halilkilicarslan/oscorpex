// ---------------------------------------------------------------------------
// F3-a — two-tenant fixtures for background sweepers: one running project per tenant that is visible to
// sys_running_projects() / sys_running_project_phases(). Deterministic ids, idempotent.
// ---------------------------------------------------------------------------

import type pg from "pg";
import { TENANT_A, TENANT_B, withMigrator } from "./tenancy.js";

export interface RunningProjectFixture {
	tenantId: string;
	projectId: string;
	pipelineRunId: string;
	planId: string;
	phaseId: string;
	taskId: string;
}

function fixture(tenantId: string, key: string): RunningProjectFixture {
	return {
		tenantId,
		projectId: `f3a-bg-project-${key}`,
		pipelineRunId: `f3a-bg-run-${key}`,
		planId: `f3a-bg-plan-${key}`,
		phaseId: `f3a-bg-phase-${key}`,
		taskId: `f3a-bg-task-${key}`,
	};
}

const FIXTURES = { A: fixture(TENANT_A, "a"), B: fixture(TENANT_B, "b") };

function runtimeDatabaseName(): string {
	return decodeURIComponent(new URL(process.env.DATABASE_URL as string).pathname.replace(/^\//, ""));
}

async function assertTestDatabase(c: pg.Client): Promise<void> {
	const r = await c.query<{ db: string }>("SELECT current_database() AS db");
	const db = r.rows[0]?.db ?? "";
	if (db !== runtimeDatabaseName() || !db.includes("test")) {
		throw new Error(`Refusing to seed fixtures: migrator database "${db}" must equal the runtime test database`);
	}
}

export async function seedRunningProjects(): Promise<{ A: RunningProjectFixture; B: RunningProjectFixture }> {
	await withMigrator(async (c) => {
		await assertTestDatabase(c);
		for (const f of Object.values(FIXTURES)) {
			await c.query(
				`INSERT INTO projects (id, name, status, created_at, updated_at, tenant_id)
				 VALUES ($1, $2, 'running', now(), now(), $3) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, tenant_id = EXCLUDED.tenant_id`,
				[f.projectId, `F3-a ${f.projectId}`, f.tenantId],
			);
			await c.query(
				`INSERT INTO pipeline_runs (id, project_id, status, created_at)
				 VALUES ($1, $2, 'running', now()::text)
				 ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, project_id = EXCLUDED.project_id`,
				[f.pipelineRunId, f.projectId],
			);
			await c.query(
				`INSERT INTO project_plans (id, project_id, status, created_at, tenant_id)
				 VALUES ($1, $2, 'approved', now(), $3)
				 ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, tenant_id = EXCLUDED.tenant_id`,
				[f.planId, f.projectId, f.tenantId],
			);
			await c.query(
				`INSERT INTO phases (id, plan_id, name, "order", status, tenant_id)
				 VALUES ($1, $2, 'F3-a phase', 1, 'running', $3)
				 ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, tenant_id = EXCLUDED.tenant_id`,
				[f.phaseId, f.planId, f.tenantId],
			);
			await c.query(
				`INSERT INTO tasks (id, phase_id, project_id, title, status, tenant_id)
				 VALUES ($1, $2, $3, 'F3-a task', 'queued', $4)
				 ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, project_id = EXCLUDED.project_id,
				   tenant_id = EXCLUDED.tenant_id`,
				[f.taskId, f.phaseId, f.projectId, f.tenantId],
			);
		}
	});
	return FIXTURES;
}

export async function cleanupRunningProjects(): Promise<void> {
	const fs = Object.values(FIXTURES);
	await withMigrator(async (c) => {
		await c.query("DELETE FROM tasks WHERE id = ANY($1)", [fs.map((f) => f.taskId)]);
		await c.query("DELETE FROM phases WHERE id = ANY($1)", [fs.map((f) => f.phaseId)]);
		await c.query("DELETE FROM project_plans WHERE id = ANY($1)", [fs.map((f) => f.planId)]);
		await c.query("DELETE FROM pipeline_runs WHERE id = ANY($1)", [fs.map((f) => f.pipelineRunId)]);
		await c.query("DELETE FROM projects WHERE id = ANY($1)", [fs.map((f) => f.projectId)]);
	});
}
