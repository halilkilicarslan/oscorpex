// ---------------------------------------------------------------------------
// F1c — SECURITY DEFINER sys_* functions: the only cross-tenant system path.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool } from "../pg.js";
import { TENANT_A, TENANT_B, expectPgError, seedTestTenants, withAppRole, withMigrator } from "./helpers/tenancy.js";

const SYS_FUNCTIONS = [
	"sys_project_tenant",
	"sys_event_tenant",
	"sys_running_project_phases",
	"sys_running_projects",
	"sys_api_key_lookup",
	"sys_platform_stats",
];

const RUN = randomUUID().slice(0, 8);
const ID = (kind: string, tenant: "a" | "b") => `f1c-${RUN}-${kind}-${tenant}`;
const LIKE = `f1c-${RUN}-%`;
const KEY_HASH = { a: `f1c-${RUN}-hash-a`, b: `f1c-${RUN}-hash-b`, expired: `f1c-${RUN}-hash-expired` };

const TENANTS = { a: TENANT_A, b: TENANT_B } as const;

async function cleanup(): Promise<void> {
	await withMigrator(async (c) => {
		await c.query("DELETE FROM users WHERE id LIKE 'f1c-%'");
		await c.query("DELETE FROM projects WHERE id LIKE 'f1c-%'");
	});
}

async function seed(): Promise<void> {
	await withMigrator(async (c) => {
		for (const k of ["a", "b"] as const) {
			const t = TENANTS[k];
			await c.query(
				"INSERT INTO projects (id, name, status, tenant_id, created_at, updated_at) VALUES ($1, 'f1c', 'running', $2, now(), now())",
				[ID("project", k), t],
			);
			await c.query(
				"INSERT INTO pipeline_runs (id, project_id, status, created_at) VALUES ($1, $2, 'running', now()::text)",
				[ID("run", k), ID("project", k)],
			);
			await c.query(
				"INSERT INTO project_plans (id, project_id, status, tenant_id, created_at) VALUES ($1, $2, 'approved', $3, now())",
				[ID("plan", k), ID("project", k), t],
			);
			await c.query("INSERT INTO phases (id, plan_id, name, status, tenant_id) VALUES ($1, $2, 'f1c', 'running', $3)", [
				ID("phase", k),
				ID("plan", k),
				t,
			]);
			await c.query(
				"INSERT INTO tasks (id, phase_id, title, status, project_id, tenant_id) VALUES ($1, $2, 'f1c', 'done', $3, $4), ($5, $2, 'f1c', 'failed', $3, $4)",
				[ID("task-done", k), ID("phase", k), ID("project", k), t, ID("task-failed", k)],
			);
			await c.query("INSERT INTO events (id, project_id, type, timestamp) VALUES ($1, $2, 'f1c', now())", [
				ID("event", k),
				ID("project", k),
			]);
			await c.query(
				"INSERT INTO token_usage (id, project_id, task_id, agent_id, model, cost_usd, created_at) VALUES ($1, $2, $3, 'agent', 'model', 1.25, now())",
				[ID("usage", k), ID("project", k), ID("task-done", k)],
			);
			await c.query("INSERT INTO users (id, email, password_hash, tenant_id) VALUES ($1, $2, 'x', $3)", [
				ID("user", k),
				`${ID("user", k)}@example.test`,
				t,
			]);
			await c.query("INSERT INTO user_roles (user_id, tenant_id, role) VALUES ($1, $2, $3)", [
				ID("user", k),
				t,
				k === "a" ? "owner" : "viewer",
			]);
			await c.query(
				"INSERT INTO api_keys (id, tenant_id, user_id, key_hash, name, scopes) VALUES ($1, $2, $3, $4, 'f1c', ARRAY['read'])",
				[ID("key", k), t, ID("user", k), KEY_HASH[k]],
			);
		}
		await c.query(
			"INSERT INTO api_keys (id, tenant_id, user_id, key_hash, name, expires_at) VALUES ($1, $2, $3, $4, 'f1c', now() - interval '1 day')",
			[`${ID("key", "a")}-exp`, TENANT_A, ID("user", "a"), KEY_HASH.expired],
		);
	});
}

beforeAll(async () => {
	await seedTestTenants();
	await cleanup();
	await seed();
}, 60_000);

