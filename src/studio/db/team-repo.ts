// ---------------------------------------------------------------------------
// Oscorpex — Team Repository: Team Templates + Custom Teams
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import type { TeamTemplate } from "../types.js";
import { now, rowToTeamTemplate } from "./helpers.js";

// ---------------------------------------------------------------------------
// Custom Team Template interface — DB layer only
// ---------------------------------------------------------------------------

export interface CustomTeamTemplate {
	id: string;
	name: string;
	description: string;
	roles: string[];
	dependencies: { from: string; to: string; type: string }[];
	createdAt: string;
}

function rowToCustomTeamTemplate(row: any): CustomTeamTemplate {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		roles: JSON.parse(row.roles),
		dependencies: JSON.parse(row.dependencies),
		createdAt: row.created_at,
	};
}

function ensurePlannerRole(roles: string[]): string[] {
	const deduped = Array.from(new Set(roles.map((role) => role.trim()).filter(Boolean)));
	const hasPlanner = deduped.some((role) => role === "product-owner" || role === "pm");
	return hasPlanner ? deduped : ["product-owner", ...deduped];
}

// ---------------------------------------------------------------------------
// Preset Team Templates
// ---------------------------------------------------------------------------

export async function listTeamTemplates(): Promise<TeamTemplate[]> {
	const rows = await query<any>("SELECT * FROM team_templates ORDER BY name");
	return rows.map(rowToTeamTemplate);
}

export async function getTeamTemplate(id: string): Promise<TeamTemplate | undefined> {
	const row = await queryOne<any>("SELECT * FROM team_templates WHERE id = $1", [id]);
	return row ? rowToTeamTemplate(row) : undefined;
}

// ---------------------------------------------------------------------------
// Custom Team Templates
// ---------------------------------------------------------------------------

export async function listCustomTeamTemplates(): Promise<CustomTeamTemplate[]> {
	const rows = await query<any>("SELECT * FROM custom_team_templates ORDER BY created_at DESC");
	return rows.map(rowToCustomTeamTemplate);
}

export async function getCustomTeamTemplate(id: string): Promise<CustomTeamTemplate | undefined> {
	const row = await queryOne<any>("SELECT * FROM custom_team_templates WHERE id = $1", [id]);
	return row ? rowToCustomTeamTemplate(row) : undefined;
}

export async function createCustomTeamTemplate(data: {
	name: string;
	description?: string;
	roles: string[];
	dependencies: { from: string; to: string; type: string }[];
}): Promise<CustomTeamTemplate> {
	const id = randomUUID();
	const createdAt = now();
	const roles = ensurePlannerRole(data.roles);
	await execute(
		"INSERT INTO custom_team_templates (id, name, description, roles, dependencies, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
		[id, data.name, data.description ?? "", JSON.stringify(roles), JSON.stringify(data.dependencies), createdAt],
	);
	return {
		id,
		name: data.name,
		description: data.description ?? "",
		roles,
		dependencies: data.dependencies,
		createdAt,
	};
}

export async function updateCustomTeamTemplate(
	id: string,
	data: {
		name?: string;
		description?: string;
		roles?: string[];
		dependencies?: { from: string; to: string; type: string }[];
	},
): Promise<CustomTeamTemplate | undefined> {
	const existing = await getCustomTeamTemplate(id);
	if (!existing) return undefined;
	const name = data.name ?? existing.name;
	const description = data.description ?? existing.description;
	const roles = ensurePlannerRole(data.roles ?? existing.roles);
	const dependencies = data.dependencies ?? existing.dependencies;
	await execute(
		"UPDATE custom_team_templates SET name = $1, description = $2, roles = $3, dependencies = $4 WHERE id = $5",
		[name, description, JSON.stringify(roles), JSON.stringify(dependencies), id],
	);
	return { ...existing, name, description, roles, dependencies };
}

export async function deleteCustomTeamTemplate(id: string): Promise<boolean> {
	const result = await execute("DELETE FROM custom_team_templates WHERE id = $1", [id]);
	return (result.rowCount ?? 0) > 0;
}
