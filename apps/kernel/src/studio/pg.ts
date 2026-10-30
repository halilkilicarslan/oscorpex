// ---------------------------------------------------------------------------
// Oscorpex — PostgreSQL Connection Pool
// Wraps the `pg` library with SQLite-compatible helper functions to ease
// the migration from better-sqlite3 to PostgreSQL.
//
// Parameter style: $1, $2, $3, … (PostgreSQL positional placeholders)
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createLogger } from "./logger.js";
import { getDbPoolConfig } from "./performance-config.js";
import { UnscopedQueryError, currentScope, isImplicitScope, tenantScopeMode } from "./tenancy/tenant-scope.js";
const log = createLogger("pg");

const { Pool } = pg;

let _pool: pg.Pool | null = null;

/** Internal pool accessor — the pool never leaves this module. */
function pool(): pg.Pool {
	if (!_pool) {
		const connectionString = process.env.DATABASE_URL;
		if (!connectionString) throw new Error("DATABASE_URL is not set");
		const poolCfg = getDbPoolConfig();
		_pool = new Pool({
			connectionString,
			min: poolCfg.minConnections,
			max: poolCfg.maxConnections,
			idleTimeoutMillis: poolCfg.idleTimeoutMs,
			connectionTimeoutMillis: poolCfg.acquireTimeoutMs,
		});

		_pool.on("error", (err) => {
			log.error({ err }, "Unexpected error on idle pooled client");
		});
	}
	return _pool;
}

export interface PoolStats {
	totalCount: number;
	idleCount: number;
	waitingCount: number;
	max: number;
	connectionTimeoutMillis: number;
	idleTimeoutMillis: number;
}

/** Pool statistics for db-pool-metrics. Returns undefined when the pool is not created yet. */
export function getPoolStats(): PoolStats | undefined {
	if (!_pool) return undefined;
	return {
		totalCount: _pool.totalCount ?? 0,
		idleCount: _pool.idleCount ?? 0,
		waitingCount: _pool.waitingCount ?? 0,
		max: _pool.options.max ?? 20,
		connectionTimeoutMillis: _pool.options.connectionTimeoutMillis ?? 5_000,
		idleTimeoutMillis: _pool.options.idleTimeoutMillis ?? 30_000,
	};
}

// ---------------------------------------------------------------------------
// Tenant scope enforcement
// ---------------------------------------------------------------------------

let _unscopedCount = 0;
let _implicitCount = 0;
const _warnedSites = new Set<string>();
const MAX_WARNED_SITES = 500;

/** Number of unscoped queries observed in warn mode since process start (for metrics). */
export function getUnscopedQueryCount(): number {
	return _unscopedCount;
}

/** Number of queries that ran under the implicit default test scope (must stay 0 on request paths). */
export function getImplicitScopeQueryCount(): number {
	return _implicitCount;
}

/** Test helper: reset the unscoped-query counters and the per-call-site warning dedupe. */
export function resetUnscopedQueryStats(): void {
	_unscopedCount = 0;
	_implicitCount = 0;
	_warnedSites.clear();
}

/** pg module frames: src `pg.ts`, built `pg.js` and hashed chunks such as `dist/pg-DZ4nHWIx.js`. */
const PG_FRAME = /[\\/]pg(?:-[\w-]+)?\.(?:ts|js|mjs|cjs)(?=[:)\s]|$)/;

/**
 * Up to 3 caller frames outside the pg module (src and built layouts). `stack` is injectable for tests; by default
 * the current call stack is used (captureStackTrace omits this function's own frame).
 */
export function callerHint(stack?: string): string {
	let raw = stack;
	if (raw === undefined) {
		const holder: { stack?: string } = {};
		Error.captureStackTrace(holder, callerHint);
		raw = holder.stack ?? "";
	}
	const frames = raw
		.split("\n")
		.slice(1)
		.filter((l) => l.trim().startsWith("at ") && !PG_FRAME.test(l) && !l.includes("node:internal"));
	return frames
		.slice(0, 3)
		.map((l) => l.trim())
		.join(" <- ");
}

export interface ImplicitScopeCaller {
	repoFrame: string;
	entryFrame: string;
	origin: "test" | "detached";
	trigger?: "timer" | "event" | "unknown";
	count: number;
}

