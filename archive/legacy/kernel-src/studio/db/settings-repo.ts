// ---------------------------------------------------------------------------
// Oscorpex — Settings Repository: Project Settings key-value store
// ---------------------------------------------------------------------------

import { execute, getPool, query, queryOne } from "../pg.js";
import { now } from "./helpers.js";
import { createLogger } from "../logger.js";
const log = createLogger("settings-repo");

// ---------------------------------------------------------------------------
// ProjectSetting interface — DB layer only
// ---------------------------------------------------------------------------

export interface ProjectSetting {
	id: string;
	projectId: string;
	category: string;
	key: string;
	value: string;
	updatedAt: string;
}

// ---------------------------------------------------------------------------
// Project Settings CRUD
// ---------------------------------------------------------------------------

/** Get all settings for a project, optionally filtered by category. */
export async function getProjectSettings(projectId: string, category?: string): Promise<ProjectSetting[]> {
	let rows: any[];
	if (category) {
		rows = await query<any>(
			"SELECT * FROM project_settings WHERE project_id = $1 AND category = $2 ORDER BY category, key",
			[projectId, category],
		);
	} else {
		rows = await query<any>("SELECT * FROM project_settings WHERE project_id = $1 ORDER BY category, key", [projectId]);
	}
	return rows.map((r: any) => ({
		id: r.id,
		projectId: r.project_id,
		category: r.category,
		key: r.key,
		value: r.value,
		updatedAt: r.updated_at,
	}));
}

/** Get a single setting value. Returns undefined if not set. */
export async function getProjectSetting(projectId: string, category: string, key: string): Promise<string | undefined> {
	const row = await queryOne<any>(
		"SELECT value FROM project_settings WHERE project_id = $1 AND category = $2 AND key = $3",
		[projectId, category, key],
	);
	return row?.value;
}

/** Upsert a single setting. */
export async function setProjectSetting(
	projectId: string,
	category: string,
	key: string,
	value: string,
): Promise<void> {
	const ts = now();
	const id = `${projectId}:${category}:${key}`;
	await execute(
		`
    INSERT INTO project_settings (id, project_id, category, key, value, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (project_id, category, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `,
		[id, projectId, category, key, value, ts],
	);
}

/** Bulk upsert settings for a category. */
export async function setProjectSettings(
	projectId: string,
	category: string,
	entries: Record<string, string>,
): Promise<void> {
	const ts = now();
	const client = await getPool().connect();
	try {
		await client.query("BEGIN");
		for (const [k, v] of Object.entries(entries)) {
			const id = `${projectId}:${category}:${k}`;
			await client.query(
				`
        INSERT INTO project_settings (id, project_id, category, key, value, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (project_id, category, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `,
				[id, projectId, category, k, v, ts],
			);
		}
		await client.query("COMMIT");
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
	}
}

/** Get all settings as a nested object { category: { key: value } }. */
export async function getProjectSettingsMap(projectId: string): Promise<Record<string, Record<string, string>>> {
	const settings = await getProjectSettings(projectId);
	const map: Record<string, Record<string, string>> = {};
	for (const s of settings) {
		if (!map[s.category]) map[s.category] = {};
		map[s.category][s.key] = s.value;
	}
	return map;
}