afterAll(async () => {
	await cleanup();
});

// 1. function catalog properties
describe("sys_* function catalog", () => {
	for (const name of SYS_FUNCTIONS) {
		it(`${name}: owned by oscorpex_sysread, SECURITY DEFINER, pinned search_path, no PUBLIC EXECUTE, app can EXECUTE`, async () => {
			const { rows } = await getPool().query<{
				owner: string;
				prosecdef: boolean;
				proconfig: string[] | null;
				public_exec: boolean;
				app_exec: boolean;
			}>(
				`SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig,
				   EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
				           WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec,
				   has_function_privilege('oscorpex_app', p.oid, 'EXECUTE') AS app_exec
				 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
				 WHERE n.nspname = 'public' AND p.proname = $1`,
				[name],
			);
			expect(rows, `${name} must exist exactly once`).toHaveLength(1);
			const r = rows[0];
			expect(r.owner).toBe("oscorpex_sysread");
			expect(r.prosecdef).toBe(true);
			expect((r.proconfig ?? []).some((c) => c.startsWith("search_path="))).toBe(true);
			expect(r.public_exec).toBe(false);
			expect(r.app_exec).toBe(true);
		});
	}
});

// 2. the sysread role
describe("oscorpex_sysread role", () => {
	it("is NOLOGIN", async () => {
		const { rows } = await getPool().query<{ rolcanlogin: boolean }>(
			"SELECT rolcanlogin FROM pg_roles WHERE rolname = 'oscorpex_sysread'",
		);
		expect(rows[0]?.rolcanlogin).toBe(false);
	});

	it("oscorpex_app is not a member of oscorpex_sysread or oscorpex_owner (catalog)", async () => {
		for (const role of ["oscorpex_sysread", "oscorpex_owner"]) {
			const { rows } = await getPool().query<{ m: boolean }>("SELECT pg_has_role('oscorpex_app', $1, 'MEMBER') AS m", [
				role,
			]);
			expect(rows[0].m, role).toBe(false);
		}
	});

	it("oscorpex_app cannot SET ROLE to oscorpex_sysread (42501) when the session user is not a superuser", async (ctx) => {
		const { rows } = await getPool().query<{ su: boolean }>(
			"SELECT rolsuper AS su FROM pg_roles WHERE rolname = session_user",
		);
		// A superuser session may SET ROLE to anything (checked against session_user), so this sub-check
		// proves nothing there; the catalog test above is the primary assertion.
		if (rows[0].su) ctx.skip();
		await withAppRole(TENANT_A, async (c) => {
			await expectPgError(c, "SET ROLE oscorpex_sysread", [], "42501");
		});
	});

	it("has no INSERT/UPDATE/DELETE/TRUNCATE on any public table", async () => {
		const { rows } = await getPool().query<{ relname: string }>(
			`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
			 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
			   AND (has_table_privilege('oscorpex_sysread', c.oid, 'INSERT')
			     OR has_table_privilege('oscorpex_sysread', c.oid, 'UPDATE')
			     OR has_table_privilege('oscorpex_sysread', c.oid, 'DELETE')
			     OR has_table_privilege('oscorpex_sysread', c.oid, 'TRUNCATE'))`,
		);
		const bad = rows.map((r) => r.relname);
		expect(bad, `sysread has write privileges on: ${bad.join(", ")}`).toEqual([]);
	});

	it("has SELECT on at least the tables the sys_* functions read", async () => {
		const { rows } = await getPool().query<{ relname: string }>(
			`SELECT unnest AS relname FROM unnest(ARRAY['projects','pipeline_runs','project_plans','phases','tasks','events','token_usage','api_keys','user_roles'])
			 WHERE NOT has_table_privilege('oscorpex_sysread', 'public.' || unnest, 'SELECT')`,
		);
		expect(rows.map((r) => r.relname)).toEqual([]);
	});

	it("any policy naming oscorpex_sysread is FOR SELECT and TO oscorpex_sysread only", async () => {
		const { rows } = await getPool().query<{ tablename: string; policyname: string; cmd: string; roles: string[] }>(
			`SELECT tablename, policyname, cmd, roles::text[] AS roles FROM pg_policies
			 WHERE schemaname = 'public' AND 'oscorpex_sysread' = ANY (roles::text[])`,
		);
		const bad = rows
			.filter((r) => r.cmd !== "SELECT" || r.roles.length !== 1)
			.map((r) => `${r.tablename}.${r.policyname}`);
		expect(bad, `non-SELECT / multi-role sysread policies: ${bad.join(", ")}`).toEqual([]);
	});
});