const INVENTORY_MAX = 500;
const INVENTORY_STACK_DEPTH = 200;
const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
let _inventoryOn = false;
const _implicitCallers = new Map<string, ImplicitScopeCaller>();

/** Test helper (VITEST only): record the call sites of queries that only resolve through the implicit test scope. */
export function enableImplicitScopeInventory(on: boolean): void {
	_inventoryOn = on && !!process.env.VITEST;
}

/** Detached records first, then test records; each group by descending count. */
export function getImplicitScopeCallers(): ImplicitScopeCaller[] {
	const rank = (c: ImplicitScopeCaller) => (c.origin === "detached" ? 0 : 1);
	return [..._implicitCallers.values()].map((c) => ({ ...c })).sort((a, b) => rank(a) - rank(b) || b.count - a.count);
}

export function resetImplicitScopeCallers(): void {
	_implicitCallers.clear();
}

interface StackFrame {
	label: string;
	path: string;
}

function parseFrame(line: string): StackFrame | undefined {
	const m = /^\s*at (?:async )?(?:(.*?) \()?(.+?)(?::\d+){0,2}\)?$/.exec(line);
	if (!m) return undefined;
	let path = m[2];
	if (path.startsWith("file://")) path = fileURLToPath(path);
	if (path.startsWith(REPO_ROOT)) path = path.slice(REPO_ROOT.length);
	return { label: m[1] ? `${m[1]} (${path})` : path, path };
}

function recordImplicitCaller(): void {
	const limit = Error.stackTraceLimit;
	Error.stackTraceLimit = INVENTORY_STACK_DEPTH;
	const holder: { stack?: string } = {};
	try {
		Error.captureStackTrace(holder, recordImplicitCaller);
	} finally {
		Error.stackTraceLimit = limit;
	}
	const frames = (holder.stack ?? "")
		.split("\n")
		.slice(1)
		.map(parseFrame)
		.filter((f): f is StackFrame => f !== undefined);
	const repo = frames.find((f) => !PG_FRAME.test(f.path));
	const outsideRepoLayer = frames.filter((f) => !PG_FRAME.test(f.path) && !/(^|[\\/])db[\\/]/.test(f.path));
	const entry =
		outsideRepoLayer.find((f) => !/[\\/]__tests__[\\/]|node_modules|^node:|^<anonymous>$|^index \d+$/.test(f.path)) ??
		outsideRepoLayer[0];
	if (!repo || !entry) return;
	const isTest = frames.some((f) => /[\\/]__tests__[\\/]/.test(f.path));
	let trigger: ImplicitScopeCaller["trigger"];
	if (!isTest) {
		if (frames.some((f) => f.path.includes("node:internal/timers"))) trigger = "timer";
		else if (frames.some((f) => /^(node:)?events$/.test(f.path))) trigger = "event";
		else trigger = "unknown";
	}
	const key = `${repo.label}|${entry.label}`;
	const existing = _implicitCallers.get(key);
	if (existing) {
		existing.count++;
		return;
	}
	if (_implicitCallers.size >= INVENTORY_MAX) return;
	_implicitCallers.set(key, {
		repoFrame: repo.label,
		entryFrame: entry.label,
		origin: isTest ? "test" : "detached",
		...(trigger ? { trigger } : {}),
		count: 1,
	});
}

/** Resolve the tenant GUC value for the current scope; undefined = unscoped (warn mode only). */
function resolveTenantGuc(): string | undefined {
	const scope = currentScope();
	if (scope?.kind === "tenant") {
		if (isImplicitScope()) {
			_implicitCount++;
			if (_inventoryOn) {
				try {
					recordImplicitCaller();
				} catch {
					// Test-only diagnostics must never fail the query itself.
				}
			}
		}
		return scope.tenantId;
	}
	if (scope?.kind === "system") return "";
	if (tenantScopeMode() === "strict") {
		throw new UnscopedQueryError("Database access outside a tenant/system scope is not allowed (strict mode)");
	}
	_unscopedCount++;
	const caller = callerHint();
	if (!_warnedSites.has(caller) && _warnedSites.size < MAX_WARNED_SITES) {
		_warnedSites.add(caller);
		log.warn({ unscopedCount: _unscopedCount, caller }, "Unscoped database query (no tenant scope)");
	}
	return undefined;
}

