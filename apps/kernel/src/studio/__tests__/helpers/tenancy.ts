// ---------------------------------------------------------------------------
// Tenancy test helpers (F0): tenant seeding and tenant-scoped transactions.
// ---------------------------------------------------------------------------

import type { PoolClient } from "pg";
import { getPool } from "../../pg.js";

export const TENANT_LOCAL = "00000000-0000-0000-0000-000000000001";
export const TENANT_A = "00000000-0000-0000-0000-00000000000a";
export const TENANT_B = "00000000-0000-0000-0000-00000000000b";

const APP_ROLE = "oscorpex_app";
const OWNER_ROLE = "oscorpex_owner";
const ROLE_NAME_RE = /^[a-z_][a-z0-9_]*$/;

export interface TenantTxOptions {
	/** Persist the transaction instead of rolling it back. Default: false. */
	commit?: boolean;
	/** Switch to this role (SET LOCAL ROLE) for the transaction. */
	role?: string;
}

/** Idempotently insert the local, A and B test tenants. */
export async function seedTestTenants(): Promise<void> {
	const rows: Array<[string, string, string]> = [
		[TENANT_LOCAL, "Local", "local"],
		[TENANT_A, "Test Tenant A", "test-tenant-a"],
		[TENANT_B, "Test Tenant B", "test-tenant-b"],
	];
	for (const [id, name, slug] of rows) {
		await getPool().query("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [
			id,
			name,
			slug,
		]);
	}
}

export async function roleExists(role: string): Promise<boolean> {
	const { rowCount } = await getPool().query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
	return (rowCount ?? 0) > 0;
}

function quoteIdent(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Run fn in a transaction with app.current_tenant_id set (transaction-local).
 * Rolls back unless { commit: true }. tenantId null leaves the setting unset.
 * Session state (RESET ALL, RESET ROLE) is cleared before the client returns to the pool.
 */
export async function withTenantTx<T>(
	tenantId: string | null,
	fn: (client: PoolClient) => Promise<T>,
	opts: TenantTxOptions = {},
): Promise<T> {
	if (opts.role !== undefined && !ROLE_NAME_RE.test(opts.role)) {
		throw new Error(`Invalid role name: ${JSON.stringify(opts.role)}`);
	}

	const client = await getPool().connect();
	let releaseErr: Error | undefined;
	try {
		await client.query("BEGIN");
		if (opts.role !== undefined) await client.query(`SET LOCAL ROLE ${quoteIdent(opts.role)}`);
		if (tenantId !== null) await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
		const result = await fn(client);
		const end = await client.query(opts.commit ? "COMMIT" : "ROLLBACK");
		if (opts.commit && end.command !== "COMMIT") {
			throw new Error("Transaction was aborted and not committed (COMMIT acted as ROLLBACK)");
		}
		return result;
	} catch (err) {
		try {
			await client.query("ROLLBACK");
		} catch (rollbackErr) {
			releaseErr = toError(rollbackErr);
		}
		throw err;
	} finally {
		if (!releaseErr) {
			try {
				await client.query("RESET ALL");
				await client.query("RESET ROLE");
			} catch (resetErr) {
				releaseErr = toError(resetErr);
			}
		}
		client.release(releaseErr);
	}
}

function toError(e: unknown): Error {
	return e instanceof Error ? e : new Error(String(e));
}

/**
 * Assert that the statement fails with the given SQLSTATE. Runs inside a SAVEPOINT so the
 * surrounding transaction stays usable either way.
 */
export async function expectPgError(
	client: PoolClient,
	sql: string,
	params: unknown[],
	sqlstate: string,
): Promise<void> {
	await client.query("SAVEPOINT expect_pg_error");
	let failure: unknown = null;
	let succeeded = false;
	try {
		await client.query(sql, params);
		succeeded = true;
	} catch (err) {
		failure = err;
	}
	await client.query("ROLLBACK TO SAVEPOINT expect_pg_error");
	await client.query("RELEASE SAVEPOINT expect_pg_error");
	if (succeeded) throw new Error(`Expected SQLSTATE ${sqlstate} but the statement succeeded`);
	const code = (failure as { code?: string } | null)?.code;
	if (code !== sqlstate) {
		throw new Error(`Expected SQLSTATE ${sqlstate} but got ${String(code)}: ${toError(failure).message}`);
	}
}

export interface RlsSubjectRoleInfo {
	rolsuper: boolean;
	rolbypassrls: boolean;
	memberOfOwner: boolean;
	canSetRole: boolean;
}

/** Throw unless the role is one for which RLS policies actually apply and which we can switch to. */
export function assertRlsSubjectRole(info: RlsSubjectRoleInfo): void {
	if (info.rolsuper) throw new Error(`${APP_ROLE} is a superuser; RLS would not apply`);
	if (info.rolbypassrls) throw new Error(`${APP_ROLE} has BYPASSRLS; RLS would not apply`);
	if (info.memberOfOwner) {
		throw new Error(`${APP_ROLE} is a member of oscorpex_owner; it would inherit table ownership and bypass RLS`);
	}
	if (!info.canSetRole) throw new Error(`current_user cannot SET ROLE ${APP_ROLE} (role not settable)`);
}

/** Like withTenantTx but as the non-superuser oscorpex_app role (exists from F1). */
export async function withAppRole<T>(
	tenantId: string | null,
	fn: (client: PoolClient) => Promise<T>,
	opts: Omit<TenantTxOptions, "role"> = {},
): Promise<T> {
	if (!(await roleExists(APP_ROLE))) {
		throw new Error(`Role ${APP_ROLE} does not exist yet; it is created in phase F1 (RLS enforcement).`);
	}
	const ownerExists = await roleExists(OWNER_ROLE);
	const { rows } = await getPool().query<{
		rolsuper: boolean;
		rolbypassrls: boolean;
		can_set_role: boolean;
		member_of_owner: boolean;
	}>(
		`SELECT r.rolsuper, r.rolbypassrls,
		        pg_has_role(current_user, $1, 'MEMBER') AS can_set_role,
		        CASE WHEN $3::boolean THEN pg_has_role($1, $2, 'MEMBER') ELSE false END AS member_of_owner
		 FROM pg_roles r WHERE r.rolname = $1`,
		[APP_ROLE, OWNER_ROLE, ownerExists],
	);
	const row = rows[0];
	assertRlsSubjectRole({
		rolsuper: row.rolsuper,
		rolbypassrls: row.rolbypassrls,
		memberOfOwner: row.member_of_owner,
		canSetRole: row.can_set_role,
	});
	return withTenantTx(tenantId, fn, { ...opts, role: APP_ROLE });
}
