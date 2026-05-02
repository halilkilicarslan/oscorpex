// ---------------------------------------------------------------------------
// Oscorpex — PostgreSQL Connection Pool
// Wraps the `pg` library with SQLite-compatible helper functions to ease
// the migration from better-sqlite3 to PostgreSQL.
//
// Parameter style: $1, $2, $3, … (PostgreSQL positional placeholders)
// ---------------------------------------------------------------------------

import pg from "pg";
import { createLogger } from "./logger.js";
import { getDbPoolConfig } from "./performance-config.js";
const log = createLogger("pg");

const { Pool } = pg;

let _pool: pg.Pool | null = null;

/**
 * Returns the singleton connection pool.
 * Lazily created on first call; reused on subsequent calls.
 */
export function getPool(): pg.Pool {
	if (!_pool) {
		const poolCfg = getDbPoolConfig();
		_pool = new Pool({
			connectionString: process.env.DATABASE_URL || "postgresql://oscorpex:oscorpex_dev@localhost:5432/oscorpex",
			min: poolCfg.minConnections,
			max: poolCfg.maxConnections,
			idleTimeoutMillis: poolCfg.idleTimeoutMs,
			connectionTimeoutMillis: poolCfg.acquireTimeoutMs,
		});

		_pool.on("error", (err) => {
			log.error("[pg] Unexpected error on idle client:" + " " + String(err));
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
 * Set the current tenant context for the PostgreSQL session.
 * This is used by RLS policies when Row Level Security is enabled.
 * The setting is transaction-scoped (true = reset after transaction end).
 *
 * @example
 *   await setTenantContext("tenant-uuid");
 */
export async function setTenantContext(tenantId: string): Promise<void> {
	await execute("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
}

/**
 * v8.0: Run a callback inside a transaction with tenant context enforced.
 * When OSCORPEX_AUTH_ENABLED=true, this ensures every query in the transaction
 * has the correct tenant_id set, closing the RLS backward-compat hole.
 *
 * When auth is disabled, tenant context is skipped (backward compat).
 */
export async function withTenantTransaction<T>(
	tenantId: string | undefined,
	fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
	const authEnabled = process.env.OSCORPEX_AUTH_ENABLED === "true";
	return withTransaction(async (client) => {
		if (authEnabled && tenantId) {
			await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
		} else if (authEnabled && !tenantId) {
			// Strict mode: auth enabled but no tenant → set empty to prevent NULL-tenant row access
			await client.query("SELECT set_config('app.current_tenant_id', '', true)");
		}
		return fn(client);
	});
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