// 3. cross-tenant behavior as the app role scoped to A
describe("cross-tenant system path (app role scoped to A)", () => {
	it("a plain SELECT of B's project returns 0 rows while sys_project_tenant resolves its tenant", async () => {
		await withAppRole(TENANT_A, async (c) => {
			expect((await c.query("SELECT 1 FROM projects WHERE id = $1", [ID("project", "b")])).rowCount).toBe(0);
			expect((await c.query("SELECT 1 FROM projects WHERE id = $1", [ID("project", "a")])).rowCount).toBe(1);
			const b = await c.query("SELECT sys_project_tenant($1) AS t", [ID("project", "b")]);
			expect(b.rows[0].t).toBe(TENANT_B);
			const a = await c.query("SELECT sys_project_tenant($1) AS t", [ID("project", "a")]);
			expect(a.rows[0].t).toBe(TENANT_A);
			const unknown = await c.query("SELECT sys_project_tenant($1) AS t", [`f1c-${RUN}-nope`]);
			expect(unknown.rows[0].t).toBeNull();
		});
	});

	it("sys_event_tenant returns the tenant of the event's project (NULL for unknown)", async () => {
		await withAppRole(TENANT_A, async (c) => {
			expect((await c.query("SELECT sys_event_tenant($1) AS t", [ID("event", "a")])).rows[0].t).toBe(TENANT_A);
			expect((await c.query("SELECT sys_event_tenant($1) AS t", [ID("event", "b")])).rows[0].t).toBe(TENANT_B);
			expect((await c.query("SELECT sys_event_tenant($1) AS t", [`f1c-${RUN}-nope`])).rows[0].t).toBeNull();
		});
	});

	it("sys_running_project_phases() includes running phases of both tenants with their tenant_id", async () => {
		await withAppRole(TENANT_A, async (c) => {
			const { rows } = await c.query<{ project_id: string; phase_id: string; tenant_id: string }>(
				"SELECT project_id, phase_id, tenant_id FROM sys_running_project_phases() WHERE project_id LIKE $1 ORDER BY project_id",
				[LIKE],
			);
			expect(rows).toEqual([
				{ project_id: ID("project", "a"), phase_id: ID("phase", "a"), tenant_id: TENANT_A },
				{ project_id: ID("project", "b"), phase_id: ID("phase", "b"), tenant_id: TENANT_B },
			]);
		});
	});

	it("sys_running_projects() includes running projects of both tenants", async () => {
		await withAppRole(TENANT_A, async (c) => {
			const { rows } = await c.query<{ project_id: string; tenant_id: string }>(
				"SELECT project_id, tenant_id FROM sys_running_projects() WHERE project_id LIKE $1 ORDER BY project_id",
				[LIKE],
			);
			expect(rows).toEqual([
				{ project_id: ID("project", "a"), tenant_id: TENANT_A },
				{ project_id: ID("project", "b"), tenant_id: TENANT_B },
			]);
		});
	});

	it("sys_api_key_lookup returns the key with tenant/role/scopes; nothing for unknown or expired hashes", async () => {
		await withAppRole(TENANT_A, async (c) => {
			const a = await c.query("SELECT * FROM sys_api_key_lookup($1)", [KEY_HASH.a]);
			expect(a.rows).toEqual([
				{ id: ID("key", "a"), user_id: ID("user", "a"), tenant_id: TENANT_A, scopes: ["read"], role: "owner" },
			]);
			const b = await c.query("SELECT * FROM sys_api_key_lookup($1)", [KEY_HASH.b]);
			expect(b.rows).toEqual([
				{ id: ID("key", "b"), user_id: ID("user", "b"), tenant_id: TENANT_B, scopes: ["read"], role: "viewer" },
			]);
			expect((await c.query("SELECT * FROM sys_api_key_lookup($1)", [`f1c-${RUN}-unknown`])).rowCount).toBe(0);
			expect((await c.query("SELECT * FROM sys_api_key_lookup($1)", [KEY_HASH.expired])).rowCount).toBe(0);
		});
	});

	it("sys_platform_stats() counts rows of all tenants", async () => {
		const truth = await withMigrator(async (m) => {
			const { rows } = await m.query(
				`SELECT (SELECT count(*) FROM projects)::int AS total_projects,
				        (SELECT count(*) FROM tasks)::int AS total_tasks,
				        (SELECT count(*) FILTER (WHERE status = 'done') FROM tasks)::int AS tasks_done,
				        (SELECT count(*) FILTER (WHERE status = 'failed') FROM tasks)::int AS tasks_failed,
				        (SELECT coalesce(sum(cost_usd), 0) FROM token_usage)::float8 AS total_cost_usd`,
			);
			return rows[0];
		});
		const stats = await withAppRole(
			TENANT_A,
			async (c) => (await c.query("SELECT sys_platform_stats() AS s")).rows[0].s,
		);
		expect(Number(stats.total_projects)).toBe(truth.total_projects);
		expect(Number(stats.total_tasks)).toBe(truth.total_tasks);
		expect(Number(stats.tasks_done)).toBe(truth.tasks_done);
		expect(Number(stats.tasks_failed)).toBe(truth.tasks_failed);
		expect(Number(stats.total_cost_usd)).toBeCloseTo(truth.total_cost_usd, 4);
		expect(Number(stats.total_projects)).toBeGreaterThanOrEqual(2);
	});
});

