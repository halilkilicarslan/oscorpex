// ---------------------------------------------------------------------------
// F1b — schema + RLS policies: app_tenant(), FORCE RLS on the 20 F1 tables,
// strict policies, composite tenant FKs, immutable tenant_id, idempotent
// schema application. Runs as oscorpex_app via withAppRole.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { getPool } from "../pg.js";
import { TABLE_CLASSIFICATION } from "../tenancy/table-classification.js";
import { runApplySchema } from "./helpers/apply-schema.js";
import { POLICY_SQL, type PolicyRow, policyProblems } from "./helpers/rls-catalog.js";
import {
	TENANT_A,
	TENANT_B,
	TENANT_LOCAL,
	expectPgError,
	seedTestTenants,
	withAppRole,
	withMigrator,
} from "./helpers/tenancy.js";

const F1_TABLES = Object.entries(TABLE_CLASSIFICATION)
	.filter(([, e]) => e.rlsPhase === "F1")
	.map(([t]) => t)
	.sort();
const DIRECT_TABLES = [
	"projects",
	"tasks",
	"phases",
	"project_plans",
	"checkpoints",
	"rollback_requests",
	"git_checkpoints",
	"commit_proposals",
	"hermes_api_keys",
	"hermes_sessions",
	"notifications",
].sort();
const NEWER_DIRECT = [
	"checkpoints",
	"rollback_requests",
	"git_checkpoints",
	"commit_proposals",
	"hermes_api_keys",
	"hermes_sessions",
	"notifications",
];

const setTenant = (client: PoolClient, tenantId: string) =>
	client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);

async function applySchema(force = false): Promise<void> {
	await runApplySchema(force ? { force: true } : undefined);
}

async function policySnapshot(): Promise<string> {
	const { rows } = await getPool().query(
		`SELECT tablename, policyname, permissive, roles::text AS roles, cmd, qual, with_check
		 FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1::text[])
		 ORDER BY tablename, policyname`,
		[F1_TABLES],
	);
	return JSON.stringify(rows);
}

// ---------------------------------------------------------------------------
describe("sanity", () => {
	it("there are 20 F1 tables: 11 direct tenant_id tables and 9 subquery tables", () => {
		expect(F1_TABLES).toHaveLength(20);
		expect(DIRECT_TABLES).toHaveLength(11);
		expect(F1_TABLES.filter((t) => !DIRECT_TABLES.includes(t))).toHaveLength(9);
	});
});

// 1. app_tenant()
describe("app_tenant()", () => {
	it("returns NULL when unset, NULL for '' and the value otherwise, never throwing", async () => {
		const unset = await withAppRole(null, async (c) => (await c.query("SELECT app_tenant() AS v")).rows[0].v);
		expect(unset).toBeNull();
		const empty = await withAppRole("", async (c) => (await c.query("SELECT app_tenant() AS v")).rows[0].v);
		expect(empty).toBeNull();
		const set = await withAppRole(TENANT_A, async (c) => (await c.query("SELECT app_tenant() AS v")).rows[0].v);
		expect(set).toBe(TENANT_A);
	});
});

