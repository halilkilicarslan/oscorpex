// ---------------------------------------------------------------------------
// @oscorpex/control-plane — PostgreSQL helpers
// Re-exports to keep package self-contained. Pool init via env var.
// ---------------------------------------------------------------------------

import pg from "pg";

const { Pool } = pg;

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
	if (!_pool) {
		_pool = new Pool({
			connectionString: process.env.DATABASE_URL || "postgresql://oscorpex:oscorpex_dev@localhost:5432/oscorpex",
			max: 20,
			idleTimeoutMillis: 30_000,
			connectionTimeoutMillis: 5_000,
		});
	}
	return _pool;
}

export async function query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
	const result = await getPool().query(sql, params);
	return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined> {
	const result = await getPool().query(sql, params);
	return result.rows[0] as T | undefined;
}

export async function execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
	const result = await getPool().query(sql, params);
	return { rowCount: result.rowCount ?? 0 };
}
