// ---------------------------------------------------------------------------
// F2d — default test tenant scope, NOT NULL tenant_id, tenant FK RESTRICT, write fixes.
// Runs in both modes. Plain `it` bodies run inside the DEFAULT scope (local tenant);
// `itOut` bodies run outside it.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signJwt } from "../auth/jwt.js";
import { addEdge, insertNode, splitTask } from "../graph-coordinator.js";
import { studioRoutes } from "../index.js";
import { query } from "../pg.js";
import { getWorkspaceRoot } from "../security/workspace-resolver.js";
import { currentScope, runAsSystem, runInTenant, runOutsideScope } from "../tenancy/tenant-scope.js";
import { runApplySchema } from "./helpers/apply-schema.js";
import { seedUser } from "./helpers/identity.js";
import { it as itOut } from "./helpers/outside-scope.js";
import { TENANT_A, TENANT_B, TENANT_LOCAL, expectPgError, withAppRole, withMigrator } from "./helpers/tenancy.js";

const DIRECT_TABLES = [
	"projects",
	"tasks",
	"phases",
	"project_plans",
	"notifications",
	"checkpoints",
	"rollback_requests",
	"git_checkpoints",
	"commit_proposals",
	"hermes_api_keys",
	"hermes_sessions",
].sort();

// ---------------------------------------------------------------------------
// 1. Default test scope
// ---------------------------------------------------------------------------
describe("default test tenant scope", () => {
	it("a plain test body runs in the local tenant scope", () => {
		expect(currentScope()).toEqual({ kind: "tenant", tenantId: TENANT_LOCAL });
	});

	it("scope survives awaits inside a plain test", async () => {
		await new Promise((r) => setTimeout(r, 5));
		expect(currentScope()).toEqual({ kind: "tenant", tenantId: TENANT_LOCAL });
	});

	it("queries in a plain test see the local tenant GUC", async () => {
		const rows = await query<{ t: string }>("SELECT current_setting('app.current_tenant_id', true) AS t");
		expect(rows[0].t).toBe(TENANT_LOCAL);
	});

	it("strict scope mode does not reject queries in the default scope", async () => {
		const prev = process.env.OSCORPEX_TENANT_SCOPE_MODE;
		process.env.OSCORPEX_TENANT_SCOPE_MODE = "strict";
		try {
			await expect(query("SELECT 1")).resolves.toHaveLength(1);
		} finally {
			if (prev === undefined) Reflect.deleteProperty(process.env, "OSCORPEX_TENANT_SCOPE_MODE");
			else process.env.OSCORPEX_TENANT_SCOPE_MODE = prev;
		}
	});

	it("runOutsideScope exits the scope (sync and async) and restores it afterwards", async () => {
		expect(runOutsideScope(() => currentScope())).toBeUndefined();
		await expect(
			runOutsideScope(async () => {
				await new Promise((r) => setTimeout(r, 2));
				return currentScope();
			}),
		).resolves.toBeUndefined();
		expect(currentScope()).toEqual({ kind: "tenant", tenantId: TENANT_LOCAL });
	});

	it("runOutsideScope propagates results and errors", async () => {
		await expect(runOutsideScope(async () => 42)).resolves.toBe(42);
		await expect(
			runOutsideScope(async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(currentScope()).toEqual({ kind: "tenant", tenantId: TENANT_LOCAL });
	});

	it("inside runOutsideScope other tenants / system scope can be entered", async () => {
		const seen = await runOutsideScope(() => runInTenant(TENANT_A, async () => currentScope()));
		expect(seen).toEqual({ kind: "tenant", tenantId: TENANT_A });
		const sys = await runOutsideScope(() => runAsSystem("f2d", async () => currentScope()));
		expect(sys).toEqual({ kind: "system", reason: "f2d" });
	});

	it("entering another tenant from the default scope is still refused (no accidental cross-tenant)", async () => {
		await expect(runInTenant(TENANT_A, async () => 1)).rejects.toThrow();
	});

	itOut("outside-scope `it` bodies observe no scope", () => {
		expect(currentScope()).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// 2. NOT NULL tenant_id on the 11 direct tables
// ---------------------------------------------------------------------------
describe("tenant_id NOT NULL on direct tables", () => {
	it("catalog: attnotnull on all 11 tables", async () => {
		const rows = await withMigrator((c) =>
			c.query<{ relname: string; attnotnull: boolean }>(
				`SELECT c.relname, a.attnotnull FROM pg_attribute a
				 JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
				 WHERE n.nspname = 'public' AND a.attname = 'tenant_id' AND NOT a.attisdropped AND c.relname = ANY($1)`,
				[DIRECT_TABLES],
			),
		);
		expect(rows.rows.map((r) => r.relname).sort()).toEqual(DIRECT_TABLES);
		for (const r of rows.rows) expect(r.attnotnull, r.relname).toBe(true);
	});

	it("catalog: no left-over NOT VALID tenant check constraints when no NULL rows exist", async () => {
		const rows = await withMigrator((c) =>
			c.query(
				`SELECT conrelid::regclass::text AS tbl, conname FROM pg_constraint
				 WHERE contype = 'c' AND NOT convalidated AND conrelid::regclass::text = ANY($1)`,
				[DIRECT_TABLES],
			),
		);
		expect(rows.rows).toEqual([]);
	});

	/** INSERT with every required column filled with a dummy value except tenant_id = NULL. */
	async function insertNullTenantSql(client: import("pg").PoolClient | import("pg").Client, table: string) {
		const cols = await client.query<{ column_name: string; data_type: string }>(
			`SELECT column_name, data_type FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = $1 AND is_nullable = 'NO' AND column_default IS NULL
			   AND column_name <> 'tenant_id' AND is_generated = 'NEVER' ORDER BY ordinal_position`,
			[table],
		);
		const dummy = (t: string): unknown => {
			if (t.includes("timestamp")) return new Date().toISOString();
			if (t === "integer" || t === "bigint" || t === "smallint" || t === "numeric" || t === "double precision")
				return 0;
			if (t === "boolean") return false;
			if (t === "jsonb" || t === "json") return "{}";
			if (t === "ARRAY") return "{}";
			if (t === "uuid") return randomUUID();
			return `f2d-${randomUUID()}`;
		};
		const names = [...cols.rows.map((c) => c.column_name), "tenant_id"];
		const params = cols.rows.map((c) => dummy(c.data_type));
		const placeholders = [...params.map((_, i) => `$${i + 1}`), "NULL"];
		return { sql: `INSERT INTO ${table} (${names.join(", ")}) VALUES (${placeholders.join(", ")})`, params };
	}

	for (const table of DIRECT_TABLES) {
		itOut(`${table}: explicit NULL tenant_id is rejected with 23502 (owner/migrator connection)`, async () => {
			await withMigrator(async (c) => {
				const { sql, params } = await insertNullTenantSql(c, table);
				await c.query("BEGIN");
				try {
					await expect(c.query(sql, params)).rejects.toMatchObject({ code: "23502" });
				} finally {
					await c.query("ROLLBACK");
				}
			});
		});

		itOut(`${table}: app role with no tenant set cannot insert a NULL-tenant row`, async () => {
			const { sql, params } = await withMigrator((c) => insertNullTenantSql(c, table));
			await withAppRole(null, async (client) => {
				// 23502 (NOT NULL) or 42501 (RLS WITH CHECK, evaluated first) — never a successful insert
				await client.query("SAVEPOINT f2d_nn");
				let code: string | undefined;
				try {
					await client.query(sql, params);
				} catch (e) {
					code = (e as { code?: string }).code;
				}
				await client.query("ROLLBACK TO SAVEPOINT f2d_nn");
				expect(["23502", "42501", "23514"]).toContain(code);
			});
		});
	}

	itOut(
		"legacy NULL rows: applySchema does not fail, leaves a NOT VALID check, new NULLs rejected; restorable",
		async () => {
			const id = `f2d-legacy-${randomUUID()}`;
			try {
				await withMigrator(async (c) => {
					await c.query("ALTER TABLE projects ALTER COLUMN tenant_id DROP NOT NULL");
					await c.query(
						"INSERT INTO projects (id, name, created_at, updated_at, tenant_id) VALUES ($1, 'f2d-legacy', now(), now(), NULL)",
						[id],
					);
				});

				await expect(runApplySchema({ force: true })).resolves.toBeDefined();

				const check = await withMigrator((c) =>
					c.query<{ conname: string; convalidated: boolean; def: string }>(
						`SELECT conname, convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint
					 WHERE conrelid = 'projects'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%tenant_id%IS NOT NULL%'`,
					),
				);
				expect(check.rows.length).toBe(1);
				expect(check.rows[0].convalidated).toBe(false);

				// New NULL inserts are rejected by the NOT VALID check (23514); the legacy row survives
				await withMigrator(async (c) => {
					await expect(
						c.query(
							"INSERT INTO projects (id, name, created_at, updated_at, tenant_id) VALUES ($1, 'f2d-new', now(), now(), NULL)",
							[`f2d-new-${randomUUID()}`],
						),
					).rejects.toMatchObject({ code: "23514" });
					const legacy = await c.query("SELECT 1 FROM projects WHERE id = $1", [id]);
					expect(legacy.rowCount).toBe(1);
				});
			} finally {
				await withMigrator(async (c) => {
					await c.query("DELETE FROM projects WHERE id = $1", [id]);
					await c.query(
						`DO $$ DECLARE r record; BEGIN
					   FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'projects'::regclass AND contype = 'c'
					            AND NOT convalidated AND pg_get_constraintdef(oid) ILIKE '%tenant_id%IS NOT NULL%'
					   LOOP EXECUTE format('ALTER TABLE projects DROP CONSTRAINT %I', r.conname); END LOOP; END $$`,
					);
				});
				await runApplySchema({ force: true });
			}
			// restored: NOT NULL enforced again
			const restored = await withMigrator((c) =>
				c.query<{ attnotnull: boolean }>(
					"SELECT attnotnull FROM pg_attribute WHERE attrelid = 'projects'::regclass AND attname = 'tenant_id'",
				),
			);
			expect(restored.rows[0].attnotnull).toBe(true);
		},
	);
});

// ---------------------------------------------------------------------------
// 3. projects.tenant_id → tenants FK is RESTRICT
// ---------------------------------------------------------------------------
describe("projects → tenants foreign key", () => {
	it("confdeltype = 'r' on every projects→tenants FK", async () => {
		const rows = await withMigrator((c) =>
			c.query<{ conname: string; confdeltype: string }>(
				`SELECT conname, confdeltype FROM pg_constraint
				 WHERE conrelid = 'projects'::regclass AND contype = 'f' AND confrelid = 'tenants'::regclass`,
			),
		);
		expect(rows.rows.length).toBeGreaterThan(0);
		for (const r of rows.rows) expect(r.confdeltype, r.conname).toBe("r");
	});

	itOut("deleting a tenant that still has projects fails with 23001 (restrict_violation)", async () => {
		const tid = `f2d-tenant-${randomUUID()}`;
		const pid = `f2d-proj-${randomUUID()}`;
		await withMigrator(async (c) => {
			await c.query("INSERT INTO tenants (id, name, slug) VALUES ($1, 'f2d', $1)", [tid]);
			await c.query(
				"INSERT INTO projects (id, name, created_at, updated_at, tenant_id) VALUES ($1, 'f2d', now(), now(), $2)",
				[pid, tid],
			);
			try {
				await expect(c.query("DELETE FROM tenants WHERE id = $1", [tid])).rejects.toMatchObject({ code: "23001" });
			} finally {
				await c.query("DELETE FROM projects WHERE id = $1", [pid]);
				await c.query("DELETE FROM tenants WHERE id = $1", [tid]);
			}
		});
	});
});

// ---------------------------------------------------------------------------
// 4. Write fixes
// ---------------------------------------------------------------------------
const cleanup = { projects: [] as string[], dirs: [] as string[] };

beforeAll(async () => {
	for (const t of [TENANT_A, TENANT_B]) await seedUser({ tenantId: t, id: `u-${t}` });
	await withMigrator(async (c) => {
		for (const [id, slug] of [
			[TENANT_A, "test-tenant-a"],
			[TENANT_B, "test-tenant-b"],
			[TENANT_LOCAL, "local"],
		]) {
			await c.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [
				id,
				slug,
				slug,
			]);
		}
	});
});

afterAll(async () => {
	await withMigrator(async (c) => {
		if (cleanup.projects.length) {
			await c.query("DELETE FROM checkpoints WHERE project_id = ANY($1)", [cleanup.projects]);
			await c.query("DELETE FROM tasks WHERE project_id = ANY($1)", [cleanup.projects]);
			await c.query("DELETE FROM graph_mutations WHERE project_id = ANY($1)", [cleanup.projects]);
			await c.query("DELETE FROM phases WHERE plan_id IN (SELECT id FROM project_plans WHERE project_id = ANY($1))", [
				cleanup.projects,
			]);
			await c.query("DELETE FROM project_plans WHERE project_id = ANY($1)", [cleanup.projects]);
			await c.query("DELETE FROM projects WHERE id = ANY($1)", [cleanup.projects]);
		}
	});
	for (const d of cleanup.dirs) rmSync(d, { recursive: true, force: true });
});

describe("graph-coordinator records the real tenant", () => {
	async function seedGraphProject(tenant: string) {
		const projectId = `f2d-gp-${randomUUID()}`;
		const planId = `f2d-plan-${randomUUID()}`;
		const phaseId = `f2d-phase-${randomUUID()}`;
		const taskId = `f2d-task-${randomUUID()}`;
		const task2 = `f2d-task-${randomUUID()}`;
		cleanup.projects.push(projectId);
		await withMigrator(async (c) => {
			await c.query(
				"INSERT INTO projects (id, name, created_at, updated_at, tenant_id) VALUES ($1, 'f2d', now(), now(), $2)",
				[projectId, tenant],
			);
			await c.query(
				"INSERT INTO project_plans (id, project_id, status, created_at, tenant_id) VALUES ($1, $2, 'approved', now(), $3)",
				[planId, projectId, tenant],
			);
			await c.query("INSERT INTO phases (id, plan_id, name, status, tenant_id) VALUES ($1, $2, 'p', 'running', $3)", [
				phaseId,
				planId,
				tenant,
			]);
			for (const t of [taskId, task2]) {
				await c.query("INSERT INTO tasks (id, phase_id, title, project_id, tenant_id) VALUES ($1, $2, 't', $3, $4)", [
					t,
					phaseId,
					projectId,
					tenant,
				]);
			}
		});
		return { projectId, phaseId, taskId, task2, ctx: { projectId, pipelineRunId: `f2d-run-${randomUUID()}` } };
	}
	const checkpointTenants = async (projectId: string) =>
		(
			await withMigrator((c) =>
				c.query<{ tenant_id: string; reason: string }>(
					"SELECT tenant_id, reason FROM checkpoints WHERE project_id = $1",
					[projectId],
				),
			)
		).rows;

	itOut("insertNode: checkpoint is stored with the project's tenant (not 'system')", async () => {
		const g = await seedGraphProject(TENANT_A);
		await runInTenant(TENANT_A, () =>
			insertNode(g.ctx, { phaseId: g.phaseId, title: "n", description: "d", assignedAgent: "dev" }),
		);
		const rows = await checkpointTenants(g.projectId);
		expect(rows.length).toBeGreaterThan(0);
		for (const r of rows) expect(r.tenant_id).toBe(TENANT_A);
	});

	itOut("splitTask: checkpoint carries the project's tenant", async () => {
		const g = await seedGraphProject(TENANT_B);
		await runInTenant(TENANT_B, () =>
			splitTask(g.ctx, { parentTaskId: g.taskId, children: [{ title: "c", description: "d", assignedAgent: "dev" }] }),
		);
		const rows = await checkpointTenants(g.projectId);
		expect(rows.length).toBeGreaterThan(0);
		for (const r of rows) expect(r.tenant_id).toBe(TENANT_B);
	});

	itOut("addEdge: checkpoint carries the project's tenant", async () => {
		const g = await seedGraphProject(TENANT_A);
		await runInTenant(TENANT_A, () => addEdge(g.ctx, { fromTaskId: g.taskId, toTaskId: g.task2 }));
		const rows = await checkpointTenants(g.projectId);
		expect(rows.length).toBeGreaterThan(0);
		for (const r of rows) expect(r.tenant_id).toBe(TENANT_A);
	});

	it("no hardcoded 'system' tenant remains in graph-coordinator.ts", async () => {
		const { readFileSync } = await import("node:fs");
		const src = readFileSync(join(__dirname, "../graph-coordinator.ts"), "utf8");
		expect(src).not.toMatch(/tenantId:\s*"system"/);
	});
});

describe("project import / from-template get the caller's tenant", () => {
	const token = (tenantId: string) =>
		signJwt({ sub: `u-${tenantId}`, email: `u-${tenantId}@f2r.test`, tenantId, role: "owner" }); // real users seeded in beforeAll
	const post = (tok: string, path: string, body: unknown) =>
		runOutsideScope(async () =>
			studioRoutes.request(path, {
				method: "POST",
				headers: { Authorization: `Bearer ${tok}`, "content-type": "application/json" },
				body: JSON.stringify(body),
			}),
		);
	const tenantOf = async (id: string) =>
		(
			await withMigrator((c) =>
				c.query<{ tenant_id: string | null }>("SELECT tenant_id FROM projects WHERE id = $1", [id]),
			)
		).rows[0]?.tenant_id;

	const withAuth = async (fn: () => Promise<void>) => {
		const prev = process.env.OSCORPEX_AUTH_ENABLED;
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		try {
			await fn();
		} finally {
			if (prev === undefined) Reflect.deleteProperty(process.env, "OSCORPEX_AUTH_ENABLED");
			else process.env.OSCORPEX_AUTH_ENABLED = prev;
		}
	};

	itOut("POST /projects/import stores the caller's tenant", () =>
		withAuth(async () => {
			// Imports must live under <WORKSPACE_ROOT>/<tenant>/ (resolveTenantImportPath); cleaned up in afterAll.
			const dir = join(getWorkspaceRoot(), TENANT_A, `f2d-import-${randomUUID()}`);
			mkdirSync(dir, { recursive: true });
			cleanup.dirs.push(dir);
			writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "f2d", description: "x" }));
			const res = await post(token(TENANT_A), "/projects/import", { name: "f2d-import", repoPath: dir });
			expect(res.status).toBe(201);
			const { id } = (await res.json()) as { id: string };
			cleanup.projects.push(id);
			expect(await tenantOf(id)).toBe(TENANT_A);
		}),
	);

	itOut("POST /projects/from-template stores the caller's tenant", () =>
		withAuth(async () => {
			const res = await post(token(TENANT_B), "/projects/from-template", {
				name: "f2d-tpl",
				templateId: "express-api",
			});
			expect(res.status).toBe(201);
			const { id } = (await res.json()) as { id: string };
			cleanup.projects.push(id);
			expect(await tenantOf(id)).toBe(TENANT_B);
		}),
	);

	itOut("plain POST /projects still stores the caller's tenant (regression)", () =>
		withAuth(async () => {
			const res = await post(token(TENANT_A), "/projects", {
				name: "f2d-plain",
				description: "f2d plain project description",
			});
			expect(res.status).toBe(201);
			const { id } = (await res.json()) as { id: string };
			cleanup.projects.push(id);
			expect(await tenantOf(id)).toBe(TENANT_A);
		}),
	);
});

// keep `expectPgError` import used for parity with other tenancy tests
void expectPgError;
