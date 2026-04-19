// ---------------------------------------------------------------------------
// Oscorpex — Template Repo (V6 M3)
// CRUD for custom project templates persisted in the DB.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectTemplate {
	id: string;
	name: string;
	description: string;
	category: string;
	techStack: string[];
	agentConfig: Record<string, unknown>;
	phases: unknown[];
	isPublic: boolean;
	authorId: string | null;
	usageCount: number;
	rating: number;
	createdAt: string;
	updatedAt: string;
}

export interface CreateTemplateData {
	name: string;
	description?: string;
	category?: string;
	techStack?: string[];
	agentConfig?: Record<string, unknown>;
	phases?: unknown[];
	isPublic?: boolean;
	authorId?: string | null;
}

export interface UpdateTemplateData {
	name?: string;
	description?: string;
	category?: string;
	techStack?: string[];
	agentConfig?: Record<string, unknown>;
	phases?: unknown[];
	isPublic?: boolean;
}

export interface ListTemplatesOpts {
	category?: string;
	search?: string;
	authorId?: string;
	isPublic?: boolean;
	limit?: number;
	offset?: number;
}

// ---------------------------------------------------------------------------
// Row → Model mapper
// ---------------------------------------------------------------------------

function rowToTemplate(row: Record<string, unknown>): ProjectTemplate {
	return {
		id: row.id as string,
		name: row.name as string,
		description: (row.description as string) ?? "",
		category: (row.category as string) ?? "fullstack",
		techStack: (row.tech_stack as string[]) ?? [],
		agentConfig: (row.agent_config as Record<string, unknown>) ?? {},
		phases: (row.phases as unknown[]) ?? [],
		isPublic: Boolean(row.is_public),
		authorId: (row.author_id as string | null) ?? null,
		usageCount: Number(row.usage_count ?? 0),
		rating: Number(row.rating ?? 0),
		createdAt: row.created_at as string,
		updatedAt: row.updated_at as string,
	};
}

// ---------------------------------------------------------------------------
// createTemplate
// ---------------------------------------------------------------------------

export async function createTemplate(data: CreateTemplateData): Promise<ProjectTemplate> {
	const id = randomUUID();
	const now = new Date().toISOString();
	const row = await queryOne<Record<string, unknown>>(
		`INSERT INTO project_templates
		 (id, name, description, category, tech_stack, agent_config, phases, is_public, author_id, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		 RETURNING *`,
		[
			id,
			data.name,
			data.description ?? "",
			data.category ?? "fullstack",
			JSON.stringify(data.techStack ?? []),
			JSON.stringify(data.agentConfig ?? {}),
			JSON.stringify(data.phases ?? []),
			data.isPublic !== false,
			data.authorId ?? null,
			now,
			now,
		],
	);
	if (!row) throw new Error("template insert returned no row");
	return rowToTemplate(row);
}

// ---------------------------------------------------------------------------
// listTemplates
// ---------------------------------------------------------------------------

