// ---------------------------------------------------------------------------
// Oscorpex — PostgreSQL Connection Pool
// Wraps the `pg` library with SQLite-compatible helper functions to ease
// the migration from better-sqlite3 to PostgreSQL.
//
// Parameter style: $1, $2, $3, … (PostgreSQL positional placeholders)
// ---------------------------------------------------------------------------

import pg from "pg";

const { Pool } = pg;

let _pool: pg.Pool | null = null;

/**
 * Returns the singleton connection pool.
 * Lazily created on first call; reused on subsequent calls.
 */
export function getPool(): pg.Pool {
	if (!_pool) {
		_pool = new Pool({
			connectionString: process.env.DATABASE_URL || "postgresql://oscorpex:oscorpex_dev@localhost:5432/oscorpex",
			max: 20,
			idleTimeoutMillis: 30_000,
			connectionTimeoutMillis: 5_000,
		});

		_pool.on("error", (err) => {
			console.error("[pg] Unexpected error on idle client:", err);
		});
	}
	return _pool;
}

/**
 * Execute a SELECT query and return all matching rows.
 *
 * @example
 *   const projects = await query<Project>('SELECT * FROM projects WHERE id = $1', [id]);
 */
export async function query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
	const result = await getPool().query(sql, params);
	return result.rows as T[];
}

/**
 * Execute a SELECT query and return the first row, or `undefined` if none.
 *
 * @example
 *   const project = await queryOne<Project>('SELECT * FROM projects WHERE id = $1', [id]);
 */
export async function queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined> {
	const result = await getPool().query(sql, params);
	return result.rows[0] as T | undefined;
}

/**
 * Execute an INSERT / UPDATE / DELETE statement.
 * Returns the number of rows affected.
 *
 * @example
 *   const { rowCount } = await execute('DELETE FROM projects WHERE id = $1', [id]);
 */
export async function execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
	const result = await getPool().query(sql, params);
	return { rowCount: result.rowCount ?? 0 };
}

/**
 * Run multiple statements inside a single transaction.
 * If `fn` throws the transaction is rolled back automatically.
 *
 * @example
 *   await withTransaction(async (client) => {
 *     await client.query('INSERT INTO projects ...', [...]);
 *     await client.query('INSERT INTO project_plans ...', [...]);
 *   });
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
	const client = await getPool().connect();
	try {
		await client.query("BEGIN");
		const result = await fn(client);
		await client.query("COMMIT");
		return result;
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
	}
}

/**
 * Gracefully close the connection pool.
 * Call this during application shutdown to allow in-flight queries to finish.
 */
export async function closePool(): Promise<void> {
	if (_pool) {
		await _pool.end();
		_pool = null;
	}
}
