// ---------------------------------------------------------------------------
// Oscorpex — Sprint Manager (v3.9)
// CRUD and lifecycle management for Scrum sprints.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { now, rowToSprint } from "./db.js";
import { execute, getPool, query, queryOne } from "./pg.js";
import type { Sprint, SprintStatus } from "./types.js";

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createSprint(
	projectId: string,
	data: { name: string; goal?: string; startDate: string; endDate: string },
): Promise<Sprint> {
	const id = randomUUID();
	const createdAt = now();

	await execute(
		`INSERT INTO sprints (id, project_id, name, goal, start_date, end_date, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'planned', $7)`,
		[id, projectId, data.name, data.goal ?? null, data.startDate, data.endDate, createdAt],
	);

	return {
		id,
		projectId,
		name: data.name,
		goal: data.goal,
		startDate: data.startDate,
		endDate: data.endDate,
		status: "planned",
		createdAt,
	};
}

export async function getSprint(id: string): Promise<Sprint | null> {
	const row = await queryOne<any>("SELECT * FROM sprints WHERE id = $1", [id]);
	return row ? rowToSprint(row) : null;
}

export async function getSprintsByProject(projectId: string): Promise<Sprint[]> {
	const rows = await query<any>(
		"SELECT * FROM sprints WHERE project_id = $1 ORDER BY start_date ASC",
		[projectId],
	);
	return rows.map(rowToSprint);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Activate a sprint. Validates that no other sprint in the project is active.
 */
export async function startSprint(id: string): Promise<Sprint> {
	const sprint = await getSprint(id);
	if (!sprint) throw new Error(`Sprint ${id} not found`);
	if (sprint.status !== "planned") {
		throw new Error(`Sprint ${id} is not in 'planned' state (current: ${sprint.status})`);
	}

	// Ensure no other sprint is active for this project
	const activeSprint = await queryOne<any>(
		"SELECT id FROM sprints WHERE project_id = $1 AND status = 'active'",
		[sprint.projectId],
	);
	if (activeSprint) {
		throw new Error(`Project ${sprint.projectId} already has an active sprint (${activeSprint.id})`);
	}

	await execute("UPDATE sprints SET status = 'active' WHERE id = $1", [id]);
	return { ...sprint, status: "active" };
}

export async function completeSprint(id: string): Promise<Sprint> {
	const sprint = await getSprint(id);
	if (!sprint) throw new Error(`Sprint ${id} not found`);
	await execute("UPDATE sprints SET status = 'completed' WHERE id = $1", [id]);
	return { ...sprint, status: "completed" };
}

export async function cancelSprint(id: string): Promise<Sprint> {
	const sprint = await getSprint(id);
	if (!sprint) throw new Error(`Sprint ${id} not found`);
	await execute("UPDATE sprints SET status = 'cancelled' WHERE id = $1", [id]);
	return { ...sprint, status: "cancelled" };
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * Calculate burndown data for a sprint.
 * Groups work_items by their updated_at date and counts remaining open items.
 */
export async function calculateBurndown(
	sprintId: string,
): Promise<{ date: string; remaining: number }[]> {
	// Sprint penceresinde (startDate..min(endDate, today)) her gün icin
	// o gune kadar sprint'e girmis ve o gunde henuz tamamlanmamis is sayisini dondur.
	// Yaklasim: bir item "tamamlanmis" sayilir eger current status done/closed/wontfix VE
	// updated_at <= guncel gun ise. Aksi halde aktif sayilir.
	const sprint = await queryOne<{ start_date: string; end_date: string }>(
		`SELECT start_date, end_date FROM sprints WHERE id = $1`,
		[sprintId],
	);
	if (!sprint) return [];

	const rows = await query<{ date: string; remaining: string }>(
		`WITH series AS (
       SELECT generate_series(
         $2::date,
         LEAST($3::date, NOW()::date),
         INTERVAL '1 day'
       )::date AS d
     )
     SELECT to_char(s.d, 'YYYY-MM-DD') AS date,
            COUNT(w.id)::text AS remaining
     FROM series s
     LEFT JOIN work_items w
       ON w.sprint_id = $1
       AND w.created_at::date <= s.d
       AND (
         w.status NOT IN ('done', 'closed', 'wontfix')
         OR w.updated_at::date > s.d
       )
     GROUP BY s.d
     ORDER BY s.d ASC`,
		[sprintId, sprint.start_date, sprint.end_date],
	);

	return rows.map((r) => ({ date: r.date, remaining: Number(r.remaining) }));
}

/**
 * Calculate average velocity (completed work items per sprint) for a project.
 * @param lastN - limit to last N completed sprints (default: all)
 */
export async function calculateVelocity(projectId: string, lastN?: number): Promise<number> {
	const limitClause = lastN != null ? `LIMIT ${Number(lastN)}` : "";

	const sprintRows = await query<{ id: string }>(
		`SELECT id FROM sprints
     WHERE project_id = $1 AND status = 'completed'
     ORDER BY end_date DESC
     ${limitClause}`,
		[projectId],
	);

	if (sprintRows.length === 0) return 0;

	const sprintIds = sprintRows.map((r) => r.id);

	const countRow = await queryOne<{ total: string; sprint_count: string }>(
		`SELECT
       COUNT(*) FILTER (WHERE status IN ('done', 'closed')) AS total,
       COUNT(DISTINCT sprint_id) AS sprint_count
     FROM work_items
     WHERE sprint_id = ANY($1::text[])`,
		[sprintIds],
	);

	if (!countRow || Number(countRow.sprint_count) === 0) return 0;

	return Math.round(Number(countRow.total) / Number(countRow.sprint_count));
}


// ---------------------------------------------------------------------------
// Per-sprint velocity: tamamlanmis is sayisi (done/closed)
// ---------------------------------------------------------------------------

export async function calculateSprintVelocity(sprintId: string): Promise<number> {
	const row = await queryOne<{ total: string }>(
		`SELECT COUNT(*)::text AS total
     FROM work_items
     WHERE sprint_id = $1 AND status IN ('done', 'closed')`,
		[sprintId],
	);
	return row ? Number(row.total) : 0;
}