export async function listTemplates(opts: ListTemplatesOpts = {}): Promise<ProjectTemplate[]> {
	const { category, search, authorId, isPublic, limit = 50, offset = 0 } = opts;
	const conditions: string[] = [];
	const params: unknown[] = [];
	let idx = 1;

	if (category) {
		conditions.push(`category = $${idx++}`);
		params.push(category);
	}
	if (search) {
		conditions.push(`(name ILIKE $${idx} OR description ILIKE $${idx})`);
		params.push(`%${search}%`);
		idx++;
	}
	if (authorId !== undefined) {
		conditions.push(`author_id = $${idx++}`);
		params.push(authorId);
	}
	if (isPublic !== undefined) {
		conditions.push(`is_public = $${idx++}`);
		params.push(isPublic);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	params.push(limit, offset);

	const rows = await query<Record<string, unknown>>(
		`SELECT * FROM project_templates ${where} ORDER BY usage_count DESC, created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
		params,
	);
	return rows.map(rowToTemplate);
}

// ---------------------------------------------------------------------------
// countTemplates — used for X-Total-Count pagination header
// ---------------------------------------------------------------------------

export async function countTemplates(opts: Omit<ListTemplatesOpts, "limit" | "offset"> = {}): Promise<number> {
	const { category, search, authorId, isPublic } = opts;
	const conditions: string[] = [];
	const params: unknown[] = [];
	let idx = 1;

	if (category) {
		conditions.push(`category = $${idx++}`);
		params.push(category);
	}
	if (search) {
		conditions.push(`(name ILIKE $${idx} OR description ILIKE $${idx})`);
		params.push(`%${search}%`);
		idx++;
	}
	if (authorId !== undefined) {
		conditions.push(`author_id = $${idx++}`);
		params.push(authorId);
	}
	if (isPublic !== undefined) {
		conditions.push(`is_public = $${idx++}`);
		params.push(isPublic);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const row = await queryOne<{ count: string }>(
		`SELECT COUNT(*) AS count FROM project_templates ${where}`,
		params,
	);
	return Number(row?.count ?? 0);
}

// ---------------------------------------------------------------------------
// getTemplate
// ---------------------------------------------------------------------------

export async function getTemplate(id: string): Promise<ProjectTemplate | null> {
	const row = await queryOne<Record<string, unknown>>(
		`SELECT * FROM project_templates WHERE id = $1`,
		[id],
	);
	return row ? rowToTemplate(row) : null;
}

// ---------------------------------------------------------------------------
// updateTemplate
// ---------------------------------------------------------------------------

export async function updateTemplate(id: string, data: UpdateTemplateData): Promise<ProjectTemplate | null> {
	const sets: string[] = [];
	const params: unknown[] = [];
	let idx = 1;

	if (data.name !== undefined) { sets.push(`name = $${idx++}`); params.push(data.name); }
	if (data.description !== undefined) { sets.push(`description = $${idx++}`); params.push(data.description); }
	if (data.category !== undefined) { sets.push(`category = $${idx++}`); params.push(data.category); }
	if (data.techStack !== undefined) { sets.push(`tech_stack = $${idx++}`); params.push(JSON.stringify(data.techStack)); }
	if (data.agentConfig !== undefined) { sets.push(`agent_config = $${idx++}`); params.push(JSON.stringify(data.agentConfig)); }
	if (data.phases !== undefined) { sets.push(`phases = $${idx++}`); params.push(JSON.stringify(data.phases)); }
	if (data.isPublic !== undefined) { sets.push(`is_public = $${idx++}`); params.push(data.isPublic); }

	if (sets.length === 0) return getTemplate(id);

	sets.push(`updated_at = $${idx++}`);
	params.push(new Date().toISOString());
	params.push(id);

	const row = await queryOne<Record<string, unknown>>(
		`UPDATE project_templates SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
		params,
	);
	return row ? rowToTemplate(row) : null;
}

// ---------------------------------------------------------------------------
// deleteTemplate
// ---------------------------------------------------------------------------

export async function deleteTemplate(id: string): Promise<void> {
	await execute(`DELETE FROM project_templates WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// incrementUsage
// ---------------------------------------------------------------------------

export async function incrementTemplateUsage(id: string): Promise<void> {
	await execute(
		`UPDATE project_templates SET usage_count = usage_count + 1, updated_at = now() WHERE id = $1`,
		[id],
	);
}

// ---------------------------------------------------------------------------
// rateTemplate — updates weighted average rating
// ---------------------------------------------------------------------------

export async function rateTemplate(id: string, newRating: number): Promise<void> {
	// Simple approach: weighted average with usage_count as denominator proxy
	await execute(
		`UPDATE project_templates
		 SET rating = CASE
		   WHEN usage_count = 0 THEN $1
		   ELSE ROUND(((rating * usage_count + $1) / (usage_count + 1))::numeric, 2)
		 END,
		 updated_at = now()
		 WHERE id = $2`,
		[newRating, id],
	);
}