// 2. fail-closed
describe("fail-closed reads", () => {
	for (const [label, tenant] of [
		["unset", null],
		["empty string", ""],
	] as const) {
		it(`every F1 table returns 0 rows to oscorpex_app when tenant is ${label}`, async () => {
			await withAppRole(tenant, async (c) => {
				for (const t of F1_TABLES) {
					const { rows } = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`);
					expect(rows[0].n, t).toBe(0);
				}
			});
		});
	}
});

// 3. direct tables
describe("direct tables tenant_id", () => {
	it.todo("F2: tenant_id NOT NULL on direct tables");

	it("tenant_id is TEXT on every direct table", async () => {
		const { rows } = await getPool().query<{ table_name: string; data_type: string }>(
			`SELECT c.relname AS table_name, format_type(a.atttypid, a.atttypmod) AS data_type
			 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
			 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped AND a.attname = 'tenant_id' AND c.relname = ANY($1::text[])`,
			[DIRECT_TABLES],
		);
		expect(rows.map((r) => r.table_name).sort()).toEqual(DIRECT_TABLES);
		const bad = rows.filter((r) => r.data_type !== "text").map((r) => r.table_name);
		expect(bad, `wrong tenant_id type: ${bad.join(", ")}`).toEqual([]);
	});

	it("a NULL-tenant project created later stays NULL after a forced applySchema and is invisible to the app role", async () => {
		const id = `f1b-null-${randomUUID().slice(0, 8)}`;
		await withMigrator(async (c) => {
			await c.query(
				"INSERT INTO projects (id, name, tenant_id, created_at, updated_at) VALUES ($1, 'f1b', NULL, now(), now())",
				[id],
			);
		});
		try {
			await applySchema(true);
			await withMigrator(async (c) => {
				const { rows } = await c.query("SELECT tenant_id FROM projects WHERE id = $1", [id]);
				expect(rows).toHaveLength(1);
				expect(rows[0].tenant_id).toBeNull();
			});
			for (const tenant of [TENANT_A, TENANT_B, TENANT_LOCAL, null, ""]) {
				await withAppRole(tenant, async (c) => {
					expect((await c.query("SELECT 1 FROM projects WHERE id = $1", [id])).rowCount, String(tenant)).toBe(0);
				});
			}
		} finally {
			await withMigrator(async (c) => {
				await c.query("DELETE FROM projects WHERE id = $1", [id]);
			});
		}
	}, 180_000);

	it("the local tenant exists with slug 'local'", async () => {
		const { rows } = await getPool().query<{ slug: string }>("SELECT slug FROM tenants WHERE id = $1", [TENANT_LOCAL]);
		expect(rows[0]?.slug).toBe("local");
	});
});

// 4. catalog
describe("policy catalog", () => {
	it("every F1 table has RLS enabled and forced", async () => {
		const { rows } = await getPool().query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
			`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
			 JOIN pg_namespace n ON n.oid = c.relnamespace
			 WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
			[F1_TABLES],
		);
		expect(rows).toHaveLength(F1_TABLES.length);
		const bad = rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity).map((r) => r.relname);
		expect(bad, `RLS not enabled+forced: ${bad.join(", ")}`).toEqual([]);
	});

	it("policies: tenant policies are FOR ALL with app_tenant(); only sysread_select is otherwise allowed", async () => {
		const { rows } = await getPool().query<PolicyRow>(`${POLICY_SQL} AND tablename = ANY($1::text[])`, [F1_TABLES]);
		const subquery = new Set(F1_TABLES.filter((t) => !DIRECT_TABLES.includes(t)));
		const { problems, tenantPolicies } = policyProblems(rows, { subqueryTables: subquery });
		expect(problems, problems.join("; ")).toEqual([]);
		const unpoliced = F1_TABLES.filter((t) => (tenantPolicies.get(t) ?? 0) < 1);
		expect(unpoliced, `F1 tables without tenant policy: ${unpoliced.join(", ")}`).toEqual([]);
	});

	it("projects has exactly one tenant policy (applicable to PUBLIC/oscorpex_app)", async () => {
		const { rows } = await getPool().query(
			`SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'projects'
			 AND (roles::text[] && ARRAY['public', 'oscorpex_app'])`,
		);
		expect(rows).toHaveLength(1);
	});
});

// 5. isolation as the app role (every test runs in a rolled-back transaction)
describe("tenant isolation as oscorpex_app", () => {
	beforeAll(async () => {
		await seedTestTenants();
	});

	const uid = () => `f1b-${randomUUID()}`;
	const now = "now()";
	const insertProject = (c: PoolClient, id: string, tenantId?: string) =>
		tenantId === undefined
			? c.query(
					`INSERT INTO projects (id, name, created_at, updated_at) VALUES ($1, 'f1b', ${now}, ${now}) RETURNING tenant_id`,
					[id],
				)
			: c.query(
					`INSERT INTO projects (id, name, tenant_id, created_at, updated_at) VALUES ($1, 'f1b', $2, ${now}, ${now}) RETURNING tenant_id`,
					[id, tenantId],
				);
	const insertPlan = (c: PoolClient, id: string, projectId: string) =>
		c.query(`INSERT INTO project_plans (id, project_id, created_at) VALUES ($1, $2, ${now}) RETURNING tenant_id`, [
			id,
			projectId,
		]);
	const insertPhase = (c: PoolClient, id: string, planId: string) =>
		c.query("INSERT INTO phases (id, plan_id, name) VALUES ($1, $2, 'f1b') RETURNING tenant_id", [id, planId]);
	const insertTask = (c: PoolClient, id: string, phaseId: string, projectId: string | null) =>
		c.query("INSERT INTO tasks (id, phase_id, title, project_id) VALUES ($1, $2, 'f1b', $3) RETURNING tenant_id", [
			id,
			phaseId,
			projectId,
		]);

	it("a project inserted by A without tenant_id gets A; A sees it, B does not", async () => {
		await withAppRole(TENANT_A, async (c) => {
			const id = uid();
			const r = await insertProject(c, id);
			expect(r.rows[0].tenant_id).toBe(TENANT_A);
			expect((await c.query("SELECT 1 FROM projects WHERE id = $1", [id])).rowCount).toBe(1);
			await setTenant(c, TENANT_B);
			expect((await c.query("SELECT 1 FROM projects WHERE id = $1", [id])).rowCount).toBe(0);
		});
	});

	it("symmetric visibility: B sees its own project; A cannot see it, and A's project is invisible to B", async () => {
		await withAppRole(TENANT_B, async (c) => {
			const bId = uid();
			await insertProject(c, bId);
			expect((await c.query("SELECT 1 FROM projects WHERE id = $1", [bId])).rowCount).toBe(1);
			await setTenant(c, TENANT_A);
			expect((await c.query("SELECT 1 FROM projects WHERE id = $1", [bId])).rowCount).toBe(0);
			const aId = uid();
			await insertProject(c, aId);
			expect((await c.query("SELECT 1 FROM projects WHERE id = $1", [aId])).rowCount).toBe(1);
			await setTenant(c, TENANT_B);
			expect((await c.query("SELECT 1 FROM projects WHERE id = $1", [aId])).rowCount).toBe(0);
		});
	});

	it("A inserting a project with tenant_id = B fails with 42501 (WITH CHECK)", async () => {
		await withAppRole(TENANT_A, async (c) => {
			await expectPgError(
				c,
				"INSERT INTO projects (id, name, tenant_id, created_at, updated_at) VALUES ($1, 'f1b', $2, now(), now())",
				[uid(), TENANT_B],
				"42501",
			);
		});
	});

	it("A moving its project to tenant B fails with 42501 (immutable tenant_id)", async () => {
		await withAppRole(TENANT_A, async (c) => {
			const id = uid();
			await insertProject(c, id);
			await expectPgError(c, "UPDATE projects SET tenant_id = $2 WHERE id = $1", [id, TENANT_B], "42501");
		});
	});

	it("A inserting a project_plan for B's project fails with 23503 (composite FK)", async () => {
		await withAppRole(TENANT_B, async (c) => {
			const bProject = uid();
			await insertProject(c, bProject);
			await setTenant(c, TENANT_A);
			await expectPgError(
				c,
				"INSERT INTO project_plans (id, project_id, created_at) VALUES ($1, $2, now())",
				[uid(), bProject],
				"23503",
			);
		});
	});

	it("A inserting a task for B's project fails with 23503 (composite FK)", async () => {
		await withAppRole(TENANT_B, async (c) => {
			const bProject = uid();
			await insertProject(c, bProject);
			await setTenant(c, TENANT_A);
			const aProject = uid();
			const aPlan = uid();
			const aPhase = uid();
			await insertProject(c, aProject);
			await insertPlan(c, aPlan, aProject);
			await insertPhase(c, aPhase, aPlan);
			await expectPgError(
				c,
				"INSERT INTO tasks (id, phase_id, title, project_id) VALUES ($1, $2, 'f1b', $3)",
				[uid(), aPhase, bProject],
				"23503",
			);
		});
	});

	it("task, project_plan and phase inserted under A without tenant_id get A", async () => {
		await withAppRole(TENANT_A, async (c) => {
			const project = uid();
			const plan = uid();
			const phase = uid();
			await insertProject(c, project);
			expect((await insertPlan(c, plan, project)).rows[0].tenant_id).toBe(TENANT_A);
			expect((await insertPhase(c, phase, plan)).rows[0].tenant_id).toBe(TENANT_A);
			expect((await insertTask(c, uid(), phase, project)).rows[0].tenant_id).toBe(TENANT_A);
		});
	});

	it("a subquery-policy table (events): A cannot insert for B's project (42501) but can for its own", async () => {
		await withAppRole(TENANT_B, async (c) => {
			const bProject = uid();
			await insertProject(c, bProject);
			await setTenant(c, TENANT_A);
			const aProject = uid();
			await insertProject(c, aProject);
			const sql = "INSERT INTO events (id, project_id, type, timestamp) VALUES ($1, $2, 'f1b', now())";
			await c.query(sql, [uid(), aProject]);
			await expectPgError(c, sql, [uid(), bProject], "42501");
		});
	});

	it("A inserting a task with NULL project_id and B's phase fails with 23503 (composite phase FK)", async () => {
		await withAppRole(TENANT_B, async (c) => {
			const bProject = uid();
			const bPlan = uid();
			const bPhase = uid();
			await insertProject(c, bProject);
			await insertPlan(c, bPlan, bProject);
			await insertPhase(c, bPhase, bPlan);
			await setTenant(c, TENANT_A);
			await expectPgError(
				c,
				"INSERT INTO tasks (id, phase_id, title, project_id) VALUES ($1, $2, 'f1b', NULL)",
				[uid(), bPhase],
				"23503",
			);
		});
	});

	it("notifications: A's row without project_id gets tenant A and is invisible to B", async () => {
		await withAppRole(TENANT_A, async (c) => {
			const id = uid();
			const r = await c.query(
				"INSERT INTO notifications (id, type, title) VALUES ($1, 'f1b', 'f1b') RETURNING tenant_id",
				[id],
			);
			expect(r.rows[0].tenant_id).toBe(TENANT_A);
			expect((await c.query("SELECT 1 FROM notifications WHERE id = $1", [id])).rowCount).toBe(1);
			await setTenant(c, TENANT_B);
			expect((await c.query("SELECT 1 FROM notifications WHERE id = $1", [id])).rowCount).toBe(0);
		});
	});

	it("notifications: A inserting a row for B's project fails with 23503 (composite FK)", async () => {
		await withAppRole(TENANT_B, async (c) => {
			const bProject = uid();
			await insertProject(c, bProject);
			await setTenant(c, TENANT_A);
			await expectPgError(
				c,
				"INSERT INTO notifications (id, type, title, project_id) VALUES ($1, 'f1b', 'f1b', $2)",
				[uid(), bProject],
				"23503",
			);
		});
	});

	it("a forced applySchema never overwrites a non-NULL tenant_id of existing project/phase/task rows", async () => {
		const p = uid();
		const plan = uid();
		const phase = uid();
		const task = uid();
		await withMigrator(async (c) => {
			await c.query(
				"INSERT INTO projects (id, name, tenant_id, created_at, updated_at) VALUES ($1, 'f1b', $2, now(), now())",
				[p, TENANT_A],
			);
			await c.query("INSERT INTO project_plans (id, project_id, tenant_id, created_at) VALUES ($1, $2, $3, now())", [
				plan,
				p,
				TENANT_A,
			]);
			await c.query("INSERT INTO phases (id, plan_id, name, tenant_id) VALUES ($1, $2, 'f1b', $3)", [
				phase,
				plan,
				TENANT_A,
			]);
			await c.query("INSERT INTO tasks (id, phase_id, title, project_id, tenant_id) VALUES ($1, $2, 'f1b', $3, $4)", [
				task,
				phase,
				p,
				TENANT_A,
			]);
		});
		try {
			await applySchema(true);
			await withMigrator(async (c) => {
				for (const [table, id] of [
					["projects", p],
					["project_plans", plan],
					["phases", phase],
					["tasks", task],
				] as const) {
					const { rows } = await c.query(`SELECT tenant_id FROM ${table} WHERE id = $1`, [id]);
					expect(rows[0].tenant_id, table).toBe(TENANT_A);
				}
			});
		} finally {
			await withMigrator(async (c) => {
				await c.query("DELETE FROM projects WHERE id = $1", [p]);
			});
		}
	}, 180_000);

	it("tenant_id immutability also holds for the migrator (trigger, not just policy) with 42501", async () => {
		await withMigrator(async (client) => {
			const id = uid();
			await client.query("BEGIN");
			try {
				await client.query(
					"INSERT INTO projects (id, name, tenant_id, created_at, updated_at) VALUES ($1, 'f1b', $2, now(), now())",
					[id, TENANT_A],
				);
				await expectPgError(
					client as unknown as PoolClient,
					"UPDATE projects SET tenant_id = $2 WHERE id = $1",
					[id, TENANT_B],
					"42501",
				);
			} finally {
				await client.query("ROLLBACK");
			}
		});
	});
});

// 6. composite FKs
interface FkRow {
	tbl: string;
	ref: string;
	cols: string[];
	refcols: string[];
}

async function loadFks(): Promise<FkRow[]> {
	const { rows } = await getPool().query<FkRow>(
		`SELECT c.conrelid::regclass::text AS tbl, c.confrelid::regclass::text AS ref,
		   (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
		      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols,
		   (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
		      JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS refcols
		 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
		 WHERE c.contype = 'f' AND n.nspname = 'public'`,
	);
	return rows;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

describe("composite tenant foreign keys", () => {
	it("projects has UNIQUE(id, tenant_id)", async () => {
		const { rows } = await getPool().query<{ cols: string[] }>(
			`SELECT (SELECT array_agg(a.attname::text) FROM unnest(c.conkey) k(attnum)
			           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols
			 FROM pg_constraint c WHERE c.conrelid = 'public.projects'::regclass AND c.contype IN ('u', 'p')`,
		);
		expect(rows.some((r) => sameSet(r.cols, ["id", "tenant_id"]))).toBe(true);
	});

	it("phases has UNIQUE(id, tenant_id)", async () => {
		const { rows } = await getPool().query<{ cols: string[] }>(
			`SELECT (SELECT array_agg(a.attname::text) FROM unnest(c.conkey) k(attnum)
			           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols
			 FROM pg_constraint c WHERE c.conrelid = 'public.phases'::regclass AND c.contype IN ('u', 'p')`,
		);
		expect(rows.some((r) => sameSet(r.cols, ["id", "tenant_id"]))).toBe(true);
	});

	it("tasks reference phases(id, tenant_id) via (phase_id, tenant_id)", async () => {
		const fks = await loadFks();
		expect(
			fks.some(
				(f) =>
					f.tbl === "tasks" &&
					f.ref === "phases" &&
					sameSet(f.cols, ["phase_id", "tenant_id"]) &&
					sameSet(f.refcols, ["id", "tenant_id"]),
			),
		).toBe(true);
	});

	it("tasks and project_plans reference projects(id, tenant_id); phases reference project_plans(id, tenant_id)", async () => {
		const fks = await loadFks();
		const has = (tbl: string, cols: string[], ref: string, refcols: string[]) =>
			fks.some((f) => f.tbl === tbl && f.ref === ref && sameSet(f.cols, cols) && sameSet(f.refcols, refcols));
		expect(has("tasks", ["project_id", "tenant_id"], "projects", ["id", "tenant_id"]), "tasks").toBe(true);
		expect(has("project_plans", ["project_id", "tenant_id"], "projects", ["id", "tenant_id"]), "project_plans").toBe(
			true,
		);
		expect(has("phases", ["plan_id", "tenant_id"], "project_plans", ["id", "tenant_id"]), "phases").toBe(true);
	});

	it("newer direct tables with a project_id column have a composite FK to projects", async () => {
		const fks = await loadFks();
		const { rows } = await getPool().query<{ table_name: string }>(
			`SELECT c.relname AS table_name
			 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
			 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped AND a.attname = 'project_id' AND c.relname = ANY($1::text[])`,
			[NEWER_DIRECT],
		);
		expect(rows.length).toBeGreaterThan(0);
		const missing = rows
			.map((r) => r.table_name)
			.filter(
				(t) =>
					!fks.some(
						(f) =>
							f.tbl === t &&
							f.ref === "projects" &&
							sameSet(f.cols, ["project_id", "tenant_id"]) &&
							sameSet(f.refcols, ["id", "tenant_id"]),
					),
			)
			.sort();
		expect(missing, `missing composite FK to projects: ${missing.join(", ")}`).toEqual([]);
	});
});

// 8-9. applySchema idempotency and orphan removal
describe("applySchema", () => {
	it("applied twice yields an identical policy snapshot and no errors", async () => {
		await applySchema(true);
		const first = await policySnapshot();
		await applySchema(true);
		const second = await policySnapshot();
		expect(JSON.parse(first).length).toBeGreaterThanOrEqual(F1_TABLES.length);
		expect(second).toBe(first);
	}, 180_000);

	it("the orphan table model_routing_policies no longer exists", async () => {
		await applySchema();
		const { rowCount } = await getPool().query(
			"SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'model_routing_policies'",
		);
		expect(rowCount).toBe(0);
	}, 180_000);
});
