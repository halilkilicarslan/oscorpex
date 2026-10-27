// ---------------------------------------------------------------------------
// F1 review round 1: schema-apply gating, fresh-DB apply, column-level
// privileges, search_path / default-ACL hardening and role hygiene.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getPool } from "../pg.js";
import { TABLE_CLASSIFICATION } from "../tenancy/table-classification.js";
import { type RuntimeIsolationInfo, loadBootstrap, runApplySchema } from "./helpers/apply-schema.js";
import { TENANT_A, expectPgError, seedTestTenants, withAppRole, withMigrator } from "./helpers/tenancy.js";

const F1_TABLES = Object.entries(TABLE_CLASSIFICATION)
	.filter(([, e]) => e.rlsPhase === "F1")
	.map(([t]) => t)
	.sort();

const migrationBase = () => process.env.OSCORPEX_MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
function urlForDb(base: string, db: string): string {
	const u = new URL(base);
	u.pathname = `/${db}`;
	return u.toString();
}

// ---------------------------------------------------------------------------
// 1. Fresh database, single apply
// ---------------------------------------------------------------------------
describe("fresh database", () => {
	beforeAll(async () => {
		await withMigrator(async (c) => {
			const { rows } = await c.query<{ datname: string }>(
				"SELECT datname FROM pg_database WHERE datname LIKE 'f1r\\_%'",
			);
			for (const r of rows) await c.query(`DROP DATABASE IF EXISTS "${r.datname}" WITH (FORCE)`);
		});
	}, 60_000);

	it("a single applySchema on an empty database yields sysread policies and working sys_* functions", async () => {
		const dbName = `f1r_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
		await withMigrator(async (c) => {
			await c.query(`CREATE DATABASE "${dbName}"`);
		});
		try {
			const result = await runApplySchema({
				migrationUrl: urlForDb(migrationBase(), dbName),
				runtimeUrl: urlForDb(process.env.DATABASE_URL ?? "", dbName),
			});
			expect(result.applied).toBe(true);

			const client = new pg.Client({ connectionString: urlForDb(migrationBase(), dbName) });
			await client.connect();
			try {
				const pol = await client.query<{ n: number }>(
					"SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public' AND policyname = 'sysread_select'",
				);
				expect(pol.rows[0].n).toBe(7);

				await client.query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'f1r', $2)", [TENANT_A, `f1r-${dbName}`]);
				await client.query(
					"INSERT INTO projects (id, name, tenant_id, created_at, updated_at) VALUES ('f1r-project', 'f1r', $1, now(), now())",
					[TENANT_A],
				);
				const t = await client.query("SELECT sys_project_tenant('f1r-project') AS t");
				expect(t.rows[0].t).toBe(TENANT_A);
			} finally {
				await client.end();
			}
		} finally {
			await withMigrator(async (c) => {
				await c.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
			});
		}
	}, 240_000);
});

// ---------------------------------------------------------------------------
// 2. Apply gating
// ---------------------------------------------------------------------------
describe("applySchema gating", () => {
	it("reports unchanged, forced and drift correctly", async () => {
		await runApplySchema();
		expect(await runApplySchema()).toEqual({ applied: false, reason: "unchanged" });
		expect(await runApplySchema({ force: true })).toEqual({ applied: true, reason: "forced" });

		try {
			await withMigrator(async (c) => {
				await c.query("DROP POLICY sysread_select ON projects");
			});
			expect(await runApplySchema()).toEqual({ applied: true, reason: "drift" });
			const { rowCount } = await getPool().query(
				"SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'sysread_select'",
			);
			expect(rowCount).toBe(1);
		} finally {
			await runApplySchema({ force: true });
		}
	}, 240_000);

	it("stores the init.sql hash in schema_meta", async () => {
		await runApplySchema();
		const rows = await withMigrator(
			async (c) => (await c.query<{ value: string }>("SELECT value FROM schema_meta")).rows,
		);
		expect(rows.some((r) => /^[0-9a-f]{64}$/.test(r.value))).toBe(true);
		const { prepareSchemaSql, schemaHash } = await loadBootstrap();
		const vec = await getPool().query<{ has: boolean }>(
			"SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS has",
		);
		const raw = readFileSync(join(process.cwd(), "scripts", "init.sql"), "utf8");
		const expected = schemaHash(prepareSchemaSql(raw, { hasVector: vec.rows[0].has }));
		expect(rows.map((r) => r.value)).toContain(expected);
	}, 120_000);
});

describe("production strictness", () => {
	const saved = {
		NODE_ENV: process.env.NODE_ENV,
		OSCORPEX_MIGRATION_DATABASE_URL: process.env.OSCORPEX_MIGRATION_DATABASE_URL,
	};
	afterEach(() => {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) Reflect.deleteProperty(process.env, k);
			else process.env[k] = v;
		}
	});

	it("applySchema requires OSCORPEX_MIGRATION_DATABASE_URL in production (no DATABASE_URL fallback)", async () => {
		process.env.NODE_ENV = "production";
		Reflect.deleteProperty(process.env, "OSCORPEX_MIGRATION_DATABASE_URL");
		await expect(runApplySchema()).rejects.toThrow(/OSCORPEX_MIGRATION_DATABASE_URL/);
	});

	it("applyDbBootstrap rethrows in production instead of warning", async () => {
		process.env.NODE_ENV = "production";
		process.env.OSCORPEX_MIGRATION_DATABASE_URL = "postgresql://nobody:nopass@127.0.0.1:1/none";
		const mod = (await import("../db-bootstrap.js")) as { applyDbBootstrap: () => Promise<void> };
		await expect(mod.applyDbBootstrap()).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// 6. is_platform_admin column privileges
// ---------------------------------------------------------------------------
describe("users.is_platform_admin column privileges", () => {
	it("catalog: oscorpex_app cannot INSERT/UPDATE is_platform_admin but can write other columns", async () => {
		const q = (col: string, priv: string) =>
			getPool()
				.query<{ ok: boolean }>("SELECT has_column_privilege('oscorpex_app', 'public.users', $1, $2) AS ok", [
					col,
					priv,
				])
				.then((r) => r.rows[0].ok);
		expect(await q("is_platform_admin", "INSERT")).toBe(false);
		expect(await q("is_platform_admin", "UPDATE")).toBe(false);
		expect(await q("display_name", "INSERT")).toBe(true);
		expect(await q("display_name", "UPDATE")).toBe(true);
	});

	it("as oscorpex_app: UPDATE/INSERT of is_platform_admin fail with 42501; other columns work", async () => {
		await seedTestTenants();
		await withAppRole(TENANT_A, async (c) => {
			const id = `f1r-${randomUUID()}`;
			await c.query("INSERT INTO users (id, email, password_hash, tenant_id) VALUES ($1, $2, 'x', $3)", [
				id,
				`${id}@example.test`,
				TENANT_A,
			]);
			const upd = await c.query("UPDATE users SET display_name = 'renamed', updated_at = now() WHERE id = $1", [id]);
			expect(upd.rowCount).toBe(1);
			await expectPgError(c, "UPDATE users SET is_platform_admin = true WHERE id = $1", [id], "42501");
			await expectPgError(
				c,
				"INSERT INTO users (id, email, password_hash, tenant_id, is_platform_admin) VALUES ($1, $2, 'x', $3, true)",
				[`f1r-${randomUUID()}`, `${randomUUID()}@example.test`, TENANT_A],
				"42501",
			);
		});
	});
});

// ---------------------------------------------------------------------------
// 7. search_path and default ACL hardening
// ---------------------------------------------------------------------------
describe("function and schema hardening", () => {
	const PINNED = "search_path=pg_catalog, pg_temp";

	it("every SECURITY DEFINER function in public, app_tenant() and the tenancy trigger functions pin search_path to pg_catalog, pg_temp", async () => {
		const { rows } = await getPool().query<{ proname: string; proconfig: string[] | null }>(
			`SELECT DISTINCT p.proname, p.proconfig FROM pg_proc p
			 WHERE p.pronamespace = 'public'::regnamespace
			   AND (p.prosecdef
			        OR p.proname = 'app_tenant'
			        OR p.oid IN (SELECT t.tgfoid FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
			                     WHERE NOT t.tgisinternal AND c.relname = ANY($1::text[])))`,
			[F1_TABLES],
		);
		const names = rows.map((r) => r.proname);
		expect(names).toContain("app_tenant");
		expect(names.filter((n) => n.startsWith("sys_")).length).toBeGreaterThanOrEqual(6);
		expect(names.some((n) => n.startsWith("tenancy_"))).toBe(true);
		const bad = rows.filter((r) => !(r.proconfig ?? []).includes(PINNED)).map((r) => r.proname);
		expect(bad, `functions without ${PINNED}: ${bad.join(", ")}`).toEqual([]);
	});

	it("PUBLIC has no CREATE on schema public", async () => {
		const { rows } = await getPool().query<{ n: number }>(
			`SELECT count(*)::int AS n FROM pg_namespace ns,
			   aclexplode(coalesce(ns.nspacl, acldefault('n', ns.nspowner))) a
			 WHERE ns.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE'`,
		);
		expect(rows[0].n).toBe(0);
	});

	for (const role of ["oscorpex_owner", "oscorpex_sysread"]) {
		it(`default privileges for ${role} revoke EXECUTE on functions from PUBLIC`, async () => {
			const { rows } = await getPool().query<{ n: number; public_exec: number }>(
				`SELECT count(*)::int AS n,
				   count(*) FILTER (WHERE EXISTS (SELECT 1 FROM aclexplode(d.defaclacl) a
				                                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))::int AS public_exec
				 FROM pg_default_acl d JOIN pg_roles r ON r.oid = d.defaclrole
				 WHERE r.rolname = $1 AND d.defaclobjtype = 'f'`,
				[role],
			);
			expect(rows[0].n, `${role} needs a default ACL entry for functions`).toBeGreaterThanOrEqual(1);
			expect(rows[0].public_exec).toBe(0);
		});
	}
});

