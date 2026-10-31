// ---------------------------------------------------------------------------
// Scratch database helper: destructive schema tests run in a throwaway database
// created through the superuser URL (OSCORPEX_MIGRATION_DATABASE_URL ?? DATABASE_URL),
// never in the shared test database.
// ---------------------------------------------------------------------------

import { randomBytes } from "node:crypto";
import pg from "pg";

export interface ScratchDb {
	/** Database name of the scratch database. */
	name: string;
	/** Connection string of the scratch database (superuser). */
	url: string;
	drop: () => Promise<void>;
}

function adminUrl(): string {
	const url = process.env.OSCORPEX_MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
	if (!url) throw new Error("No superuser database URL available for scratch database creation");
	return url;
}

const withDatabase = (base: string, name: string): string => {
	const u = new URL(base);
	u.pathname = `/${name}`;
	return u.toString();
};

export async function createScratchDb(): Promise<ScratchDb> {
	const base = adminUrl();
	const name = `oscorpex_d2_${randomBytes(6).toString("hex")}`;
	const admin = new pg.Client({ connectionString: withDatabase(base, "postgres") });
	await admin.connect();
	try {
		await admin.query(`CREATE DATABASE ${name}`);
	} finally {
		await admin.end();
	}
	return {
		name,
		url: withDatabase(base, name),
		drop: async () => {
			const c = new pg.Client({ connectionString: withDatabase(base, "postgres") });
			await c.connect();
			try {
				await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
			} finally {
				await c.end();
			}
		},
	};
}

/** Run a callback with a connected client on the given URL. */
export async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
	const c = new pg.Client({ connectionString: url });
	await c.connect();
	try {
		return await fn(c);
	} finally {
		await c.end();
	}
}

/** Names among the given roles/database that still exist in the cluster (empty = nothing leaked). */
export async function findLeftovers(names: { roles: string[]; database?: string }): Promise<string[]> {
	const admin = withDatabase(adminUrl(), "postgres");
	return withClient(admin, async (c) => {
		const roles = await c.query<{ rolname: string }>("SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])", [
			names.roles,
		]);
		const dbs = names.database
			? await c.query<{ datname: string }>("SELECT datname FROM pg_database WHERE datname = $1", [names.database])
			: { rows: [] as { datname: string }[] };
		return [...roles.rows.map((r) => `role ${r.rolname}`), ...dbs.rows.map((r) => `database ${r.datname}`)];
	});
}
