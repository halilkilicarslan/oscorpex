// ---------------------------------------------------------------------------
// Oscorpex — Plugin Repository (M5 Plugin SDK)
// DB persistence for registered plugins and execution logs.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import { createLogger } from "../logger.js";
const log = createLogger("plugin-repo");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegisteredPlugin {
	id: string;
	name: string;
	version: string;
	description: string;
	author: string;
	enabled: boolean;
	hooks: string[];
	permissions: string[];
	configJson: Record<string, unknown>;
	manifestJson: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface PluginExecution {
	id: string;
	pluginName: string;
	hook: string;
	projectId: string | null;
	durationMs: number;
	success: boolean;
	error: string | null;
	createdAt: string;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToPlugin(row: Record<string, unknown>): RegisteredPlugin {
	return {
		id: row.id as string,
		name: row.name as string,
		version: row.version as string,
		description: (row.description as string) ?? "",
		author: (row.author as string) ?? "",
		enabled: row.enabled as boolean,
		hooks: (row.hooks as string[]) ?? [],
		permissions: (row.permissions as string[]) ?? [],
		configJson: (row.config_json as Record<string, unknown>) ?? {},
		manifestJson: (row.manifest_json as Record<string, unknown>) ?? {},
		createdAt: row.created_at as string,
		updatedAt: row.updated_at as string,
	};
}

function rowToPluginExecution(row: Record<string, unknown>): PluginExecution {
	return {
		id: row.id as string,
		pluginName: row.plugin_name as string,
		hook: row.hook as string,
		projectId: (row.project_id as string | null) ?? null,
		durationMs: (row.duration_ms as number) ?? 0,
		success: row.success as boolean,
		error: (row.error as string | null) ?? null,
		createdAt: row.created_at as string,
	};
}

// ---------------------------------------------------------------------------
// CRUD — registered_plugins
// ---------------------------------------------------------------------------

export async function listPlugins(): Promise<RegisteredPlugin[]> {
	const rows = await query<Record<string, unknown>>("SELECT * FROM registered_plugins ORDER BY created_at ASC", []);
	return rows.map(rowToPlugin);
}

export async function getPlugin(name: string): Promise<RegisteredPlugin | null> {
	const row = await queryOne<Record<string, unknown>>("SELECT * FROM registered_plugins WHERE name = $1", [name]);
	return row ? rowToPlugin(row) : null;
}

export async function registerPlugin(data: {
	name: string;
	version: string;
	description: string;
	author: string;
	hooks: string[];
	permissions: string[];
	config: Record<string, unknown>;
	manifest: Record<string, unknown>;
}): Promise<RegisteredPlugin> {
	const id = randomUUID();
	const row = await queryOne<Record<string, unknown>>(
		`INSERT INTO registered_plugins
		  (id, name, version, description, author, hooks, permissions, config_json, manifest_json)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 ON CONFLICT (name) DO UPDATE SET
		   version       = EXCLUDED.version,
		   description   = EXCLUDED.description,
		   author        = EXCLUDED.author,
		   hooks         = EXCLUDED.hooks,
		   permissions   = EXCLUDED.permissions,
		   config_json   = EXCLUDED.config_json,
		   manifest_json = EXCLUDED.manifest_json,
		   updated_at    = now()
		 RETURNING *`,
		[
			id,
			data.name,
			data.version,
			data.description,
			data.author,
			data.hooks,
			data.permissions,
			JSON.stringify(data.config),
			JSON.stringify(data.manifest),
		],
	);
	return rowToPlugin(row!);
}

export async function updatePlugin(
	name: string,
	data: Partial<{ enabled: boolean; configJson: Record<string, unknown>; version: string }>,
): Promise<RegisteredPlugin | null> {
	const parts: string[] = [];
	const values: unknown[] = [];
	let idx = 1;

	if (data.enabled !== undefined) {
		parts.push(`enabled = $${idx++}`);
		values.push(data.enabled);
	}
	if (data.configJson !== undefined) {
		parts.push(`config_json = $${idx++}`);
		values.push(JSON.stringify(data.configJson));
	}
	if (data.version !== undefined) {
		parts.push(`version = $${idx++}`);
		values.push(data.version);
	}

	if (parts.length === 0) return getPlugin(name);

	parts.push(`updated_at = now()`);
	values.push(name);

	const row = await queryOne<Record<string, unknown>>(
		`UPDATE registered_plugins SET ${parts.join(", ")} WHERE name = $${idx} RETURNING *`,
		values,
	);
	return row ? rowToPlugin(row) : null;
}

export async function deletePlugin(name: string): Promise<void> {
	await execute("DELETE FROM registered_plugins WHERE name = $1", [name]);
}

// ---------------------------------------------------------------------------
// plugin_executions
// ---------------------------------------------------------------------------

export async function insertPluginExecution(data: {
	pluginName: string;
	hook: string;
	projectId: string | null;
	durationMs: number;
	success: boolean;
	error: string | null;
}): Promise<void> {
	const id = randomUUID();
	await execute(
		`INSERT INTO plugin_executions (id, plugin_name, hook, project_id, duration_ms, success, error)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[id, data.pluginName, data.hook, data.projectId, data.durationMs, data.success, data.error],
	);
}

export async function getPluginExecutions(pluginName: string, limit = 50): Promise<PluginExecution[]> {
	const rows = await query<Record<string, unknown>>(
		"SELECT * FROM plugin_executions WHERE plugin_name = $1 ORDER BY created_at DESC LIMIT $2",
		[pluginName, limit],
	);
	return rows.map(rowToPluginExecution);
}