// 4. result shape
describe("sys_* result shape", () => {
	it("table functions return only the declared columns", async () => {
		await withAppRole(TENANT_A, async (c) => {
			const phases = await c.query("SELECT * FROM sys_running_project_phases() WHERE project_id LIKE $1", [LIKE]);
			expect(Object.keys(phases.rows[0] ?? {}).sort()).toEqual(["phase_id", "project_id", "tenant_id"]);
			const projects = await c.query("SELECT * FROM sys_running_projects() WHERE project_id LIKE $1", [LIKE]);
			expect(Object.keys(projects.rows[0] ?? {}).sort()).toEqual(["project_id", "tenant_id"]);
			const key = await c.query("SELECT * FROM sys_api_key_lookup($1)", [KEY_HASH.a]);
			expect(Object.keys(key.rows[0] ?? {}).sort()).toEqual(["id", "role", "scopes", "tenant_id", "user_id"]);
		});
	});

	it("sys_platform_stats() returns aggregate numbers only, including the required keys", async () => {
		const stats = await withAppRole(
			TENANT_A,
			async (c) => (await c.query("SELECT sys_platform_stats() AS s")).rows[0].s,
		);
		for (const k of ["total_projects", "total_tasks", "tasks_done", "tasks_failed", "total_cost_usd"]) {
			expect(stats, k).toHaveProperty(k);
		}
		for (const [k, v] of Object.entries(stats)) {
			expect(typeof v === "number" || (typeof v === "string" && !Number.isNaN(Number(v))), `${k} is not numeric`).toBe(
				true,
			);
		}
	});
});

// 5. no tenant set
describe("system path without a tenant scope", () => {
	it("sys_* functions work while a plain SELECT on projects returns 0", async () => {
		await withAppRole(null, async (c) => {
			expect((await c.query("SELECT count(*)::int AS n FROM projects")).rows[0].n).toBe(0);
			expect((await c.query("SELECT sys_project_tenant($1) AS t", [ID("project", "a")])).rows[0].t).toBe(TENANT_A);
			const running = await c.query("SELECT project_id FROM sys_running_projects() WHERE project_id LIKE $1", [LIKE]);
			expect(running.rowCount).toBe(2);
			const phases = await c.query("SELECT 1 FROM sys_running_project_phases() WHERE project_id LIKE $1", [LIKE]);
			expect(phases.rowCount).toBe(2);
			expect((await c.query("SELECT * FROM sys_api_key_lookup($1)", [KEY_HASH.a])).rowCount).toBe(1);
			expect((await c.query("SELECT sys_event_tenant($1) AS t", [ID("event", "b")])).rows[0].t).toBe(TENANT_B);
			expect((await c.query("SELECT sys_platform_stats() AS s")).rows[0].s).toBeTruthy();
		});
	});
});
