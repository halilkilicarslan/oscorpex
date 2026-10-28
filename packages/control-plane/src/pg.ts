// ---------------------------------------------------------------------------
// @oscorpex/control-plane — database bridge
// The kernel injects its tenant-aware helpers at boot via initDb(); the package
// never owns a pool. Every query therefore runs through the kernel's tenant
// scope handling (AsyncLocalStorage → app.current_tenant_id).
// ---------------------------------------------------------------------------

import type { PoolClient } from "pg";

export interface ControlPlaneDb {
	query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
	queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
	execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }>;
	withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
}

let _db: ControlPlaneDb | null = null;

/** Inject the kernel's DB helpers. Must be called once at boot before any control-plane query. */
export function initDb(db: ControlPlaneDb): void {
	_db = db;
}

function db(): ControlPlaneDb {
	if (!_db) throw new Error("@oscorpex/control-plane: initDb() must be called before using the database");
	return _db;
}

export async function query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
	return db().query<T>(sql, params);
}

export async function queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined> {
	return db().queryOne<T>(sql, params);
}

export async function execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
	return db().execute(sql, params);
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
	return db().withTransaction(fn);
}
