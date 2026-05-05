import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import { buildUpdateFields } from "./helpers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Skill {
	id: string;
	name: string;
	description: string;
	contentMd: string;
	triggers: string[];
	applicableRoles: string[];
	providerHint?: string;
	modelHint?: string;
	category: string;
	isGlobal: boolean;
	maxTokenBudget: number;
	createdBy?: string;
	createdAt: string;
	updatedAt: string;
}

export interface AgentSkillAssignment {
	id: string;
	agentId: string;
	skillId: string;
	priority: number;
	createdAt: string;
}

export type CreateSkillData = Omit<Skill, "id" | "createdAt" | "updatedAt">;

export type UpdateSkillData = Partial<
	Pick<
		Skill,
		| "name"
		| "description"
		| "contentMd"
		| "triggers"
		| "applicableRoles"
		| "providerHint"
		| "modelHint"
		| "category"
		| "isGlobal"
		| "maxTokenBudget"
	>
>;

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

interface SkillRow {
	id: string;
	name: string;
	description: string;
	content_md: string;
	triggers: string;
	applicable_roles: string;
	provider_hint: string | null;
	model_hint: string | null;
	category: string;
	is_global: boolean;
	max_token_budget: number;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

function rowToSkill(row: SkillRow): Skill {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		contentMd: row.content_md,
		triggers: parseJsonArray(row.triggers),
		applicableRoles: parseJsonArray(row.applicable_roles),
		providerHint: row.provider_hint ?? undefined,
		modelHint: row.model_hint ?? undefined,
		category: row.category,
		isGlobal: row.is_global,
		maxTokenBudget: row.max_token_budget,
		createdBy: row.created_by ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function parseJsonArray(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as string[]) : [];
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// CRUD — skills
// ---------------------------------------------------------------------------

export async function createSkill(data: CreateSkillData): Promise<Skill> {
	const id = randomUUID();
	const now = new Date().toISOString();
	const row = await queryOne<SkillRow>(
		`INSERT INTO skills
		   (id, name, description, content_md, triggers, applicable_roles,
		    provider_hint, model_hint, category, is_global, max_token_budget, created_by, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		 RETURNING *`,
		[
			id,
			data.name,
			data.description,
			data.contentMd,
			JSON.stringify(data.triggers),
			JSON.stringify(data.applicableRoles),
			data.providerHint ?? null,
			data.modelHint ?? null,
			data.category,
			data.isGlobal,
			data.maxTokenBudget,
			data.createdBy ?? null,
			now,
			now,
		],
	);
	if (!row) throw new Error(`Failed to create skill "${data.name}"`);
	return rowToSkill(row);
}

export async function updateSkill(id: string, data: UpdateSkillData): Promise<Skill | undefined> {
	const allowedColumns: Record<string, string> = {
		name: "name",
		description: "description",
		contentMd: "content_md",
		triggers: "triggers",
		applicableRoles: "applicable_roles",
		providerHint: "provider_hint",
		modelHint: "model_hint",
		category: "category",
		isGlobal: "is_global",
		maxTokenBudget: "max_token_budget",
	};

	// Serialize JSON arrays before passing to buildUpdateFields
	const serialized: Record<string, unknown> = { ...data };
	if (data.triggers !== undefined) serialized.triggers = JSON.stringify(data.triggers);
	if (data.applicableRoles !== undefined) serialized.applicableRoles = JSON.stringify(data.applicableRoles);

	const built = buildUpdateFields(serialized, allowedColumns, 1);
	if (!built) return getSkill(id);

	const { fields, values, nextIdx } = built;
	fields.push(`updated_at = $${nextIdx}`);
	values.push(new Date().toISOString());

	const row = await queryOne<SkillRow>(
		`UPDATE skills SET ${fields.join(", ")} WHERE id = $${nextIdx + 1} RETURNING *`,
		[...values, id],
	);
	return row ? rowToSkill(row) : undefined;
}

export async function deleteSkill(id: string): Promise<void> {
	await execute("DELETE FROM skills WHERE id = $1", [id]);
}

export async function getSkill(id: string): Promise<Skill | undefined> {
	const row = await queryOne<SkillRow>("SELECT * FROM skills WHERE id = $1", [id]);
	return row ? rowToSkill(row) : undefined;
}

export interface ListSkillsFilters {
	category?: string;
	isGlobal?: boolean;
	/** Return only skills whose applicable_roles JSON array contains this role */
	role?: string;
}

export async function listSkills(filters: ListSkillsFilters = {}): Promise<Skill[]> {
	const conditions: string[] = [];
	const values: unknown[] = [];
	let idx = 1;

	if (filters.category !== undefined) {
		conditions.push(`category = $${idx++}`);
		values.push(filters.category);
	}
	if (filters.isGlobal !== undefined) {
		conditions.push(`is_global = $${idx++}`);
		values.push(filters.isGlobal);
	}
	if (filters.role !== undefined) {
		// applicable_roles is stored as a JSON text array; use JSON containment check via LIKE
		conditions.push(`applicable_roles::jsonb @> $${idx++}::jsonb`);
		values.push(JSON.stringify([filters.role]));
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const rows = await query<SkillRow>(`SELECT * FROM skills ${where} ORDER BY created_at DESC`, values);
	return rows.map(rowToSkill);
}

// ---------------------------------------------------------------------------
// Agent ↔ Skill assignments
// ---------------------------------------------------------------------------

export async function assignSkillToAgent(agentId: string, skillId: string, priority = 0): Promise<void> {
	await execute(
		`INSERT INTO agent_skills (id, agent_id, skill_id, priority)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (agent_id, skill_id) DO UPDATE SET priority = EXCLUDED.priority`,
		[randomUUID(), agentId, skillId, priority],
	);
}

export async function removeSkillFromAgent(agentId: string, skillId: string): Promise<void> {
	await execute("DELETE FROM agent_skills WHERE agent_id = $1 AND skill_id = $2", [agentId, skillId]);
}

export async function getAgentSkills(agentId: string): Promise<Skill[]> {
	const rows = await query<SkillRow>(
		`SELECT s.*
		 FROM skills s
		 JOIN agent_skills a ON a.skill_id = s.id
		 WHERE a.agent_id = $1
		 ORDER BY a.priority DESC, s.created_at DESC`,
		[agentId],
	);
	return rows.map(rowToSkill);
}

// ---------------------------------------------------------------------------
// Project ↔ Skill assignments
// ---------------------------------------------------------------------------

export async function assignSkillToProject(projectId: string, skillId: string): Promise<void> {
	await execute(
		`INSERT INTO project_skills (id, project_id, skill_id)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (project_id, skill_id) DO NOTHING`,
		[randomUUID(), projectId, skillId],
	);
}

export async function removeSkillFromProject(projectId: string, skillId: string): Promise<void> {
	await execute("DELETE FROM project_skills WHERE project_id = $1 AND skill_id = $2", [projectId, skillId]);
}

export async function getProjectSkills(projectId: string): Promise<Skill[]> {
	const rows = await query<SkillRow>(
		`SELECT s.*
		 FROM skills s
		 JOIN project_skills p ON p.skill_id = s.id
		 WHERE p.project_id = $1
		 ORDER BY s.created_at DESC`,
		[projectId],
	);
	return rows.map(rowToSkill);
}