/**
 * BEGIN + transaction-local tenant GUC as one simple-protocol round trip. The tenant id has been validated by
 * tenant-scope.ts (non-empty, <=128 chars, no control characters) and is hex-encoded here, so no tenant-controlled
 * text ever reaches the SQL string.
 */
function beginScopedSql(guc: string): string {
	const hex = Buffer.from(guc, "utf8").toString("hex");
	return `BEGIN; SELECT set_config('app.current_tenant_id', convert_from(decode('${hex}', 'hex'), 'UTF8'), true)`;
}

function toError(e: unknown): Error {
	return e instanceof Error ? e : new Error(String(e));
}

/**
 * While a client is checked out, node-postgres emits 'error' on it if the backend connection dies. Without a
 * listener that is an uncaught exception. The guard logs it, remembers it so the client is destroyed on release
 * (`release(err)`), and is removed on release so listeners never pile up on reused clients.
 */
function guardClient(client: pg.PoolClient): { release: (err?: Error) => void } {
	let brokenErr: Error | undefined;
	const onError = (err: Error) => {
		brokenErr = err;
		log.warn({ err }, "Checked-out pooled client errored; it will be destroyed on release");
	};
	client.on?.("error", onError);
	return {
		release: (err?: Error) => {
			client.removeListener?.("error", onError);
			client.release(err ?? brokenErr);
		},
	};
}

async function runQuery(sql: string, params?: unknown[]): Promise<pg.QueryResult> {
	const guc = resolveTenantGuc();
	// System scope (guc "") and unscoped queries need no transaction: the GUC is simply unset/empty.
	if (guc === undefined || guc === "") return pool().query(sql, params);

	const client = await pool().connect();
	const guard = guardClient(client);
	let releaseErr: Error | undefined;
	try {
		await client.query(beginScopedSql(guc));
		const result = await client.query(sql, params);
		await client.query("COMMIT");
		return result;
	} catch (err) {
		try {
			await client.query("ROLLBACK");
		} catch (rollbackErr) {
			releaseErr = toError(rollbackErr);
		}
		throw err;
	} finally {
		guard.release(releaseErr);
	}
}

/**
 * Execute a SELECT query and return all matching rows.
 *
 * @example
 *   const projects = await query<Project>('SELECT * FROM projects WHERE id = $1', [id]);
 */
export async function query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
	const result = await runQuery(sql, params);
	return result.rows as T[];
}

/**
 * Execute a SELECT query and return the first row, or `undefined` if none.
 *
 * @example
 *   const project = await queryOne<Project>('SELECT * FROM projects WHERE id = $1', [id]);
 */
export async function queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined> {
	const result = await runQuery(sql, params);
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
	const result = await runQuery(sql, params);
	return { rowCount: result.rowCount ?? 0 };
}

/**
 * Run multiple statements inside a single transaction.
 * If `fn` throws the transaction is rolled back automatically.
 * The tenant/system scope is applied once (transaction-local) right after BEGIN.
 *
 * @example
 *   await withTransaction(async (client) => {
 *     await client.query('INSERT INTO projects ...', [...]);
 *     await client.query('INSERT INTO project_plans ...', [...]);
 *   });
 */
const txStorage = new AsyncLocalStorage<true>();

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
	const guc = resolveTenantGuc();
	if (txStorage.getStore()) {
		log.warn(
			{ caller: callerHint() },
			"Nested withTransaction: the inner call opens a separate connection and transaction",
		);
	}
	const client = await pool().connect();
	const guard = guardClient(client);
	let releaseErr: Error | undefined;
	try {
		if (guc !== undefined && guc !== "") await client.query(beginScopedSql(guc));
		else await client.query("BEGIN");
		const result = await txStorage.run(true, () => fn(client));
		await client.query("COMMIT");
		return result;
	} catch (err) {
		try {
			await client.query("ROLLBACK");
		} catch (rollbackErr) {
			releaseErr = toError(rollbackErr);
		}
		throw err;
	} finally {
		guard.release(releaseErr);
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