// ---------------------------------------------------------------------------
// 8. Role hygiene
// ---------------------------------------------------------------------------
describe("role hygiene", () => {
	it("migrator memberships in oscorpex_owner and oscorpex_sysread are WITH INHERIT FALSE", async () => {
		const rows = await withMigrator(async (c) => {
			const me = (await c.query<{ u: string }>("SELECT current_user AS u")).rows[0].u;
			return (
				await c.query<{ role: string; inherit_option: boolean }>(
					`SELECT r.rolname AS role, am.inherit_option FROM pg_auth_members am
					 JOIN pg_roles r ON r.oid = am.roleid JOIN pg_roles m ON m.oid = am.member
					 WHERE m.rolname = $1 AND r.rolname IN ('oscorpex_owner', 'oscorpex_sysread')`,
					[me],
				)
			).rows;
		});
		expect(rows.map((r) => r.role).sort()).toEqual(["oscorpex_owner", "oscorpex_sysread"]);
		for (const r of rows) expect(r.inherit_option, r.role).toBe(false);
	});

	it("the runtime login is not a MEMBER (any inherit/set option) of oscorpex_owner, oscorpex_sysread or oscorpex_migrator", async (ctx) => {
		const user = decodeURIComponent(new URL(process.env.DATABASE_URL ?? "").username);
		const su = await getPool().query<{ rolsuper: boolean }>("SELECT rolsuper FROM pg_roles WHERE rolname = $1", [user]);
		// A superuser runtime login implicitly has every role; the check only applies to a non-superuser login.
		if (su.rows[0]?.rolsuper) ctx.skip();
		for (const role of ["oscorpex_owner", "oscorpex_sysread", "oscorpex_migrator"]) {
			const { rows } = await getPool().query<{ m: boolean }>("SELECT pg_has_role($1, $2, 'MEMBER') AS m", [user, role]);
			expect(rows[0].m, role).toBe(false);
			const direct = await getPool().query(
				`SELECT 1 FROM pg_auth_members am JOIN pg_roles r ON r.oid = am.roleid JOIN pg_roles m ON m.oid = am.member
				 WHERE m.rolname = $1 AND r.rolname = $2`,
				[user, role],
			);
			expect(direct.rowCount, `${role} direct membership`).toBe(0);
		}
	});
});

