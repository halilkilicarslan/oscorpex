// ---------------------------------------------------------------------------
// Oscorpex — CI Tracking Repo (V6 M3)
// CRUD for ci_trackings table — GitHub/GitLab PR/MR CI status persistence.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CIProvider = "github" | "gitlab";
export type CIStatus = "pending" | "running" | "success" | "failure" | "cancelled";

export interface CITracking {
	id: string;
	projectId: string;
	provider: CIProvider;
	prId: string;
	prUrl: string | null;
	status: CIStatus;
	details: Record<string, unknown>;
	pipelineUrl: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CreateCITrackingData {
	projectId: string;
	provider: CIProvider;
	prId: string;
	prUrl?: string | null;
	status?: CIStatus;
	details?: Record<string, unknown>;
	pipelineUrl?: string | null;
}

export interface UpdateCITrackingData {
	status?: CIStatus;
	details?: Record<string, unknown>;
	pipelineUrl?: string | null;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToCITracking(row: Record<string, unknown>): CITracking {
	return {
		id: row.id as string,
		projectId: row.project_id as string,
		provider: row.provider as CIProvider,
		prId: row.pr_id as string,
		prUrl: (row.pr_url as string | null) ?? null,
		status: row.status as CIStatus,
		details: (row.details as Record<string, unknown>) ?? {},
		pipelineUrl: (row.pipeline_url as string | null) ?? null,
		createdAt: row.created_at as string,
		updatedAt: row.updated_at as string,
	};
}

// ---------------------------------------------------------------------------
// createCITracking
// ---------------------------------------------------------------------------

export async function createCITracking(data: CreateCITrackingData): Promise<CITracking> {
	const id = randomUUID();
	const row = await queryOne<Record<string, unknown>>(
		`INSERT INTO ci_trackings
		 (id, project_id, provider, pr_id, pr_url, status, details, pipeline_url)
		 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
		 RETURNING *`,
		[
			id,
			data.projectId,
			data.provider,
			data.prId,
			data.prUrl ?? null,
			data.status ?? "pending",
			JSON.stringify(data.details ?? {}),
			data.pipelineUrl ?? null,
		],
	);
	if (!row) throw new Error("ci_trackings insert returned no row");
	return rowToCITracking(row);
}

// ---------------------------------------------------------------------------
// updateCITracking
// ---------------------------------------------------------------------------

export async function updateCITracking(id: string, data: UpdateCITrackingData): Promise<CITracking> {
	const sets: string[] = ["updated_at = now()"];
	const params: unknown[] = [];
	let idx = 1;

	if (data.status !== undefined) {
		sets.push(`status = $${idx++}`);
		params.push(data.status);
	}
	if (data.details !== undefined) {
		sets.push(`details = $${idx++}::jsonb`);
		params.push(JSON.stringify(data.details));
	}
	if (data.pipelineUrl !== undefined) {
		sets.push(`pipeline_url = $${idx++}`);
		params.push(data.pipelineUrl);
	}

	params.push(id);
	const row = await queryOne<Record<string, unknown>>(
		`UPDATE ci_trackings SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
		params,
	);
	if (!row) throw new Error(`ci_tracking not found: ${id}`);
	return rowToCITracking(row);
}

// ---------------------------------------------------------------------------
// getCITrackings — list for a project
// ---------------------------------------------------------------------------

export async function getCITrackings(projectId: string): Promise<CITracking[]> {
	const rows = await query<Record<string, unknown>>(
		`SELECT * FROM ci_trackings WHERE project_id = $1 ORDER BY created_at DESC`,
		[projectId],
	);
	return rows.map(rowToCITracking);
}

// ---------------------------------------------------------------------------
// getCITracking — single by id
// ---------------------------------------------------------------------------

export async function getCITracking(id: string): Promise<CITracking | null> {
	const row = await queryOne<Record<string, unknown>>(
		`SELECT * FROM ci_trackings WHERE id = $1`,
		[id],
	);
	return row ? rowToCITracking(row) : null;
}

// ---------------------------------------------------------------------------
// deleteCITracking
// ---------------------------------------------------------------------------

export async function deleteCITracking(id: string): Promise<void> {
	await execute(`DELETE FROM ci_trackings WHERE id = $1`, [id]);
}