// ---------------------------------------------------------------------------
// checkRuntimeIsolation (pure)
// ---------------------------------------------------------------------------
describe("checkRuntimeIsolation", () => {
	const base: RuntimeIsolationInfo = {
		runtimeUser: "app_login",
		migratorUser: "migrator_login",
		rolsuper: false,
		rolbypassrls: false,
		memberOf: [],
	};
	const cases: Array<{
		name: string;
		info: Partial<RuntimeIsolationInfo>;
		fatal: RegExp | null;
		warning: RegExp | null;
	}> = [
		{ name: "clean non-superuser runtime", info: {}, fatal: null, warning: null },
		{
			name: "member of oscorpex_app only (expected)",
			info: { memberOf: ["oscorpex_app"] },
			fatal: null,
			warning: null,
		},
		{
			name: "member of oscorpex_owner",
			info: { memberOf: ["oscorpex_app", "oscorpex_owner"] },
			fatal: /oscorpex_owner/,
			warning: null,
		},
		{
			name: "member of oscorpex_sysread",
			info: { memberOf: ["oscorpex_sysread"] },
			fatal: /oscorpex_sysread/,
			warning: null,
		},
		{
			name: "member of oscorpex_migrator",
			info: { memberOf: ["oscorpex_migrator"] },
			fatal: /oscorpex_migrator/,
			warning: null,
		},
		{ name: "BYPASSRLS runtime", info: { rolbypassrls: true }, fatal: /bypass/i, warning: null },
		{
			name: "superuser runtime (warning, not fatal)",
			info: { rolsuper: true, rolbypassrls: true, memberOf: ["oscorpex_owner", "oscorpex_sysread"] },
			fatal: null,
			warning: /superuser/i,
		},
		{
			name: "runtime is the migrator (warning, not fatal)",
			info: { runtimeUser: "same_login", migratorUser: "same_login" },
			fatal: null,
			warning: /migrator/i,
		},
	];

	for (const c of cases) {
		for (const production of [false, true]) {
			it(`${c.name} (${production ? "production" : "non-production"})`, async () => {
				const { checkRuntimeIsolation } = await loadBootstrap();
				const r = checkRuntimeIsolation({ ...base, ...c.info }, { production });
				if (c.fatal) expect(r.fatal.join("; ")).toMatch(c.fatal);
				else expect(r.fatal).toEqual([]);
				if (c.warning) expect(r.warnings.join("; ")).toMatch(c.warning);
				else expect(r.warnings).toEqual([]);
			});
		}
	}
});

// ---------------------------------------------------------------------------
// schema_meta privileges
// ---------------------------------------------------------------------------
describe("schema_meta is closed to the app role", () => {
	it("SELECT, INSERT, UPDATE and DELETE all fail with 42501", async () => {
		await withAppRole(TENANT_A, async (c) => {
			await expectPgError(c, "SELECT * FROM schema_meta", [], "42501");
			await expectPgError(c, "INSERT INTO schema_meta (key, value) VALUES ('f1r-probe', 'x')", [], "42501");
			await expectPgError(c, "UPDATE schema_meta SET value = 'x'", [], "42501");
			await expectPgError(c, "DELETE FROM schema_meta", [], "42501");
		});
	});
});

// ---------------------------------------------------------------------------
// Deep drift
// ---------------------------------------------------------------------------
describe("deep drift detection", () => {
	it("a tenant policy recreated as USING (true) WITH CHECK (true) is detected and repaired", async () => {
		await runApplySchema();
		const { rows } = await getPool().query<{ policyname: string }>(
			`SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks'
			 AND (roles::text[] && ARRAY['public', 'oscorpex_app'])`,
		);
		expect(rows).toHaveLength(1);
		const name = rows[0].policyname;
		try {
			await withMigrator(async (c) => {
				await c.query(`DROP POLICY "${name}" ON tasks`);
				await c.query(`CREATE POLICY "${name}" ON tasks USING (true) WITH CHECK (true)`);
			});
			expect(await runApplySchema()).toEqual({ applied: true, reason: "drift" });
			const after = await getPool().query<{ qual: string; with_check: string }>(
				"SELECT qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks' AND policyname = $1",
				[name],
			);
			expect(after.rows).toHaveLength(1);
			expect(after.rows[0].qual).toMatch(/app_tenant\(\)/);
			expect(after.rows[0].with_check).toMatch(/app_tenant\(\)/);
		} finally {
			await runApplySchema({ force: true });
		}
	}, 240_000);

	it("an extra function owned by oscorpex_sysread does not cause drift", async () => {
		await runApplySchema();
		try {
			await withMigrator(async (c) => {
				await c.query("CREATE OR REPLACE FUNCTION public.sys_zz_probe() RETURNS int LANGUAGE sql AS 'SELECT 1'");
				await c.query("ALTER FUNCTION public.sys_zz_probe() OWNER TO oscorpex_sysread");
			});
			expect(await runApplySchema()).toEqual({ applied: false, reason: "unchanged" });
		} finally {
			await withMigrator(async (c) => {
				await c.query("DROP FUNCTION IF EXISTS public.sys_zz_probe()");
			});
		}
	}, 120_000);
});
